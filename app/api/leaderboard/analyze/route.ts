// 「列表分析」:对列表当前页可见的地址逐一跑 AI 检视,每行展示评级与理由。
//
// 分析对象由前端随请求传入(当前页的地址),而不是服务端固定 Top N——
// 用户翻到第几页,分析的就是眼前这一页;地址必须存在于 scores 表,
// 防止该端点被当成任意地址的免费分析器。
//
// POST 只登记任务便返回,执行经 queueAnalysisTask 入队(任务级并发限制
// 在 analysis-service,LLM 调用级限流与预算在 llm-gateway)。进度不单独
// 建表——每个地址的 wallet_analyses 最新行就是进度,GET 聚合它们,
// 前端轮询到没有 running 为止。

import { createAnalysisTask, isStaleRunning, queueAnalysisTask } from "@/src/analysis-service";
import { TOP_N } from "@/src/config";
import { query } from "@/src/db";
import { isLlmConfigured } from "@/src/llm-gateway";
import { normalizeAddress } from "@/src/watchlist";

export const dynamic = "force-dynamic";

// 一次最多接的地址数:列表每页上限 100,再多就是异常调用
const MAX_ADDRESSES = 100;
// 批量重跑的跳过窗口:窗口内已出报告的地址不再花钱。想强制刷新单个地址,
// 弹窗里的「重新分析」不受此限
const SKIP_FRESH_MS = 30 * 60_000;

/** 校验、去重、截断,并过滤出 scores 里真实存在的地址 */
async function sanitizeAddresses(raw: unknown): Promise<string[]> {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = [
    ...new Set(list.map(normalizeAddress).filter((a): a is string => a !== null)),
  ].slice(0, MAX_ADDRESSES);
  if (cleaned.length === 0) return [];
  const { rows } = await query<{ address: string }>(
    "SELECT address FROM scores WHERE address = ANY($1)",
    [cleaned],
  );
  return rows.map((r) => r.address);
}

async function topAddresses(): Promise<string[]> {
  const { rows } = await query<{ address: string }>(
    `SELECT address FROM scores WHERE rank IS NOT NULL
     ORDER BY rank ASC LIMIT ${TOP_N}`,
  );
  return rows.map((r) => r.address);
}

/** 指定地址各自最新一次分析的摘要。?addrs=a,b,c;缺省回退 Top N */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const addrsParam = url.searchParams.get("addrs");
  const addresses = addrsParam
    ? await sanitizeAddresses(addrsParam.split(","))
    : await topAddresses();
  if (addresses.length === 0) return Response.json({ items: [] });

  const { rows } = await query<{
    address: string;
    status: string | null;
    rating: string | null;
    rating_reason: string | null;
    started_at: number | null;
    finished_at: number | null;
  }>(
    `SELECT s.address, a.status, a.rating, a.rating_reason,
            a.started_at, a.finished_at
     FROM unnest($1::text[]) AS s(address)
     LEFT JOIN LATERAL (
       SELECT status, rating, rating_reason, started_at, finished_at
       FROM wallet_analyses w
       WHERE w.address = s.address AND w.kind <> 'member'
       ORDER BY started_at DESC LIMIT 1
     ) a ON true`,
    [addresses],
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

/** 发起批量分析,body: { addresses: string[] }。返回排队/跳过数供前端提示 */
export async function POST(req: Request) {
  if (!isLlmConfigured()) {
    return Response.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY,分析功能不可用" },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { addresses?: unknown };
  const addresses = await sanitizeAddresses(body.addresses);
  if (addresses.length === 0) {
    return Response.json({ error: "没有可分析的地址" }, { status: 400 });
  }
  let queued = 0;
  for (const address of addresses) {
    const id = await createAnalysisTask(address, {
      skipFreshDoneMs: SKIP_FRESH_MS,
    });
    if (id === null) continue;
    queued++;
    queueAnalysisTask(id, address, "list-analysis");
  }
  return Response.json({
    queued,
    skipped: addresses.length - queued,
    total: addresses.length,
  });
}
