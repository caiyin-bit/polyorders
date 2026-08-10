import { query } from "./db";
import { fetchJson } from "./http";

// 信号记录:被跟踪地址(Top20 + 关注池)的成交落入 signals 表。
// 两条写入路径:RTDS 秒级(带检测瞬间盘口)与抓取轮询(盘口留空,来源打标)。

const CLOB_API = "https://clob.polymarket.com";

export type SignalTrade = {
  conditionId: string;
  asset?: string | null;
  side: string;
  outcome?: string | null;
  price?: number | null;
  size?: number | null;
  usd?: number | null;
  title?: string | null;
  eventSlug?: string | null;
  timestamp: number; // 秒
  transactionHash: string;
};

export type BookTop = { bestBid: number | null; bestAsk: number | null };

/** 检测瞬间的买一/卖一。失败返回空——盘口是加分项,不该阻塞信号落库 */
export async function fetchBookTop(tokenId: string): Promise<BookTop> {
  try {
    const book = await fetchJson<{
      bids?: Array<{ price: string }>;
      asks?: Array<{ price: string }>;
    }>(`${CLOB_API}/book?token_id=${tokenId}`);
    const bid = Math.max(...(book.bids ?? []).map((b) => Number(b.price)));
    const ask = Math.min(...(book.asks ?? []).map((a) => Number(a.price)));
    return {
      bestBid: Number.isFinite(bid) ? bid : null,
      bestAsk: Number.isFinite(ask) ? ask : null,
    };
  } catch {
    return { bestBid: null, bestAsk: null };
  }
}

export type RecordedSignal = {
  id: number;
  conditionId: string;
  asset: string | null;
  side: string;
  outcome: string | null;
  price: number | null;
  usd: number | null;
  title: string | null;
  bestAsk: number | null;
  source: string;
  /** 检测时刻 − 成交时刻,毫秒;跟单规则据此判新鲜度 */
  lagMs: number;
};

/** 单条写入(RTDS 路径)。去重命中返回 null——同一信号只评估一次 */
export async function recordSignal(
  address: string,
  t: SignalTrade,
  source: "rtds",
  book: BookTop,
): Promise<RecordedSignal | null> {
  const detectedAt = Date.now();
  const { rows } = await query<{ id: number }>(
    `INSERT INTO signals
       (address, condition_id, asset, side, outcome, price, size, usd,
        title, event_slug, trade_ts, detected_at, source, best_bid, best_ask,
        transaction_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (address, transaction_hash, asset, side) DO NOTHING
     RETURNING id`,
    [
      address.toLowerCase(),
      t.conditionId,
      t.asset ?? null,
      t.side,
      t.outcome ?? null,
      t.price ?? null,
      t.size ?? null,
      t.usd ?? null,
      t.title ?? null,
      t.eventSlug ?? null,
      t.timestamp,
      detectedAt,
      source,
      book.bestBid,
      book.bestAsk,
      t.transactionHash,
    ],
  );
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    conditionId: t.conditionId,
    asset: t.asset ?? null,
    side: t.side,
    outcome: t.outcome ?? null,
    price: t.price ?? null,
    usd: t.usd ?? null,
    title: t.title ?? null,
    bestAsk: book.bestAsk,
    source,
    lagMs: detectedAt - t.timestamp * 1000,
  };
}

/** 批量写入(抓取轮询路径),返回真正新插入的信号(去重命中的不在内)。
 * 落库时不取盘口——是否值得为裁决补抓,由调用方按延迟决定 */
export async function recordSignalsBatch(
  address: string,
  trades: SignalTrade[],
  source: "watch" | "live",
): Promise<RecordedSignal[]> {
  if (trades.length === 0) return [];
  const now = Date.now();
  const values: unknown[] = [];
  const tuples = trades.map((t, i) => {
    values.push(
      address.toLowerCase(),
      t.conditionId,
      t.asset ?? null,
      t.side,
      t.outcome ?? null,
      t.price ?? null,
      t.size ?? null,
      t.usd ?? null,
      t.title ?? null,
      t.eventSlug ?? null,
      t.timestamp,
      now,
      source,
      t.transactionHash,
    );
    const b = i * 14;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},NULL,NULL,$${b + 14})`;
  });
  const res = await query<{
    id: number;
    condition_id: string;
    asset: string | null;
    side: string;
    outcome: string | null;
    price: number | null;
    usd: number | null;
    title: string | null;
    trade_ts: number;
  }>(
    `INSERT INTO signals
       (address, condition_id, asset, side, outcome, price, size, usd,
        title, event_slug, trade_ts, detected_at, source, best_bid, best_ask,
        transaction_hash)
     VALUES ${tuples.join(",")}
     ON CONFLICT (address, transaction_hash, asset, side) DO NOTHING
     RETURNING id, condition_id, asset, side, outcome, price, usd, title, trade_ts`,
    values,
  );
  return res.rows.map((r) => ({
    id: r.id,
    conditionId: r.condition_id,
    asset: r.asset,
    side: r.side,
    outcome: r.outcome,
    price: r.price,
    usd: r.usd,
    title: r.title,
    bestAsk: null,
    source,
    lagMs: now - r.trade_ts * 1000,
  }));
}

// ── 价格观测(marks)────────────────────────────────────────

/** 各观测点相对 detected_at 的延时(毫秒);res(结算)单独处理 */
export const HORIZON_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "1h": 3_600_000,
  "24h": 86_400_000,
};

/** 观测点到期后的重试宽限窗:超过这个窗还取不到历史价,视为市场已下线 */
export const MARK_SEAL_GRACE_MS = 86_400_000;

/**
 * 取不到价时是否记 NULL 封存(纯函数,供测试)。
 * 宽限窗内留给下轮重试;过窗必须封存——否则死信号永远占住
 * 扫描批次头部,饿死后面所有新信号(2026-08-08 线上真实发生过)。
 */
export function shouldSealNull(
  horizon: string,
  detectedAt: number,
  now: number,
): boolean {
  return now >= detectedAt + HORIZON_MS[horizon] + MARK_SEAL_GRACE_MS;
}

/** 到期且尚未标记的观测点(纯函数,供测试) */
export function dueHorizons(
  detectedAt: number,
  now: number,
  existing: ReadonlySet<string>,
): string[] {
  return Object.entries(HORIZON_MS)
    .filter(([h, ms]) => !existing.has(h) && now >= detectedAt + ms)
    .map(([h]) => h);
}

/**
 * 目标时刻的历史价:取 CLOB prices-history 里离 target 最近的点。
 * 窗口 ±15 分钟,fidelity=1(分钟级)。取不到返回 null。
 */
export async function priceAt(
  tokenId: string,
  targetMs: number,
): Promise<number | null> {
  const targetS = Math.floor(targetMs / 1000);
  try {
    const { history } = await fetchJson<{
      history: Array<{ t: number; p: number }>;
    }>(
      `${CLOB_API}/prices-history?market=${tokenId}` +
        `&startTs=${targetS - 900}&endTs=${targetS + 900}&fidelity=1`,
    );
    if (!history?.length) return null;
    let best = history[0];
    for (const pt of history) {
      if (Math.abs(pt.t - targetS) < Math.abs(best.t - targetS)) best = pt;
    }
    return best.p;
  } catch {
    return null;
  }
}
