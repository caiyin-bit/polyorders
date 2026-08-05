import { query } from "@/src/db";
import {
  LEADERBOARD,
  PREFILTER_MIN_TRADED,
  SCORE_MAX_POSITIONS,
  SCORE_MIN_POSITIONS,
  TOP_N,
} from "@/src/config";
import Dashboard, {
  type FeedTrade,
  type Funnel,
  type LeaderRow,
} from "../dashboard";

// ISR:数据由每日定时抓取更新,5 分钟缓存足够新鲜;dev 模式不受影响仍实时
export const revalidate = 300;

export default async function HomePage() {
  const [funnelRes, rowsRes, sparkRes, feedRes] = await Promise.all([
    query<{
      candidates: number;
      prefilter_pass: number;
      positions_fetched: number;
      closed_positions: number;
      qualified: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM candidates) AS candidates,
         (SELECT COUNT(*)::int FROM candidates WHERE passed_prefilter) AS prefilter_pass,
         (SELECT COUNT(*)::int FROM candidates WHERE positions_fetched_at IS NOT NULL) AS positions_fetched,
         (SELECT COALESCE(SUM(total_positions), 0)::int FROM scores) AS closed_positions,
         (SELECT COUNT(*)::int FROM scores WHERE rank IS NOT NULL) AS qualified`,
    ),
    query<Omit<LeaderRow, "spark">>(
      `SELECT s.address, c.username, s.total_positions, s.winning_positions,
              s.win_rate, s.total_realized_pnl, s.avg_pnl, s.score, s.rank
       FROM scores s LEFT JOIN candidates c ON c.address = s.address
       WHERE s.rank IS NOT NULL
       ORDER BY s.rank`,
    ),
    query<{ address: string; realized_pnl: number }>(
      `SELECT s.address, sp.realized_pnl
       FROM scores s
       CROSS JOIN LATERAL (
         SELECT realized_pnl, "timestamp"
         FROM closed_positions cp
         WHERE cp.address = s.address
         ORDER BY "timestamp" DESC NULLS LAST
         LIMIT 24
       ) sp
       WHERE s.rank IS NOT NULL
       ORDER BY s.address, sp."timestamp" ASC`,
    ),
    query<FeedTrade>(
      // Top N 每个地址各取最近 3 笔成交,用于榜单行内「最新动向」
      `SELECT s.address, t.side, t.price, t.usdc_size, t.outcome,
              t.title, t.event_slug, t."timestamp"
       FROM scores s
       CROSS JOIN LATERAL (
         SELECT side, price, usdc_size, outcome, title, event_slug, "timestamp"
         FROM trades
         WHERE address = s.address
         ORDER BY "timestamp" DESC
         LIMIT 3
       ) t
       WHERE s.rank <= $1
       ORDER BY s.rank, t."timestamp" DESC`,
      [TOP_N],
    ),
  ]);

  const f = funnelRes.rows[0];
  const funnel: Funnel = {
    candidates: f.candidates,
    prefilterPass: f.prefilter_pass,
    positionsFetched: f.positions_fetched,
    closedPositions: f.closed_positions,
    qualified: f.qualified,
  };

  const sparkMap = new Map<string, number[]>();
  for (const r of sparkRes.rows) {
    let arr = sparkMap.get(r.address);
    if (!arr) sparkMap.set(r.address, (arr = []));
    arr.push(r.realized_pnl);
  }
  const rows: LeaderRow[] = rowsRes.rows.map((r) => ({
    ...r,
    spark: sparkMap.get(r.address) ?? [],
  }));

  return (
    <Dashboard
      rows={rows}
      funnel={funnel}
      feed={feedRes.rows}
      config={{
        topN: TOP_N,
        leaderboardPages: LEADERBOARD.maxOffset / LEADERBOARD.pageSize,
        timePeriod: LEADERBOARD.timePeriod,
        minTraded: PREFILTER_MIN_TRADED,
        minPositions: SCORE_MIN_POSITIONS,
        maxPositions: SCORE_MAX_POSITIONS,
      }}
    />
  );
}
