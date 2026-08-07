import { query } from "../db";

// 影子成绩聚合。原先内联在 agent copystats 路由里;
// 「实时关注」弹窗也要同一份数据,抽到这里两处共用。

export async function copyStats(days: number) {
  const since = Date.now() - days * 86_400_000;

  const [byHorizon, skips, bySource, signalCounts] = await Promise.all([
    // 模拟收益:(观测价 - 模拟成交价) / 模拟成交价,按持有期聚合
    query(
      `SELECT d.strategy, m.horizon, COUNT(*)::int AS n,
              AVG((m.price - d.sim_price) / d.sim_price)::float8 AS avg_return,
              AVG(CASE WHEN m.price > d.sim_price THEN 1.0 ELSE 0.0 END)::float8 AS win_rate
       FROM copy_decisions d
       JOIN signal_marks m ON m.signal_id = d.signal_id
       WHERE d.decision = 'copy' AND d.sim_price > 0 AND m.price IS NOT NULL
         AND d.decided_at > $1
       GROUP BY d.strategy, m.horizon
       ORDER BY d.strategy, m.horizon`,
      [since],
    ),
    query(
      `SELECT skip_reason, COUNT(*)::int AS n
       FROM copy_decisions
       WHERE decision = 'skip' AND decided_at > $1
       GROUP BY skip_reason ORDER BY n DESC`,
      [since],
    ),
    // 分来源钱包:谁的信号在 24h 持有期上有肉
    query(
      `SELECT s.address, c.username, COUNT(*)::int AS copies,
              AVG((m.price - d.sim_price) / d.sim_price)::float8 AS avg_return_24h
       FROM copy_decisions d
       JOIN signals s ON s.id = d.signal_id
       LEFT JOIN candidates c ON c.address = s.address
       LEFT JOIN signal_marks m ON m.signal_id = d.signal_id AND m.horizon = '24h'
       WHERE d.decision = 'copy' AND d.sim_price > 0 AND d.decided_at > $1
       GROUP BY s.address, c.username
       ORDER BY copies DESC`,
      [since],
    ),
    query(
      `SELECT source, COUNT(*)::int AS n FROM signals
       WHERE detected_at > $1 GROUP BY source`,
      [since],
    ),
  ]);

  return {
    days,
    byHorizon: byHorizon.rows,
    skipReasons: skips.rows,
    bySourceWallet: bySource.rows,
    signalsBySource: signalCounts.rows,
  };
}
