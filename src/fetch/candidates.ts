import { DATA_API, LEADERBOARD } from "../config";
import { getDb } from "../db";
import { fetchJson } from "../http";

type LeaderboardEntry = {
  rank: string;
  proxyWallet: string;
  userName?: string;
  vol?: number;
  pnl?: number;
};

export async function fetchCandidates(force = false): Promise<number> {
  const db = getDb();
  if (!force) {
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM candidates")
      .get() as { n: number };
    if (n > 0) {
      console.log(`candidates: skip, ${n} rows exist (use --force to refetch)`);
      return n;
    }
  }

  const insert = db.prepare(`
    INSERT INTO candidates (address, username, leaderboard_pnl, leaderboard_vol, rank, fetched_at)
    VALUES (@address, @username, @pnl, @vol, @rank, @fetchedAt)
    ON CONFLICT(address) DO UPDATE SET
      username = excluded.username,
      leaderboard_pnl = excluded.leaderboard_pnl,
      leaderboard_vol = excluded.leaderboard_vol,
      rank = excluded.rank,
      fetched_at = excluded.fetched_at
  `);

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
    db.transaction((items: LeaderboardEntry[]) => {
      for (const r of items) {
        insert.run({
          address: r.proxyWallet,
          username: r.userName ?? null,
          pnl: r.pnl ?? null,
          vol: r.vol ?? null,
          rank: Number(r.rank),
          fetchedAt: now,
        });
      }
    })(rows);

    total += rows.length;
    console.log(`candidates: offset=${offset} got=${rows.length}`);
    if (rows.length < LEADERBOARD.pageSize) break;
  }
  return total;
}
