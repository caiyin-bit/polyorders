import { TRADE_FEE_BUFFER } from "../config";
import { query } from "../db";
import { watcherStatus, type WatcherStateRow } from "../watchlist";

// 影子成绩聚合。原先内联在 agent copystats 路由里;
// 「实时关注」弹窗也要同一份数据,抽到这里两处共用。

export const COPY_READINESS = {
  minDays: 14,
  minResolved: 200,
  maxWalletShare: 0.5,
  minRtdsStableMs: 24 * 3_600_000,
} as const;

/** 正态近似均值区间只在大样本下展示,避免小样本精度错觉。 */
export const MIN_CI_SAMPLES = 30;

export function shouldReportNormalCi(n: number): boolean {
  return n >= MIN_CI_SAMPLES;
}

export type CopyReadinessMetrics = {
  observedDays: number;
  resolvedExecutable: number;
  netAvgReturn: number | null;
  maxWalletShare: number | null;
  rtdsLive: boolean;
  rtdsConnectedForMs: number;
};

export type CopyReadinessCheck = {
  key: "days" | "resolved" | "return" | "concentration" | "rtds";
  pass: boolean;
  value: number | boolean | null;
  target: number | boolean;
};

/** 毛收益扣掉买入侧保守费用后的资金收益率 */
export function feeAdjustedReturn(grossReturn: number): number {
  return (1 + grossReturn) / (1 + TRADE_FEE_BUFFER) - 1;
}

export function isExecutableOutcome(outcome: string | null): boolean {
  const normalized = outcome?.toLowerCase();
  return normalized === "yes" || normalized === "no";
}

export function evaluateCopyReadiness(metrics: CopyReadinessMetrics) {
  const checks: CopyReadinessCheck[] = [
    {
      key: "days",
      pass: metrics.observedDays >= COPY_READINESS.minDays,
      value: metrics.observedDays,
      target: COPY_READINESS.minDays,
    },
    {
      key: "resolved",
      pass: metrics.resolvedExecutable >= COPY_READINESS.minResolved,
      value: metrics.resolvedExecutable,
      target: COPY_READINESS.minResolved,
    },
    {
      key: "return",
      pass: metrics.netAvgReturn !== null && metrics.netAvgReturn > 0,
      value: metrics.netAvgReturn,
      target: 0,
    },
    {
      key: "concentration",
      pass:
        metrics.maxWalletShare !== null &&
        metrics.maxWalletShare < COPY_READINESS.maxWalletShare,
      value: metrics.maxWalletShare,
      target: COPY_READINESS.maxWalletShare,
    },
    {
      key: "rtds",
      pass:
        metrics.rtdsLive &&
        metrics.rtdsConnectedForMs >= COPY_READINESS.minRtdsStableMs,
      value: metrics.rtdsLive ? metrics.rtdsConnectedForMs : false,
      target: COPY_READINESS.minRtdsStableMs,
    },
  ];
  return { ready: checks.every((c) => c.pass), checks, metrics };
}

