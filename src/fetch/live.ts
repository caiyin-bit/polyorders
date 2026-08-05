import { DATA_API, TOP_N } from "../config";
import { query, withTransaction } from "../db";
import { createLimiter, fetchJson } from "../http";

type ApiOpenPosition = {
  conditionId: string;
  outcome?: string;
  size?: number;
  avgPrice?: number;
  curPrice?: number;
  initialValue?: number;
  currentValue?: number;
  cashPnl?: number;
  redeemable?: boolean;
  title?: string;
  eventSlug?: string;
};

type ApiTrade = {
  conditionId: string;
  asset?: string;
  side: string;
  price?: number;
  size?: number;
  usdcSize?: number;
  outcome?: string;
  title?: string;
  eventSlug?: string;
  transactionHash: string;
  timestamp: number;
};

const PAGE_SIZE = 100;
// 首次抓取每地址最多回填的成交条数;之后按时间戳增量
const TRADES_BACKFILL_MAX = 500;

async function fetchOpenPositions(
  limiter: ReturnType<typeof createLimiter>,
  address: string,
): Promise<ApiOpenPosition[]> {
  const all: ApiOpenPosition[] = [];
  for (let offset = 0; offset < 5000; offset += PAGE_SIZE) {
    const page = await limiter(() =>
      fetchJson<ApiOpenPosition[]>(
        `${DATA_API}/positions?user=${address}&limit=${PAGE_SIZE}&offset=${offset}`,
      ),
    );
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

const INSERT_BATCH = 100;

async function replaceOpenPositions(address: string, items: ApiOpenPosition[]) {
  const now = Date.now();
  await withTransaction(async (client) => {
    await client.query("DELETE FROM open_positions WHERE address = $1", [address]);
    for (let i = 0; i < items.length; i += INSERT_BATCH) {
      const chunk = items.slice(i, i + INSERT_BATCH);
      const values: unknown[] = [];
      const tuples = chunk.map((p, j) => {
        values.push(
          address,
          p.conditionId,
          p.outcome ?? null,
          p.size ?? null,
          p.avgPrice ?? null,
          p.curPrice ?? null,
          p.initialValue ?? null,
          p.currentValue ?? null,
          p.cashPnl ?? null,
          p.redeemable ?? null,
          p.title ?? null,
          p.eventSlug ?? null,
          now,
        );
        const b = j * 13;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`;
      });
      await client.query(
        `INSERT INTO open_positions
           (address, condition_id, outcome, size, avg_price, cur_price,
            initial_value, current_value, cash_pnl, redeemable, title, event_slug, fetched_at)
         VALUES ${tuples.join(",")}`,
        values,
      );
    }
  });
}

async function fetchNewTrades(
  limiter: ReturnType<typeof createLimiter>,
  address: string,
): Promise<number> {
  const { rows } = await query<{ since: number | null }>(
    'SELECT MAX("timestamp") AS since FROM trades WHERE address = $1',
    [address],
  );
  const since = rows[0].since;

  let inserted = 0;
  for (let offset = 0; offset < TRADES_BACKFILL_MAX; offset += PAGE_SIZE) {
    const page = await limiter(() =>
      fetchJson<ApiTrade[]>(
        `${DATA_API}/activity?user=${address}&type=TRADE&limit=${PAGE_SIZE}&offset=${offset}`,
      ),
    );
    if (page.length === 0) break;
    const fresh = since === null ? page : page.filter((t) => t.timestamp > since);
    if (fresh.length > 0) {
      // 页内按去重键去重,避免同语句冲突两次
      const byKey = new Map<string, ApiTrade>();
      for (const t of fresh) {
        byKey.set(`${t.transactionHash}|${t.asset ?? ""}|${t.side}`, t);
      }
      const rowsToInsert = [...byKey.values()];
      const values: unknown[] = [];
      const tuples = rowsToInsert.map((t, j) => {
        values.push(
          address,
          t.conditionId,
          t.asset ?? null,
          t.side,
          t.price ?? null,
          t.size ?? null,
          t.usdcSize ?? null,
          t.outcome ?? null,
          t.title ?? null,
          t.eventSlug ?? null,
          t.transactionHash,
          t.timestamp,
        );
        const b = j * 12;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`;
      });
      const res = await query(
        `INSERT INTO trades
           (address, condition_id, asset, side, price, size, usdc_size,
            outcome, title, event_slug, transaction_hash, "timestamp")
         VALUES ${tuples.join(",")}
         ON CONFLICT (address, transaction_hash, asset, side) DO NOTHING`,
        values,
      );
      inserted += res.rowCount ?? 0;
    }
    // 已翻到 since 之前或最后一页,增量完成
    if (fresh.length < page.length || page.length < PAGE_SIZE) break;
  }
  return inserted;
}

/** step 5:抓取 Top N 地址的未平仓持仓快照与新增成交 */
export async function fetchLive(): Promise<{ ok: number; failed: number }> {
  const { rows: targets } = await query<{ address: string }>(
    "SELECT address FROM scores WHERE rank IS NOT NULL ORDER BY rank LIMIT $1",
    [TOP_N],
  );
  if (targets.length === 0) {
    console.log("live: no ranked addresses, run step 4 first");
    return { ok: 0, failed: 0 };
  }

  const limiter = createLimiter(3, 250);
  let ok = 0;
  let failed = 0;

  await Promise.all(
    targets.map(async ({ address }) => {
      try {
        const positions = await fetchOpenPositions(limiter, address);
        await replaceOpenPositions(address, positions);
        const newTrades = await fetchNewTrades(limiter, address);
        ok++;
        console.log(
          `live: ${address.slice(0, 10)}… open=${positions.length} newTrades=${newTrades}`,
        );
      } catch (err) {
        failed++;
        console.error(`live: ${address} failed: ${String(err)}`);
      }
    }),
  );
  return { ok, failed };
}
