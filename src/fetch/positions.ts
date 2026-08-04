import { DATA_API } from "../config";
import { getDb } from "../db";
import { createLimiter, fetchJson } from "../http";

type ClosedPosition = {
  conditionId: string;
  title?: string;
  outcome?: string;
  avgPrice?: number;
  totalBought?: number;
  realizedPnl: number;
  timestamp?: number;
};

const PAGE_SIZE = 50;
const MAX_OFFSET = 100_000;

export async function fetchPositions(
  force = false,
  max?: number,
): Promise<{ ok: number; failed: number }> {
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT address FROM candidates
       WHERE passed_prefilter = 1
         AND ${force ? "1=1" : "positions_fetched_at IS NULL"}
       ORDER BY rank`,
    )
    .all() as Array<{ address: string }>;

  const targets = max ? pending.slice(0, max) : pending;
  if (targets.length === 0) {
    console.log("positions: nothing to do");
    return { ok: 0, failed: 0 };
  }

  const insert = db.prepare(`
    INSERT INTO closed_positions
      (address, condition_id, title, outcome, avg_price, total_bought, realized_pnl, timestamp)
    VALUES
      (@address, @conditionId, @title, @outcome, @avgPrice, @totalBought, @realizedPnl, @timestamp)
    ON CONFLICT(address, condition_id, outcome, timestamp) DO NOTHING
  `);
  const markDone = db.prepare(
    "UPDATE candidates SET positions_fetched_at = ? WHERE address = ?",
  );
  const limiter = createLimiter(3, 250);
  let ok = 0;
  let failed = 0;
  let done = 0;

  async function fetchAddress(address: string): Promise<number> {
    let rows = 0;
    for (let offset = 0; offset < MAX_OFFSET; offset += PAGE_SIZE) {
      const page = await limiter(() =>
        fetchJson<ClosedPosition[]>(
          `${DATA_API}/closed-positions?user=${address}&limit=${PAGE_SIZE}&offset=${offset}&sortBy=TIMESTAMP&sortDirection=DESC`,
        ),
      );
      if (page.length === 0) break;
      db.transaction((items: ClosedPosition[]) => {
        for (const p of items) {
          insert.run({
            address,
            conditionId: p.conditionId,
            title: p.title ?? null,
            outcome: p.outcome ?? null,
            avgPrice: p.avgPrice ?? null,
            totalBought: p.totalBought ?? null,
            realizedPnl: p.realizedPnl,
            timestamp: p.timestamp ?? null,
          });
        }
      })(page);
      rows += page.length;
      if (rows % 5000 === 0) {
        console.log(`positions: ${address.slice(0, 10)}… ${rows} rows so far`);
      }
      if (page.length < PAGE_SIZE) break;
    }
    markDone.run(Date.now(), address);
    return rows;
  }

  await Promise.all(
    targets.map(({ address }) =>
      fetchAddress(address)
        .then((rows) => {
          ok++;
          done++;
          console.log(`positions: ${done}/${targets.length} ${address.slice(0, 10)}… rows=${rows}`);
        })
        .catch((err) => {
          console.error(`positions: ${address} failed: ${String(err)}`);
          failed++;
        }),
    ),
  );
  return { ok, failed };
}
