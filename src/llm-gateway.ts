// LLM 统一网关:所有模型调用的唯一入口。
//
// 职责(按调用顺序):日预算闸门 → 全局并发限流 → 供应商路由与参数方言
// 适配 → 重试/超时 → 记账(llm_calls)。业务代码只写逻辑模型名与 caller,
// 供应商细节全在 src/config.ts 的注册表里。
//
// 失败语义沿袭 llm.ts 时代:抛错而非静默——LLM 产出会进入决策链路,
// 把「调用失败」伪装成「模型没意见」会让下游做出错误判断。
// 记账则是旁路:写账本失败只打日志,不阻断业务调用。

import {
  LLM_CONCURRENCY,
  LLM_DAILY_MAX_USD_DEFAULT,
  LLM_DEFAULT_MODEL,
  LLM_MAX_TOKENS_CAP,
  LLM_MODELS,
  LLM_SPACING_MS,
  type LlmModelSpec,
  type LlmProvider,
} from "./config";
import { query } from "./db";
import { createLimiter, sleep } from "./http";
import { parseChatCompletion, type ChatMessage, type ChatResult } from "./llm";
import { bjDayStart } from "./trade/risk";

const PROVIDERS: Record<LlmProvider, { baseUrl: string; keyEnv: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", keyEnv: "DEEPSEEK_API_KEY" },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
  },
};

const TIMEOUT_MS = 60_000;
const RETRIES = 2;

export type GatewayRequest = {
  messages: ChatMessage[];
  /** 消费方标识(如 "wallet-analysis"),审计的主维度,必填 */
  caller: string;
  /** 业务关联对象(如钱包地址),问题回溯用 */
  refId?: string;
  /** 逻辑模型名(注册表键);缺省依次取 LLM_MODEL 环境变量、默认主力模型 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * 推理开销:"none" 关闭思考,其余为档位;省略走模型默认。
   * 注意默认(不限)实测在长分析任务上思考可超 8k token 且全程计入
   * maxTokens——重任务务必显式选档。
   */
  reasoning?: "none" | "low" | "medium" | "high";
};

export type GatewayResult = ChatResult & {
  /** 逻辑模型名(注册表键),账本与展示都用它 */
  logicalModel: string;
  costUsd: number;
  latencyMs: number;
};

/** 解析逻辑模型名;不认识的名字直接抛错,拼错模型名不该静默落到默认值 */
export function resolveModel(name?: string): {
  logical: string;
  spec: LlmModelSpec;
} {
  const logical = name ?? process.env.LLM_MODEL ?? LLM_DEFAULT_MODEL;
  const spec = LLM_MODELS[logical];
  if (!spec) {
    throw new Error(
      `未注册的 LLM 逻辑模型: ${logical}(可用: ${Object.keys(LLM_MODELS).join(", ")})`,
    );
  }
  return { logical, spec };
}

/** 默认主力模型是否可用;调用方据此走无 LLM 的路径 */
export function isLlmConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const { spec } = resolveModel();
  return Boolean(env[PROVIDERS[spec.provider].keyEnv]);
}

/** 成本核算(美元)。导出供测试:算错的直接后果是预算闸门失灵 */
export function costUsd(
  spec: LlmModelSpec,
  usage: ChatResult["usage"],
): number {
  return (
    (usage.promptTokens * spec.inUsdPerM +
      usage.completionTokens * spec.outUsdPerM) /
    1_000_000
  );
}

/**
 * 组装请求体,按供应商方言映射 reasoning 参数。导出供测试。
 * DeepSeek: thinking:{type:"disabled"} / reasoning_effort
 * OpenRouter 统一层: reasoning:{enabled:false} / reasoning:{effort}
 */
