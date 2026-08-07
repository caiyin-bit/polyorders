// LLM 调用,直连 DeepSeek 官方 API(OpenAI 兼容的 chat/completions)。
//
// 与 telegram.ts 不同,这里失败要抛错而不是静默返回 false:LLM 的产出会
// 进入决策链路,把「调用失败」伪装成「模型没意见」会让下游做出错误判断。
// 调用方自己决定降级策略(跳过本轮、回退规则引擎等)。

import { LLM_BASE_URL, LLM_MODEL_DEFAULT } from "./config";
import { sleep } from "./http";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatResult = {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
};

// 生成比普通 API 慢得多,且推理型模型思考本身要花全程的大头。默认 60s 适合
// 短任务;长报告类调用(实测钱包分析单次 >60s)用 opts.timeoutMs 自行放宽
const TIMEOUT_MS = 60_000;
const RETRIES = 2;

/** 未配置密钥时 LLM 功能整体停用,调用方据此走无 LLM 的路径 */
export function isLlmConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.DEEPSEEK_API_KEY);
}

/**
 * 解析 OpenAI 兼容响应。单独导出以便测试。
 *
 * 防御性检查 body.error:OpenAI 兼容生态里存在 HTTP 200 携带业务错误的实现,
 * 只看状态码会把错误消息当成模型回答。
 */
export function parseChatCompletion(body: unknown): ChatResult {
  const b = body as {
    error?: { message?: string; code?: number | string };
    model?: string;
    choices?: Array<{
      message?: { content?: unknown };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  if (!b || typeof b !== "object") {
    throw new Error("LLM 响应不是 JSON 对象");
  }
  if (b.error) {
    throw new Error(`LLM 业务错误: ${b.error.code ?? ""} ${b.error.message ?? ""}`);
  }
  const content = b.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    // deepseek-v4-flash 是推理模型:max_tokens 同时约束推理与正文,预算给小了
    // 会被推理全部吃掉,正文为空——这是实际踩过的坑,报错必须指向病因
    if (b.choices?.[0]?.finish_reason === "length") {
      throw new Error(
        "LLM 输出被 max_tokens 截断(推理型模型的思考过程也计入预算),需增大 maxTokens",
      );
    }
    throw new Error("LLM 响应缺少 choices[0].message.content");
  }
  return {
    content,
    model: b.model ?? "",
    usage: {
      promptTokens: b.usage?.prompt_tokens ?? 0,
      completionTokens: b.usage?.completion_tokens ?? 0,
    },
  };
}

export async function chat(
  messages: ChatMessage[],
  opts: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    /**
     * 推理开销:"none" 关闭思考,其余映射 reasoning_effort;省略走模型默认。
     * 注意默认(不限)实测在长分析任务上思考可超 8k token 且全程计入
     * maxTokens——重任务务必显式选档。
     */
    reasoning?: "none" | "low" | "medium" | "high";
  } = {},
): Promise<ChatResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置,先用 isLlmConfigured() 判断再调用");
  }
  const model = opts.model ?? process.env.LLM_MODEL ?? LLM_MODEL_DEFAULT;

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          ...(opts.temperature !== undefined
            ? { temperature: opts.temperature }
            : {}),
          ...(opts.maxTokens !== undefined
            ? { max_tokens: opts.maxTokens }
            : {}),
          ...(opts.reasoning === "none"
            ? { thinking: { type: "disabled" } }
            : opts.reasoning
              ? { reasoning_effort: opts.reasoning }
              : {}),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`LLM HTTP ${res.status}`);
      } else if (!res.ok) {
        // 4xx 是请求本身的问题(密钥无效、模型名错),重试只会原样再错一次
        const text = await res.text().catch(() => "");
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
      } else {
        return parseChatCompletion(await res.json());
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("LLM ")) throw err;
      lastError = err;
    }
    if (attempt < RETRIES) await sleep(1000 * 2 ** attempt);
  }
  throw lastError;
}
