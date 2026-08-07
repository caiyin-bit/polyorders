// 「列表分析」:对入围 Top N 逐一跑 AI 检视,列表每行展示评级与理由。
//
// POST 只登记任务便返回,执行走进程内队列:并发 3 是对 DeepSeek 与
// Supabase 连接池(max 10)的双重克制,20 个地址约 3-4 分钟跑完。
// 进度不单独建表——每个地址的 wallet_analyses 最新行就是进度,
// GET 聚合它们,前端轮询到没有 running 为止。

import { createAnalysisTask, executeAnalysisTask, isStaleRunning } from "@/src/analysis-service";
import { TOP_N } from "@/src/config";
import { query } from "@/src/db";
import { createLimiter } from "@/src/http";
import { isLlmConfigured } from "@/src/llm";

export const dynamic = "force-dynamic";

const CONCURRENCY = 3;
const SPACING_MS = 1000;
// 批量重跑的跳过窗口:窗口内已出报告的地址不再花钱。想强制刷新单个地址,
// 弹窗里的「重新分析」不受此限
const SKIP_FRESH_MS = 30 * 60_000;

// 挂 globalThis:Next.js 会为每个路由文件建独立模块实例,HMR 也会重建,
// 限流器必须全局唯一才能真正压住并发
const g = globalThis as unknown as {
  __analyzeLimiter?: <T>(fn: () => Promise<T>) => Promise<T>;
};
function limiter() {
  if (!g.__analyzeLimiter) g.__analyzeLimiter = createLimiter(CONCURRENCY, SPACING_MS);
  return g.__analyzeLimiter;
}

async function topAddresses(): Promise<string[]> {
  const { rows } = await query<{ address: string }>(
    `SELECT address FROM scores WHERE rank IS NOT NULL
     ORDER BY rank ASC LIMIT ${TOP_N}`,
  );
  return rows.map((r) => r.address);
}

/** Top N 各自最新一次分析的摘要,按排名排序 */
export async function GET() {
  const { rows } = await query<{
    address: string;
    rank: number;
    status: string | null;
    rating: string | null;
    rating_reason: string | null;
    started_at: number | null;
    finished_at: number | null;
  }>(
    `SELECT s.address, s.rank, a.status, a.rating, a.rating_reason,
            a.started_at, a.finished_at
     FROM scores s
     LEFT JOIN LATERAL (
       SELECT status, rating, rating_reason, started_at, finished_at
       FROM wallet_analyses w WHERE w.address = s.address
       ORDER BY started_at DESC LIMIT 1
     ) a ON true
     WHERE s.rank IS NOT NULL
     ORDER BY s.rank ASC LIMIT ${TOP_N}`,
  );
  const items = rows.map((r) => ({
    address: r.address,
    status:
      r.status === null
        ? null
        : isStaleRunning(r.status, r.started_at ?? 0)
          ? "error"
          : r.status,
    rating: r.rating,
    reason: r.rating_reason,
    finishedAt: r.finished_at,
  }));
  return Response.json({ items });
}

/** 发起批量分析。返回本次新排队的数量与跳过数,便于前端提示 */
export async function POST() {
  if (!isLlmConfigured()) {
    return Response.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY,分析功能不可用" },
      { status: 503 },
    );
  }
  const addresses = await topAddresses();
  const run = limiter();
  let queued = 0;
  for (const address of addresses) {
    const id = await createAnalysisTask(address, {
      skipFreshDoneMs: SKIP_FRESH_MS,
    });
    if (id === null) continue;
    queued++;
    void run(() => executeAnalysisTask(id, address));
  }
  return Response.json({
    queued,
    skipped: addresses.length - queued,
    total: addresses.length,
  });
}