export async function copyStats(days: number) {
  const since = Date.now() - days * 86_400_000;
  const now = Date.now();
  const costMultiplier = 1 + TRADE_FEE_BUFFER;

  const [byHorizon, skips, bySource, signalCounts, readinessRes, watcherRes] =
    await Promise.all([
    // 同时保留全部 shadow 样本与当前实盘可执行的 yes/no 子集。
    // net_return 以含 4% 保守买入费用的总支出为分母。
    query(
      `WITH returns AS (
         SELECT d.strategy, m.horizon, s.outcome,
                ((m.price - d.sim_price) / d.sim_price)::float8 AS gross_return,
                (m.price / d.sim_price / $2::float8 - 1)::float8 AS net_return
         FROM copy_decisions d
         JOIN signals s ON s.id = d.signal_id
         JOIN signal_marks m ON m.signal_id = d.signal_id
         WHERE d.decision = 'copy' AND d.sim_price > 0 AND m.price IS NOT NULL
           AND d.decided_at > $1
       ), segmented AS (
         SELECT strategy, horizon, 'all'::text AS segment, gross_return, net_return
         FROM returns
         UNION ALL
         SELECT strategy, horizon, 'executable'::text, gross_return, net_return
         FROM returns WHERE lower(outcome) IN ('yes', 'no')
       )
       SELECT strategy, segment, horizon, COUNT(*)::int AS n,
              AVG(gross_return)::float8 AS avg_return,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY gross_return))::float8
                AS median_return,
              AVG(net_return)::float8 AS net_avg_return,
              CASE WHEN COUNT(*) >= $3::int THEN
                (AVG(net_return) - 1.96 * STDDEV_SAMP(net_return) /
                  sqrt(COUNT(*)::float8))::float8 END AS net_ci_low,
              CASE WHEN COUNT(*) >= $3::int THEN
                (AVG(net_return) + 1.96 * STDDEV_SAMP(net_return) /
                  sqrt(COUNT(*)::float8))::float8 END AS net_ci_high,
              AVG(CASE WHEN gross_return > 0 THEN 1.0 ELSE 0.0 END)::float8
                AS win_rate
       FROM segmented
       GROUP BY strategy, segment, horizon
       ORDER BY strategy, segment DESC, horizon`,
      [since, costMultiplier, MIN_CI_SAMPLES],
    ),
    query(
      `SELECT skip_reason, COUNT(*)::int AS n
       FROM copy_decisions
       WHERE decision = 'skip' AND decided_at > $1
       GROUP BY skip_reason ORDER BY n DESC`,
      [since],
    ),
    // 保留旧的 copies/24h 字段兼容 Agent 消费方,同时补当前能下单的
    // yes/no 子集结算表现。
    query(
      `WITH wallet_stats AS (
         SELECT s.address, c.username, COUNT(*)::int AS copies,
                (AVG((m24.price - d.sim_price) / d.sim_price)
                  FILTER (WHERE m24.price IS NOT NULL))::float8 AS avg_return_24h,
                (COUNT(*) FILTER (WHERE lower(s.outcome) IN ('yes', 'no')))::int
                  AS executable_copies,
                (COUNT(mres.price) FILTER
                  (WHERE lower(s.outcome) IN ('yes', 'no')))::int AS resolved,
                (AVG((mres.price - d.sim_price) / d.sim_price) FILTER
                  (WHERE lower(s.outcome) IN ('yes', 'no')
                     AND mres.price IS NOT NULL))::float8 AS avg_return_res,
                (AVG(mres.price / d.sim_price / $2::float8 - 1) FILTER
                  (WHERE lower(s.outcome) IN ('yes', 'no')
                     AND mres.price IS NOT NULL))::float8 AS net_avg_return_res
         FROM copy_decisions d
         JOIN signals s ON s.id = d.signal_id
         LEFT JOIN candidates c ON c.address = s.address
         LEFT JOIN signal_marks m24 ON m24.signal_id = d.signal_id
                                   AND m24.horizon = '24h'
         LEFT JOIN signal_marks mres ON mres.signal_id = d.signal_id
                                    AND mres.horizon = 'res'
         WHERE d.decision = 'copy' AND d.sim_price > 0 AND d.decided_at > $1
         GROUP BY s.address, c.username
       )
       SELECT *,
              (resolved::float8 /
                NULLIF(SUM(resolved) OVER (), 0)::float8)::float8 AS resolved_share
       FROM wallet_stats
       ORDER BY copies DESC`,
      [since, costMultiplier],
    ),
    query(
      `SELECT source, COUNT(*)::int AS n FROM signals
       WHERE detected_at > $1 GROUP BY source`,
      [since],
    ),
    // Readiness 固定看保留窗内全部可执行样本,不随 UI 的 days 筛选漂移。
    query<{
      observed_days: number;
      resolved_executable: number;
      net_avg_return: number | null;
      max_wallet_share: number | null;
    }>(
      `WITH copies AS (
         SELECT d.decided_at, d.sim_price, s.address, s.id AS signal_id
         FROM copy_decisions d JOIN signals s ON s.id = d.signal_id
         WHERE d.decision = 'copy' AND d.sim_price > 0
           AND lower(s.outcome) IN ('yes', 'no')
       ), resolved AS (
         SELECT c.address,
                (m.price / c.sim_price / $1::float8 - 1)::float8 AS net_return
         FROM copies c JOIN signal_marks m ON m.signal_id = c.signal_id
         WHERE m.horizon = 'res' AND m.price IS NOT NULL
       ), wallet_counts AS (
         SELECT address, COUNT(*)::int AS n FROM resolved GROUP BY address
       ), copy_summary AS (
         SELECT COUNT(DISTINCT
                  (to_timestamp(decided_at / 1000.0)
                    AT TIME ZONE 'Asia/Shanghai')::date)::int AS observed_days
         FROM copies
       ), return_summary AS (
         SELECT COUNT(*)::int AS n, AVG(net_return)::float8 AS net_avg FROM resolved
       ), wallet_summary AS (
         SELECT MAX(n)::float8 / NULLIF(SUM(n), 0)::float8 AS max_share
         FROM wallet_counts
       )
       SELECT copy_summary.observed_days::float8 AS observed_days,
              return_summary.n AS resolved_executable,
              return_summary.net_avg AS net_avg_return,
              wallet_summary.max_share AS max_wallet_share
       FROM copy_summary CROSS JOIN return_summary CROSS JOIN wallet_summary`,
      [costMultiplier],
    ),
    query<WatcherStateRow>(
      `SELECT connected, connected_at, last_heartbeat_at, last_event_at
       FROM watcher_state WHERE id = 1`,
    ),
  ]);

  const rawWatcher = watcherRes.rows[0];
  const watcher = rawWatcher
    ? watcherStatus(rawWatcher, now)
    : { live: false, connectedSince: null, lastHeartbeatAt: null, lastEventAt: null };
  const rawReadiness = readinessRes.rows[0];
  const readiness = evaluateCopyReadiness({
    observedDays: rawReadiness?.observed_days ?? 0,
    resolvedExecutable: rawReadiness?.resolved_executable ?? 0,
    netAvgReturn: rawReadiness?.net_avg_return ?? null,
    maxWalletShare: rawReadiness?.max_wallet_share ?? null,
    rtdsLive: watcher.live,
    rtdsConnectedForMs:
      watcher.live && watcher.connectedSince !== null
        ? Math.max(0, now - watcher.connectedSince)
        : 0,
  });

  return {
    days,
    feeRate: TRADE_FEE_BUFFER,
    // 旧字段继续只返回全部样本;新字段承载当前可实盘子集,避免 Agent
    // 消费方升级前把两组行误当成一个总体重复累计。
    byHorizon: byHorizon.rows.filter((r) => r.segment === "all"),
    executableByHorizon: byHorizon.rows.filter(
      (r) => r.segment === "executable",
    ),
    skipReasons: skips.rows,
    bySourceWallet: bySource.rows,
    signalsBySource: signalCounts.rows,
    readiness,
  };
}
