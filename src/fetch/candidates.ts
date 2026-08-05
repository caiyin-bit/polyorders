import { DATA_API, LEADERBOARD } from "../config";
import { query, withTransaction } from "../db";
import { fetchJson } from "../http";

type LeaderboardEntry = {
  rank: string;
  proxyWallet: string;
  userName?: string;
  vol?: number;
  pnl?: number;
};

export async function fetchCandidates(force = false): Promise<number> {
  if (!force) {
    const { rows } = await query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM candidates",
    );
    if (rows[0].n > 0) {
      console.log(`candidates: skip, ${rows[0].n} rows exist (use --force to refetch)`);
      return rows[0].n;
    }
  }

  let total = 0;
  for (
    let offset = 0;
    offset < LEADERBOARD.maxOffset;
    offset += LEADERBOARD.pageSize
  ) {
    const url =
      `${DATA_API}/v1/leaderboard?timePeriod=${LEADERBOARD.timePeriod}` +
      `&orderBy=${LEADERBOARD.orderBy}&limit=${LEADERBOARD.pageSize}&offset=${offset}`;
    const rows = await fetchJson<LeaderboardEntry[]>(url);
    if (rows.length === 0) break;

    const now = Date.now();
    await withTransaction(async (client) => {
      for (const r of rows) {
        await client.query(
          `INSERT INTO candidates (address, username, leaderboard_pnl, leaderboard_vol, rank, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (address) DO UPDATE SET
             username = EXCLUDED.username,
             leaderboard_pnl = EXCLUDED.leaderboard_pnl,
             leaderboard_vol = EXCLUDED.leaderboard_vol,
             rank = EXCLUDED.rank,
             fetched_at = EXCLUDED.fetched_at`,
          [
            r.proxyWallet,
            r.userName ?? null,
            r.pnl ?? null,
            r.vol ?? null,
            Number(r.rank),
            now,
          ],
        );
      }
    });

    total += rows.length;
    console.log(`candidates: offset=${offset} got=${rows.length}`);
    if (rows.length < LEADERBOARD.pageSize) break;
  }
  return total;
}
