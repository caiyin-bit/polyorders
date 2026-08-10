// LLM 用量看板:按日 × 消费方 × 模型聚合账本,登录可见(middleware 把关)。
// 第一期只出接口,浏览器/CLI 直接看 JSON;要可视化面板等有需要再加。

import { query } from "@/src/db";
import { llmDailyMaxUsd, llmSpentToday } from "@/src/llm-gateway";

export const dynamic = "force-dynamic";

const DAYS = 14;
// 与 bjDayStart 同源的北京时间偏移;用于把毫秒时间戳折算成自然日
const BJ_OFFSET_MS = 8 * 3600_000;

export async function GET() {
  const since = Date.now() - DAYS * 86400_000;
  const [{ rows }, todayUsd] = await Promise.all([
    query<{
      day_idx: number;
      caller: string;
      model: string;
      calls: number;
      errors: number;
      prompt_tokens: number;
      completion_tokens: number;
      cost_usd: number;
      avg_latency_ms: number | null;
    }>(
      `SELECT FLOOR((started_at + ${BJ_OFFSET_MS}) / 86400000)::int AS day_idx,
              caller, model,
              COUNT(*)::int AS calls,
              (COUNT(*) FILTER (WHERE status = 'error'))::int AS errors,
              COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
              COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd,
              (AVG(latency_ms) FILTER (WHERE status = 'ok'))::float8 AS avg_latency_ms
       FROM llm_calls WHERE started_at >= $1
       GROUP BY day_idx, caller, model
       ORDER BY day_idx DESC, cost_usd DESC`,
      [since],
    ),
    llmSpentToday(),
  ]);

  return Response.json({
    dailyMaxUsd: llmDailyMaxUsd(),
    todayUsd,
    rows: rows.map((r) => ({
      // day_idx 是「北京时间偏移后」的自然日序号,乘回天长即得该日的
      // 北京日历日期(用 UTC 格式化正好抵消偏移)
      date: new Date(r.day_idx * 86400_000).toISOString().slice(0, 10),
      caller: r.caller,
      model: r.model,
      calls: r.calls,
      errors: r.errors,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      costUsd: r.cost_usd,
      avgLatencyMs: r.avg_latency_ms === null ? null : Math.round(r.avg_latency_ms),
    })),
  });
}
