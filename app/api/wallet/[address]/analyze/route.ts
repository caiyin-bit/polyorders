import {
  buildAnalysisPrompt,
  ANALYST_SYSTEM,
  type AnalysisClosedRow,
  type AnalysisInput,
  type AnalysisOpenPosition,
  type AnalysisTrade,
} from "@/src/analysis";
import { chat, isLlmConfigured } from "@/src/llm";
import { query } from "@/src/db";
import { walletSnapshot } from "@/src/wallet";

export const dynamic = "force-dynamic";

// 明细行数上限。持仓/成交沿用弹窗的 50;平仓明细取 30 条已够模型看出
// 近期节奏,聚合统计(集中度、盈亏比)覆盖的是全量,不受此限。
const RECENT_CLOSED_LIMIT = 30;
const CURVE_POINTS = 30;

// running 行的判死线:超过它仍未完结,视为进程重启/超时留下的孤儿。
// 取值要大于 chat 的 timeoutMs(120s)加重试余量,否则会误杀活着的任务
const STALE_MS = 5 * 60_000;

// 每地址保留的历史条数。只有最新一条会被展示,多留几条仅供排查
const KEEP_PER_ADDRESS = 5;

type AnalysisRow = {
  id: number;
  status: string;
  content: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
};

function toApi(r: AnalysisRow) {
  const stale = r.status === "running" && Date.now() - r.started_at > STALE_MS;
  return {
    status: stale ? "error" : r.status,
    content: r.content,
    model: r.model,
    usage: {
      promptTokens: r.prompt_tokens ?? 0,
      completionTokens: r.completion_tokens ?? 0,
    },
    error: stale ? "分析中断(服务可能重启过),请重新分析" : r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

async function latestRow(address: string): Promise<AnalysisRow | null> {
  const { rows } = await query<AnalysisRow>(
    `SELECT id, status, content, model, prompt_tokens, completion_tokens,
            error, started_at, finished_at
     FROM wallet_analyses WHERE address = $1
     ORDER BY started_at DESC LIMIT 1`,
    [address],
  );
  return rows[0] ?? null;
}

/** 弹窗打开时恢复状态:最新一条分析,可能是 running/done/error */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const row = await latestRow(address);
  return Response.json({ analysis: row ? toApi(row) : null });
}

async function gatherInput(address: string): Promise<AnalysisInput> {
  const cutoff30d = Math.floor(Date.now() / 1000) - 30 * 86400;
  const [snapshot, candRes, aggRes, winsRes, lossesRes, recentRes, curveRes] =
    await Promise.all([
      walletSnapshot(address),
      query<{ username: string | null }>(
        "SELECT username FROM candidates WHERE address = $1",
        [address],
      ),
      query<{
        total: number;
        sum_pnl: number;
        avg_win: number | null;
        avg_loss: number | null;
        recent_count: number;
        recent_sum: number;
      }>(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(realized_pnl), 0)::float AS sum_pnl,
                (AVG(realized_pnl) FILTER (WHERE realized_pnl > 0))::float AS avg_win,
                (AVG(realized_pnl) FILTER (WHERE realized_pnl < 0))::float AS avg_loss,
                (COUNT(*) FILTER (WHERE "timestamp" >= $2))::int AS recent_count,
                COALESCE(SUM(realized_pnl) FILTER (WHERE "timestamp" >= $2), 0)::float AS recent_sum
         FROM closed_positions WHERE address = $1`,
        [address, cutoff30d],
      ),
      query<AnalysisClosedRow>(
        `SELECT "timestamp", title, outcome, avg_price, realized_pnl
         FROM closed_positions WHERE address = $1 AND realized_pnl > 0
         ORDER BY realized_pnl DESC LIMIT 5`,
        [address],
      ),
      query<AnalysisClosedRow>(
        `SELECT "timestamp", title, outcome, avg_price, realized_pnl
         FROM closed_positions WHERE address = $1 AND realized_pnl < 0
         ORDER BY realized_pnl ASC LIMIT 5`,
        [address],
      ),
      query<AnalysisClosedRow>(
        `SELECT "timestamp", title, outcome, avg_price, realized_pnl
         FROM closed_positions WHERE address = $1
         ORDER BY "timestamp" DESC NULLS LAST LIMIT ${RECENT_CLOSED_LIMIT}`,
        [address],
      ),
      query<{ realized_pnl: number; timestamp: number }>(
        `SELECT realized_pnl, "timestamp" FROM closed_positions
         WHERE address = $1 AND "timestamp" IS NOT NULL
         ORDER BY "timestamp" ASC`,
        [address],
      ),
    ]);

  let acc = 0;
  const series: Array<[number, number]> = curveRes.rows.map((p) => [
    p.timestamp,
    (acc += p.realized_pnl),
  ]);
  const step = Math.max(1, Math.ceil(series.length / CURVE_POINTS));
  const agg = aggRes.rows[0];
  return {
    address,
    username: candRes.rows[0]?.username ?? null,
    now: new Date().toISOString(),
    score: snapshot.score,
    openTotal: snapshot.openTotal,
    openPositions: snapshot.openPositions as AnalysisOpenPosition[],
    trades: snapshot.recentTrades as AnalysisTrade[],
    closed: {
      total: agg.total,
      sumPnl: agg.sum_pnl,
      avgWin: agg.avg_win,
      avgLoss: agg.avg_loss,
      last30d: { count: agg.recent_count, sum: agg.recent_sum },
      topWins: winsRes.rows,
      topLosses: lossesRes.rows,
      recent: recentRes.rows,
    },
    curve: series.filter((_, i) => i % step === 0 || i === series.length - 1),
  };
}

// 后台执行体。web 容器是常驻 next start 进程,fire-and-forget 的 Promise
// 不会被回收;进程若真在中途死掉,靠读侧的 STALE_MS 判定兜底
async function runAnalysis(id: number, address: string): Promise<void> {
  try {
    const input = await gatherInput(address);
    const r = await chat(
      [
        { role: "system", content: ANALYST_SYSTEM },
        { role: "user", content: buildAnalysisPrompt(input) },
      ],
      // 低温度:同一份数据反复分析应给出基本一致的判断,这是审计不是创作。
      // reasoning 必须显式限档:默认与 medium 档实测思考 7k-8k token,把
      // maxTokens 全部吃掉导致正文为空;low 档(约 700 token 思考、全程 25s)
      // 的报告质量经真实数据核验没有损失。maxTokens 同时约束思考与正文
      {
        temperature: 0.3,
        maxTokens: 8192,
        timeoutMs: 120_000,
        reasoning: "low",
      },
    );
    await query(
      `UPDATE wallet_analyses
       SET status = 'done', content = $2, model = $3,
           prompt_tokens = $4, completion_tokens = $5, finished_at = $6
       WHERE id = $1`,
      [
        id,
        r.content,
        r.model,
        r.usage.promptTokens,
        r.usage.completionTokens,
        Date.now(),
      ],
    );
  } catch (err) {
    console.error(`钱包分析失败 ${address}: ${String(err)}`);
    await query(
      `UPDATE wallet_analyses
       SET status = 'error', error = $2, finished_at = $3
       WHERE id = $1`,
      [id, String(err).slice(0, 500), Date.now()],
    ).catch(() => {});
  }
}

/** 发起分析:登记任务立即返回,前端轮询 GET 取结果。POST 语义:每次都花钱 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  if (!isLlmConfigured()) {
    return Response.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY,分析功能不可用" },
      { status: 503 },
    );
  }
  const { address } = await params;

  // 已有活着的 running 任务就复用:双击/多标签页不该产生两笔 LLM 开销
  const existing = await latestRow(address);
  if (
    existing?.status === "running" &&
    Date.now() - existing.started_at <= STALE_MS
  ) {
    return Response.json({ analysis: toApi(existing) });
  }

  const startedAt = Date.now();
  const ins = await query<{ id: number }>(
    `INSERT INTO wallet_analyses (address, status, started_at)
     VALUES ($1, 'running', $2) RETURNING id`,
    [address, startedAt],
  );
  const id = ins.rows[0].id;

  // 顺手修剪历史,免得反复分析的地址无限累积
  await query(
    `DELETE FROM wallet_analyses WHERE address = $1 AND id NOT IN (
       SELECT id FROM wallet_analyses WHERE address = $1
       ORDER BY started_at DESC LIMIT ${KEEP_PER_ADDRESS}
     )`,
    [address],
  );

  void runAnalysis(id, address);
  const row = await latestRow(address);
  return Response.json({ analysis: row ? toApi(row) : null });
}
