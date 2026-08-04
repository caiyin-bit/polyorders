import { DATA_API, PREFILTER_MIN_TRADED } from "../config";
import { getDb } from "../db";
import { createLimiter, fetchJson } from "../http";

export async function prefilter(
  force = false,
  max?: number,
): Promise<{ ok: number; failed: number }> {
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT address, leaderboard_pnl FROM candidates
       WHERE ${force ? "1=1" : "markets_traded IS NULL"}
       ORDER BY rank`,
    )
    .all() as Array<{ address: string; leaderboard_pnl: number | null }>;

  const targets = max ? pending.slice(0, max) : pending;
  if (targets.length === 0) {
    console.log("prefilter: nothing to do");
    return { ok: 0, failed: 0 };
  }

  const update = db.prepare(
    "UPDATE candidates SET markets_traded = ?, passed_prefilter = ? WHERE address = ?",
  );
  const limiter = createLimiter(5, 100);
  let ok = 0;
  let failed = 0;
  let done = 0;

  await Promise.all(
    targets.map(({ address, leaderboard_pnl }) =>
      limiter(async () => {
        try {
          const res = await fetchJson<{ traded: number }>(
            `${DATA_API}/traded?user=${address}`,
          );
          const passed =
            res.traded >= PREFILTER_MIN_TRADED && (leaderboard_pnl ?? 0) > 0
              ? 1
              : 0;
          update.run(res.traded, passed, address);
          ok++;
        } catch (err) {
          console.error(`prefilter: ${address} failed: ${String(err)}`);
          failed++;
        } finally {
          done++;
          if (done % 100 === 0) console.log(`prefilter: ${done}/${targets.length}`);
        }
      }),
    ),
  );
  return { ok, failed };
}
