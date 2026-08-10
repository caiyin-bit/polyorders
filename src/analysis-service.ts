// 钱包 AI 分析的任务管理与执行。
// 单钱包路由(/api/wallet/[address]/analyze)与批量路由(/api/leaderboard/analyze)
// 共用,免得改一次执行参数要记得改两处(同 walletSnapshot 的做法)。
//
// 任务模型:wallet_analyses 一行一次分析,status running/done/error。
// running 行没有心跳,进程重启会留孤儿——读侧按 started_at 超时判中断,
// 不依赖清理任务。

import {
  buildAnalysisPrompt,
  extractRating,
  ANALYST_SYSTEM,
  type AnalysisClosedRow,
  type AnalysisInput,
  type AnalysisOpenPosition,
  type AnalysisTrade,
} from "./analysis";
import { chat } from "./llm-gateway";
import { query } from "./db";
import { createLimiter } from "./http";
import { walletSnapshot } from "./wallet";

// 明细行数上限。持仓/成交沿用弹窗的 50;平仓明细取 30 条已够模型看出
// 近期节奏,聚合统计(集中度、盈亏比)覆盖的是全量,不受此限。
const RECENT_CLOSED_LIMIT = 30;
const CURVE_POINTS = 30;

// running 行的判死线。要盖过「批量分析排队等待 + 单次执行」的总时长:
// 批量一次最多 100 个地址、并发 3、单个约 30s,队尾要等约 17 分钟才开跑,
// 判死线必须留在其后;代价是真正的孤儿行要挂半小时才显示「中断」
export const STALE_MS = 30 * 60_000;

// 每地址保留的历史条数。只有最新一条会被展示,多留几条仅供排查
const KEEP_PER_ADDRESS = 5;

export type AnalysisRow = {
  id: number;
  status: string;
  content: string | null;
  model: string | null;
  rating: string | null;
  rating_reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
};

export function isStaleRunning(status: string, startedAt: number): boolean {
  return status === "running" && Date.now() - startedAt > STALE_MS;
}

export async function latestAnalysis(
  address: string,
): Promise<AnalysisRow | null> {
  const { rows } = await query<AnalysisRow>(
    `SELECT id, status, content, model, rating, rating_reason,
            prompt_tokens, completion_tokens, error, started_at, finished_at
     FROM wallet_analyses WHERE address = $1
     ORDER BY started_at DESC LIMIT 1`,
    [address],
  );
  return rows[0] ?? null;
}

/**
 * 登记一个分析任务(不执行)。返回新任务 id;不该新开时返回 null:
 * - 已有活着的 running 任务(双击/多标签页/批量与单点重叠,不重复扣费)
 * - skipFreshDoneMs 内已有完成的报告(批量重跑时跳过刚分析过的地址)
 */
export async function createAnalysisTask(
  address: string,
  opts: { skipFreshDoneMs?: number } = {},
): Promise<number | null> {
  const latest = await latestAnalysis(address);
  if (latest) {
    if (latest.status === "running" && !isStaleRunning(latest.status, latest.started_at)) {
      return null;
    }
    if (
      opts.skipFreshDoneMs !== undefined &&
      latest.status === "done" &&
      latest.finished_at !== null &&
      Date.now() - latest.finished_at <= opts.skipFreshDoneMs
    ) {
      return null;
    }
  }
  const ins = await query<{ id: number }>(
    `INSERT INTO wallet_analyses (address, status, started_at)
     VALUES ($1, 'running', $2) RETURNING id`,
    [address, Date.now()],
  );
  // 顺手修剪历史,免得反复分析的地址无限累积
  await query(
    `DELETE FROM wallet_analyses WHERE address = $1 AND id NOT IN (
       SELECT id FROM wallet_analyses WHERE address = $1
       ORDER BY started_at DESC LIMIT ${KEEP_PER_ADDRESS}
     )`,
    [address],
  );
  return ins.rows[0].id;
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

// 任务级并发限制:gatherInput 一个任务就并行发 7 路查询,批量 100 个任务
// 无界并发会挤爆连接池(max 10)。LLM 调用另有网关层的全局限流,这里限的
// 是「整个任务」。挂 globalThis 保证跨路由模块唯一
const g = globalThis as unknown as {
  __analysisTaskLimiter?: <T>(fn: () => Promise<T>) => Promise<T>;
};
function taskLimiter() {
  if (!g.__analysisTaskLimiter) {
    g.__analysisTaskLimiter = createLimiter(3, 500);
  }
  return g.__analysisTaskLimiter;
}

/** 任务入队(fire-and-forget)。所有消费方都走这里,共享任务级并发限制 */
export function queueAnalysisTask(
  id: number,
  address: string,
  caller: string,
  model?: string,
): void {
  void taskLimiter()(() => executeAnalysisTask(id, address, caller, model));
}

/**
 * 执行分析任务并写回结果。web 容器是常驻 next start 进程,进程若
 * 中途死掉,靠读侧的 STALE_MS 判定兜底。直接调用方仅限测试/脚本,
 * 线上一律经 queueAnalysisTask 入队。
 */
export async function executeAnalysisTask(
  id: number,
  address: string,
  caller: string,
  /** 逻辑模型名,缺省走网关默认(主力模型);交叉分析时由调用方指定 */
  model?: string,
): Promise<void> {
  try {
    const input = await gatherInput(address);
    const r = await chat({
      messages: [
        { role: "system", content: ANALYST_SYSTEM },
        { role: "user", content: buildAnalysisPrompt(input) },
      ],
      caller,
      refId: address,
      model,
      // 低温度:同一份数据反复分析应给出基本一致的判断,这是审计不是创作。
      // reasoning 必须显式限档:默认与 medium 档实测思考 7k-8k token,把
      // maxTokens 全部吃掉导致正文为空;low 档(约 700 token 思考、全程 25s)
      // 的报告质量经真实数据核验没有损失。maxTokens 同时约束思考与正文
      temperature: 0.3,
      maxTokens: 8192,
      timeoutMs: 120_000,
      reasoning: "low",
    });
    // 评级行剥离出结构化字段,正文入库时不再带机器行
    const extracted = extractRating(r.content);
    await query(
      `UPDATE wallet_analyses
       SET status = 'done', content = $2, model = $3, rating = $4,
           rating_reason = $5, prompt_tokens = $6, completion_tokens = $7,
           finished_at = $8
       WHERE id = $1`,
      [
        id,
        extracted?.content ?? r.content,
        r.logicalModel,
        extracted?.rating ?? null,
        extracted?.reason ?? null,
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
