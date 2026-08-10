// 信号价格观测,由 crond 每 5 分钟触发。
// 给到期的信号补 +5m/+1h/+24h 的历史价与结算终值;顺带清理 90 天保留窗口。
// 价格来自 CLOB prices-history,错过的观测点也能回填,失败下轮重试
// (只有拿到确定结果——价格或「取不到」的判定——才落行)。
import { SIGNALS_RETENTION_DAYS } from "../src/config";
import { getPool, query } from "../src/db";
import { assertEnv } from "../src/env";
import { fetchJson } from "../src/http";
import { createLimiter } from "../src/http";
import { dueHorizons, HORIZON_MS, priceAt, shouldSealNull } from "../src/signals";

assertEnv("worker");

const CLOB_API = "https://clob.polymarket.com";
// 单轮上限:5 分钟一轮,积压会被后续轮次消化,不必一次清完
const BATCH = 300;

type PendingRow = {
  id: number;
  asset: string | null;
  condition_id: string;
  outcome: string | null;
  detected_at: number;
  marked: string[] | null;
};

async function markPriceHorizons(limiter: ReturnType<typeof createLimiter>) {
  // 最早的观测点 5 分钟到期,只扫描仍可能缺观测的时间窗
  const { rows } = await query<PendingRow>(
    `SELECT s.id, s.asset, s.condition_id, s.outcome, s.detected_at,
            array_agg(m.horizon) AS marked
     FROM signals s LEFT JOIN signal_marks m ON m.signal_id = s.id
     WHERE s.asset IS NOT NULL AND s.detected_at > $1
     GROUP BY s.id
     HAVING COUNT(m.horizon) < ${Object.keys(HORIZON_MS).length + 1}
     ORDER BY s.detected_at
     LIMIT ${BATCH}`,
    [Date.now() - SIGNALS_RETENTION_DAYS * 86_400_000],
  );

  const now = Date.now();
  let marked = 0;
  await Promise.all(
    rows.map((r) =>
      limiter(async () => {
        const existing = new Set(r.marked ?? []);
        for (const h of dueHorizons(r.detected_at, now, existing)) {
          const price = await priceAt(r.asset!, r.detected_at + HORIZON_MS[h]);
          // 取不到价:宽限窗内留给下轮重试,过窗记 NULL 封存(市场已下线)
          if (price === null && !shouldSealNull(h, r.detected_at, now)) continue;
          await query(
            `INSERT INTO signal_marks (signal_id, horizon, price, marked_at)
             VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [r.id, h, price, Date.now()],
          );
          marked++;
        }
      }),
    ),
  );
  return { scanned: rows.length, marked };
}

/** 结算观测:市场出了赢家才落行,价格是 0/1 终值 */
async function markResolutions(limiter: ReturnType<typeof createLimiter>) {
  const { rows } = await query<{ condition_id: string; ids: number[]; assets: string[] }>(
    `SELECT s.condition_id, array_agg(s.id) AS ids, array_agg(s.asset) AS assets
     FROM signals s
     WHERE s.asset IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM signal_marks m
                       WHERE m.signal_id = s.id AND m.horizon = 'res')
     GROUP BY s.condition_id
     LIMIT 100`,
  );

  let resolved = 0;
  await Promise.all(
    rows.map((r) =>
      limiter(async () => {
        let market: {
          closed?: boolean;
          tokens?: Array<{ token_id: string; winner?: boolean }>;
        };
        try {
          market = await fetchJson(`${CLOB_API}/markets/${r.condition_id}`);
        } catch {
          return;
        }
        const winners = (market.tokens ?? []).filter((t) => t.winner);
        if (!market.closed || winners.length === 0) return;
        const winnerIds = new Set(winners.map((t) => t.token_id));
        for (let i = 0; i < r.ids.length; i++) {
          await query(
            `INSERT INTO signal_marks (signal_id, horizon, price, marked_at)
             VALUES ($1,'res',$2,$3) ON CONFLICT DO NOTHING`,
            [r.ids[i], winnerIds.has(r.assets[i]) ? 1 : 0, Date.now()],
          );
          resolved++;
        }
      }),
    ),
  );
  return resolved;
}

async function prune(): Promise<number> {
  // marks 与 decisions 随 signals 级联删除
  const res = await query(`DELETE FROM signals WHERE detected_at < $1`, [
    Date.now() - SIGNALS_RETENTION_DAYS * 86_400_000,
  ]);
  return res.rowCount ?? 0;
}

const started = Date.now();
const limiter = createLimiter(4, 150);
const { scanned, marked } = await markPriceHorizons(limiter);
const resolved = await markResolutions(limiter);
const pruned = await prune();
if (scanned > 0 || resolved > 0 || pruned > 0) {
  console.log(
    `signals-mark: scanned=${scanned} marked=${marked} resolved=${resolved} pruned=${pruned} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}
await getPool().end();
