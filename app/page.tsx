import { getDb } from "@/src/db";
import {
  LEADERBOARD,
  PREFILTER_MIN_TRADED,
  SCORE_MAX_POSITIONS,
  SCORE_MIN_POSITIONS,
  TOP_N,
} from "@/src/config";
import Dashboard, { type Funnel, type LeaderRow, type RunRow } from "./dashboard";

export const dynamic = "force-dynamic";

function count(sql: string): number {
  const row = getDb().prepare(sql).get() as { n: number };
  return row.n;
}

export default function HomePage() {
  const db = getDb();

  const funnel: Funnel = {
    candidates: count("SELECT COUNT(*) AS n FROM candidates"),
    prefilterPass: count(
      "SELECT COUNT(*) AS n FROM candidates WHERE passed_prefilter = 1",
    ),
    positionsFetched: count(
      "SELECT COUNT(*) AS n FROM candidates WHERE positions_fetched_at IS NOT NULL",
    ),
    closedPositions: count("SELECT COUNT(*) AS n FROM closed_positions"),
    qualified: count("SELECT COUNT(*) AS n FROM scores WHERE rank IS NOT NULL"),
  };

  const baseRows = db
    .prepare(
      `SELECT s.address, c.username, s.total_positions, s.winning_positions,
              s.win_rate, s.total_realized_pnl, s.avg_pnl, s.score, s.rank
       FROM scores s LEFT JOIN candidates c ON c.address = s.address
       WHERE s.rank IS NOT NULL
       ORDER BY s.rank`,
    )
    .all() as Array<Omit<LeaderRow, "spark">>;

  const sparkStmt = db.prepare(
    `SELECT realized_pnl FROM closed_positions
     WHERE address = ? ORDER BY timestamp DESC LIMIT 24`,
  );
  const rows: LeaderRow[] = baseRows.map((r) => ({
    ...r,
    spark: (sparkStmt.all(r.address) as Array<{ realized_pnl: number }>)
      .map((p) => p.realized_pnl)
      .reverse(),
  }));

  const runs = db
    .prepare(
      `SELECT step, started_at, finished_at, addresses_ok, addresses_failed, error
       FROM fetch_runs ORDER BY id DESC LIMIT 8`,
    )
    .all() as RunRow[];

  return (
    <Dashboard
      rows={rows}
      funnel={funnel}
      runs={runs}
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
