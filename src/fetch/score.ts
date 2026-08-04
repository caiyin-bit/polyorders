import { SCORE_MAX_POSITIONS, SCORE_MIN_POSITIONS } from "../config";
import { getDb } from "../db";

type Aggregate = {
  address: string;
  total: number;
  wins: number;
  totalPnl: number | null;
  avgPnl: number | null;
};

function isQualified(total: number): boolean {
  return total >= SCORE_MIN_POSITIONS && total < SCORE_MAX_POSITIONS;
}

export function computeScores(): { total: number; qualified: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT address,
              COUNT(*) AS total,
              SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) AS wins,
              SUM(realized_pnl) AS totalPnl,
              AVG(realized_pnl) AS avgPnl
       FROM closed_positions
       GROUP BY address`,
    )
    .all() as Aggregate[];

  const qualified = rows
    .filter((r) => isQualified(r.total))
    .map((r) => ({
      ...r,
      score: (r.wins / r.total) * Math.log(r.total),
    }))
    .sort((a, b) => b.score - a.score);
  const rankOf = new Map(qualified.map((r, i) => [r.address, i + 1]));

  const insert = db.prepare(`
    INSERT INTO scores
      (address, total_positions, winning_positions, win_rate, total_realized_pnl, avg_pnl, score, rank, computed_at)
    VALUES
      (@address, @total, @wins, @winRate, @totalPnl, @avgPnl, @score, @rank, @computedAt)
  `);

  const now = Date.now();
  db.transaction(() => {
    db.prepare("DELETE FROM scores").run();
    for (const r of rows) {
      const rank = rankOf.get(r.address) ?? null;
      insert.run({
        address: r.address,
        total: r.total,
        wins: r.wins,
        winRate: r.total > 0 ? r.wins / r.total : 0,
        totalPnl: r.totalPnl,
        avgPnl: r.avgPnl,
        score: isQualified(r.total)
          ? (r.wins / r.total) * Math.log(r.total)
          : null,
        rank,
        computedAt: now,
      });
    }
  })();

  console.log(
    `score: ${rows.length} addresses, ${qualified.length} qualified (${SCORE_MIN_POSITIONS}–${SCORE_MAX_POSITIONS} positions)`,
  );
  return { total: rows.length, qualified: qualified.length };
}
