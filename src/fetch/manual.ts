import { SCORE_MAX_POSITIONS, SCORE_MIN_POSITIONS } from "../config";
import { query } from "../db";
import { createLimiter } from "../http";
import { fetchClosedPositionsFor } from "./positions";

// 手动加入关注池的榜单外地址:当场拉全部已平仓仓位并写出评分行,
// 让它立刻以与入围地址相同的列出现在列表(置顶「精选」,rank 为空)。
// 同时把 passed_prefilter 置真——之后每日管线把它当普通入围地址维护,
// 次日全量重算评分时若达标会自然获得正式名次。

/** 进行中的回填,防同一地址并发重复拉取(web 单进程,内存去重足够) */
const running = new Set<string>();

export async function backfillManualAddress(address: string): Promise<void> {
  if (running.has(address)) return;
  running.add(address);
  try {
    const { rows } = await query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM scores WHERE address = $1",
      [address],
    );
    if (rows[0].n > 0) return; // 已有评分行(榜单内地址),无需回填

    await query(
      `INSERT INTO candidates (address, passed_prefilter) VALUES ($1, TRUE)
       ON CONFLICT (address) DO UPDATE SET passed_prefilter = TRUE`,
      [address],
    );

    console.log(`manual: 回填 ${address.slice(0, 10)}… 开始拉取平仓仓位`);
    const n = await fetchClosedPositionsFor(address, createLimiter(3, 250));

    // 单地址评分行:聚合与打分表达式与 computeScores 完全同式,
    // 但 rank 留空——名次是全量竞争的结果,不在这里单方面授予
    await query(
      `INSERT INTO scores
         (address, total_positions, winning_positions, win_rate,
          total_realized_pnl, avg_pnl, score, rank, computed_at)
       SELECT address, total, wins, wins::float8 / total, total_pnl, avg_pnl,
              CASE WHEN total >= $2 AND total < $3
                   THEN (wins::float8 / total) * ln(total) END,
              NULL, $4
       FROM (
         SELECT address,
                COUNT(*)::int AS total,
                SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
                SUM(realized_pnl)::float8 AS total_pnl,
                AVG(realized_pnl)::float8 AS avg_pnl
         FROM closed_positions WHERE address = $1 GROUP BY address
       ) agg
       ON CONFLICT (address) DO NOTHING`,
      [address, SCORE_MIN_POSITIONS, SCORE_MAX_POSITIONS, Date.now()],
    );
    console.log(`manual: ${address.slice(0, 10)}… 回填完成,${n} 个平仓仓位`);
  } catch (err) {
    console.error(`manual: ${address} 回填失败 ${String(err)}`);
  } finally {
    running.delete(address);
  }
}