export function buildRequestBody(
  spec: LlmModelSpec,
  req: GatewayRequest,
): Record<string, unknown> {
  const maxTokens =
    req.maxTokens !== undefined
      ? Math.min(req.maxTokens, LLM_MAX_TOKENS_CAP)
      : undefined;
  const base: Record<string, unknown> = {
    model: spec.model,
    messages: req.messages,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
  };
  if (req.reasoning === undefined) return base;
  if (spec.provider === "deepseek") {
    return req.reasoning === "none"
      ? { ...base, thinking: { type: "disabled" } }
      : { ...base, reasoning_effort: req.reasoning };
  }
  return req.reasoning === "none"
    ? { ...base, reasoning: { enabled: false } }
    : { ...base, reasoning: { effort: req.reasoning } };
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function llmDailyMaxUsd(): number {
  return envNumber("LLM_DAILY_MAX_USD", LLM_DAILY_MAX_USD_DEFAULT);
}

/** 当日(北京时间自然日)已核算的 LLM 花费,与交易限额同口径 */
export async function llmSpentToday(): Promise<number> {
  const { rows } = await query<{ total: number }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total
     FROM llm_calls WHERE started_at >= $1`,
    [bjDayStart(Date.now())],
  );
  return rows[0].total;
}

// 全局并发限流:挂 globalThis 保证跨路由模块唯一(Next.js 会为每个路由
// 文件建独立模块实例)。并发 3 是对供应商与 Supabase 连接池的双重克制
const g = globalThis as unknown as {
  __llmLimiter?: <T>(fn: () => Promise<T>) => Promise<T>;
};
function limiter() {
  if (!g.__llmLimiter) {
    g.__llmLimiter = createLimiter(LLM_CONCURRENCY, LLM_SPACING_MS);
  }
  return g.__llmLimiter;
}

/** 记账。旁路:失败只打日志,绝不影响业务调用的结果 */
async function recordCall(row: {
  caller: string;
  refId?: string;
  provider: string;
  model: string;
  status: "ok" | "error";
  error?: string;
  usage?: ChatResult["usage"];
  costUsd?: number;
  latencyMs: number;
  startedAt: number;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO llm_calls (caller, ref_id, provider, model, status, error,
         prompt_tokens, completion_tokens, reasoning_tokens, cost_usd,
         latency_ms, started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.caller,
        row.refId ?? null,
        row.provider,
        row.model,
        row.status,
        row.error?.slice(0, 500) ?? null,
        row.usage?.promptTokens ?? null,
        row.usage?.completionTokens ?? null,
        row.usage?.reasoningTokens ?? null,
        row.costUsd ?? null,
        row.latencyMs,
        row.startedAt,
        Date.now(),
      ],
    );
  } catch (err) {
    console.error(`LLM 记账失败(不影响调用): ${String(err)}`);
  }
}

export async function chat(req: GatewayRequest): Promise<GatewayResult> {
  const { logical, spec } = resolveModel(req.model);
  const provider = PROVIDERS[spec.provider];
  const apiKey = process.env[provider.keyEnv];
  if (!apiKey) {
    throw new Error(`${provider.keyEnv} 未配置,模型 ${logical} 不可用`);
  }

  // 预算闸门:超限一律拒绝。故意不给任何绕过口子——绕过等于没有闸门
  const dailyMax = llmDailyMaxUsd();
  const spent = await llmSpentToday();
  if (spent >= dailyMax) {
    throw new Error(
      `LLM 日预算已用尽:今日 $${spent.toFixed(4)} / 上限 $${dailyMax.toFixed(2)},明日自动恢复或调高 LLM_DAILY_MAX_USD`,
    );
  }

  const body = JSON.stringify(buildRequestBody(spec, req));
  const startedAt = Date.now();

  return limiter()(async () => {
    let lastError: unknown;
    try {
      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
          const res = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body,
            signal: AbortSignal.timeout(req.timeoutMs ?? TIMEOUT_MS),
          });
          if (res.status === 429 || res.status >= 500) {
            lastError = new Error(`LLM HTTP ${res.status}`);
          } else if (!res.ok) {
            // 4xx 是请求本身的问题(密钥无效、模型名错),重试只会原样再错一次
            const text = await res.text().catch(() => "");
            throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
          } else {
            const parsed = parseChatCompletion(await res.json());
            const latencyMs = Date.now() - startedAt;
            const cost = costUsd(spec, parsed.usage);
            await recordCall({
              caller: req.caller,
              refId: req.refId,
              provider: spec.provider,
              model: logical,
              status: "ok",
              usage: parsed.usage,
              costUsd: cost,
              latencyMs,
              startedAt,
            });
            return { ...parsed, logicalModel: logical, costUsd: cost, latencyMs };
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("LLM ")) throw err;
          lastError = err;
        }
        if (attempt < RETRIES) await sleep(1000 * 2 ** attempt);
      }
      throw lastError;
    } catch (err) {
      await recordCall({
        caller: req.caller,
        refId: req.refId,
        provider: spec.provider,
        model: logical,
        status: "error",
        error: String(err),
        latencyMs: Date.now() - startedAt,
        startedAt,
      });
      throw err;
    }
  });
}
