import { DATA_API, PREFILTER_MIN_TRADED } from "../config";
import { query } from "../db";
import { createLimiter, fetchJson } from "../http";

export async function prefilter(
  force = false,
  max?: number,
): Promise<{ ok: number; failed: number }> {
  const { rows: pending } = await query<{
    address: string;
    leaderboard_pnl: number | null;
  }>(
    `SELECT address, leaderboard_pnl FROM candidates
     WHERE ${force ? "TRUE" : "markets_traded IS NULL"}
     ORDER BY rank`,
  );

  const targets = max ? pending.slice(0, max) : pending;
  if (targets.length === 0) {
    console.log("prefilter: nothing to do");
    return { ok: 0, failed: 0 };
  }

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
            res.traded >= PREFILTER_MIN_TRADED && (leaderboard_pnl ?? 0) > 0;
          await query(
            "UPDATE candidates SET markets_traded = $1, passed_prefilter = $2 WHERE address = $3",
            [res.traded, passed, address],
          );
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
