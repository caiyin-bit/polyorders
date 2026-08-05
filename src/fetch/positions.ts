import { DATA_API, SCORE_MAX_POSITIONS } from "../config";
import { query } from "../db";
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
// 熔断:拉满评分上限即停——仓位数 ≥ SCORE_MAX_POSITIONS 的地址(做市机器人)
// 必被评分剔除,拉全既浪费时间也浪费存储。调大阈值后需 --force 重抓已截断地址。
const MAX_OFFSET = SCORE_MAX_POSITIONS;

async function insertPage(address: string, items: ClosedPosition[]) {
  // 页内按去重键去重,避免同一语句对同一行冲突两次
  const byKey = new Map<string, ClosedPosition>();
  for (const p of items) byKey.set(`${p.conditionId}|${p.outcome ?? ""}`, p);
  const rows = [...byKey.values()];

  const values: unknown[] = [];
  const tuples = rows.map((p, i) => {
    values.push(
      address,
      p.conditionId,
      p.title ?? null,
      p.outcome ?? null,
      p.avgPrice ?? null,
      p.totalBought ?? null,
      p.realizedPnl,
      p.timestamp ?? null,
    );
    const b = i * 8;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
  });

  await query(
    `INSERT INTO closed_positions
       (address, condition_id, title, outcome, avg_price, total_bought, realized_pnl, "timestamp")
     VALUES ${tuples.join(",")}
     ON CONFLICT (address, condition_id, outcome) DO UPDATE SET
       title = EXCLUDED.title,
       avg_price = EXCLUDED.avg_price,
       total_bought = EXCLUDED.total_bought,
       realized_pnl = EXCLUDED.realized_pnl,
       "timestamp" = EXCLUDED."timestamp"`,
    values,
  );
}

export async function fetchPositions(
  force = false,
  max?: number,
): Promise<{ ok: number; failed: number }> {
  const { rows: pending } = await query<{ address: string }>(
    `SELECT address FROM candidates
     WHERE passed_prefilter
       AND ${force ? "TRUE" : "positions_fetched_at IS NULL"}
     ORDER BY rank`,
  );

  const targets = max ? pending.slice(0, max) : pending;
  if (targets.length === 0) {
    console.log("positions: nothing to do");
    return { ok: 0, failed: 0 };
  }

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
      await insertPage(address, page);
      rows += page.length;
      if (rows % 5000 === 0) {
        console.log(`positions: ${address.slice(0, 10)}… ${rows} rows so far`);
      }
      if (page.length < PAGE_SIZE) break;
      if (rows >= MAX_OFFSET) {
        console.log(`positions: ${address.slice(0, 10)}… 截断于 ${rows} 行(≥评分上限)`);
        break;
      }
    }
    await query(
      "UPDATE candidates SET positions_fetched_at = $1 WHERE address = $2",
      [Date.now(), address],
    );
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
