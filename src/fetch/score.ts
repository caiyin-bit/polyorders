import { SCORE_MAX_POSITIONS, SCORE_MIN_POSITIONS } from "../config";
import { withTransaction } from "../db";

export async function computeScores(): Promise<{
  total: number;
  qualified: number;
}> {
  const now = Date.now();
  return withTransaction(async (client) => {
    await client.query("DELETE FROM scores");
    const res = await client.query(
      `WITH agg AS (
         SELECT address,
                COUNT(*)::int AS total,
                SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
                SUM(realized_pnl)::float8 AS total_pnl,
                AVG(realized_pnl)::float8 AS avg_pnl
         FROM closed_positions
         GROUP BY address
       ), scored AS (
         SELECT *,
                CASE WHEN total >= $1 AND total < $2
                     THEN (wins::float8 / total) * ln(total) END AS score
         FROM agg
       ), ranked AS (
         SELECT *,
                CASE WHEN score IS NOT NULL
                     THEN (row_number() OVER (ORDER BY score DESC NULLS LAST))::int
                END AS rank
         FROM scored
       )
       INSERT INTO scores
         (address, total_positions, winning_positions, win_rate,
          total_realized_pnl, avg_pnl, score, rank, computed_at)
       SELECT address, total, wins, wins::float8 / total,
              total_pnl, avg_pnl, score, rank, $3
       FROM ranked`,
      [SCORE_MIN_POSITIONS, SCORE_MAX_POSITIONS, now],
    );
    const total = res.rowCount ?? 0;
    const q = await client.query(
      "SELECT COUNT(*)::int AS n FROM scores WHERE rank IS NOT NULL",
    );
    const qualified = q.rows[0].n as number;
    console.log(
      `score: ${total} addresses, ${qualified} qualified (${SCORE_MIN_POSITIONS}–${SCORE_MAX_POSITIONS} positions)`,
    );
    return { total, qualified };
  });
}
