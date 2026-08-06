import { OrderSide, type Market } from "@polymarket/client";
import { query } from "../db";
import { getTradeClient } from "./client";
import { checkLimits, tradeLimits } from "./risk";

export type OrderRequest = {
  /** conditionId(0x 开头 66 位)、市场 slug,或 Polymarket 页面 URL */
  market: string;
  outcome: "yes" | "no";
  side: "BUY" | "SELL";
  /** BUY 必填:美元名义 */
  amountUsd?: number;
  /** SELL 必填:卖出份额 */
  shares?: number;
  /** 填写则下 GTC 限价单;留空为市价单 */
  limitPrice?: number;
  /** 第二期跟单时标记来源地址 */
  sourceAddress?: string;
};

export type OrderResult = {
  id: number;
  status: string;
  dryRun: boolean;
  tokenId: string | null;
  price: number | null;
  size: number | null;
  amountUsd: number | null;
  clobOrderId: string | null;
  clobStatus: string | null;
  error: string | null;
};

/** pg 会对 JSONB 参数做 JSON.stringify,BigInt 会抛错,先转成字符串 */
function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

function decimalsForTick(tick: number): number {
  return Math.max(2, Math.round(-Math.log10(tick)));
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** 份额一律向下取整到 2 位:宁可少买/少卖,也不要因超量被拒 */
function floorShares(value: number): number {
  return Math.floor(value * 100) / 100;
}

type TradeClient = Awaited<ReturnType<typeof getTradeClient>>;

/** 支持三种市场写法:conditionId / slug / 页面 URL */
async function resolveMarket(
  client: TradeClient,
  ref: string,
): Promise<Market | undefined> {
  if (/^0x[0-9a-fA-F]{64}$/.test(ref)) {
    const { items } = await client
      .listMarkets({ conditionIds: [ref] })
      .firstPage();
    return items[0];
  }
  if (/^https?:\/\//.test(ref)) return client.fetchMarket({ url: ref });
  return client.fetchMarket({ slug: ref });
}

type Recorded = Omit<OrderResult, "id"> & {
  request: OrderRequest;
  market?: Market | null;
  response?: unknown;
};

async function record(r: Recorded): Promise<OrderResult> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO orders
       (source_address, condition_id, token_id, market_slug, title, outcome,
        side, order_type, price, size, amount_usd, status, dry_run,
        clob_order_id, clob_status, error, request_json, response_json, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      r.request.sourceAddress ?? null,
      r.market?.conditionId ?? r.request.market,
      r.tokenId,
      r.market?.slug ?? null,
      r.market?.question ?? null,
      r.request.outcome,
      r.request.side,
      r.request.limitPrice ? "GTC" : "FAK",
      r.price,
      r.size,
      r.amountUsd,
      r.status,
      r.dryRun,
      r.clobOrderId,
      r.clobStatus,
      r.error,
      jsonSafe(r.request),
      r.response === undefined ? null : jsonSafe(r.response),
      Date.now(),
    ],
  );
  return {
    id: rows[0].id,
    status: r.status,
    dryRun: r.dryRun,
    tokenId: r.tokenId,
    price: r.price,
    size: r.size,
    amountUsd: r.amountUsd,
    clobOrderId: r.clobOrderId,
    clobStatus: r.clobStatus,
    error: r.error,
  };
}

const EMPTY = {
  tokenId: null,
  price: null,
  size: null,
  amountUsd: null,
  clobOrderId: null,
  clobStatus: null,
  error: null,
} satisfies Omit<OrderResult, "id" | "status" | "dryRun">;

/**
 * 下单主流程。无论成功、被风控拦截还是失败,都会在 orders 表留下一条记录。
 *
 * TRADING_ENABLED 未显式为 "true" 时降级为 dry-run:订单会被真实签名
 * (从而校验 tokenId、精度与费用),但不提交给 CLOB。
 */
export async function placeOrder(req: OrderRequest): Promise<OrderResult> {
  const dryRun = !tradeLimits().enabled;

  const client = await getTradeClient();
  const market = await resolveMarket(client, req.market).catch(() => undefined);
  if (!market) {
    return record({
      ...EMPTY,
      request: req,
      status: "failed",
      dryRun,
      error: `未找到市场:${req.market}`,
    });
  }

  const tokenId = market.outcomes[req.outcome].tokenId;
  if (!tokenId) {
    return record({
      ...EMPTY,
      request: req,
      market,
      status: "failed",
      dryRun,
      error: `市场 ${req.outcome} 侧没有可交易的 tokenId`,
    });
  }
  if (market.state.closed || market.state.acceptingOrders === false) {
    return record({
      ...EMPTY,
      request: req,
      market,
      tokenId,
      status: "failed",
      dryRun,
      error: "市场已关闭或暂不接受订单",
    });
  }

  const tick = Number(market.trading.minimumTickSize ?? 0.01);
  const priceDecimals = decimalsForTick(tick);
  const price = req.limitPrice ? roundTo(req.limitPrice, priceDecimals) : null;
  const size = req.shares ? floorShares(req.shares) : null;

  // 美元敞口(供风控):限价单一律按 份额 × 限价——限价买单不传金额,
  // 若按 amountUsd 取会得到 0 而被误判为无效单。市价买单用美元名义,
  // 市价卖单用当前买一价折算。
  const refPrice = Number(
    market.prices.bestBid ?? market.outcomes[req.outcome].price ?? 0,
  );
  const amountUsd =
    price !== null && size !== null
      ? size * price
      : req.side === "BUY"
        ? (req.amountUsd ?? 0)
        : (size ?? 0) * refPrice;

  const minSize = Number(market.trading.minimumOrderSize ?? 0);
  if (size !== null && minSize > 0 && size < minSize) {
    return record({
      ...EMPTY,
      request: req,
      market,
      tokenId,
      price,
      size,
      amountUsd,
      status: "failed",
      dryRun,
      error: `份额 ${size} 低于市场最小下单量 ${minSize}`,
    });
  }

  const blocked = await checkLimits(amountUsd);
  if (blocked) {
    return record({
      ...EMPTY,
      request: req,
      market,
      tokenId,
      price,
      size,
      amountUsd,
      status: "blocked",
      dryRun,
      error: blocked,
    });
  }

  const side = req.side === "BUY" ? OrderSide.BUY : OrderSide.SELL;
  const common = { ...EMPTY, request: req, market, tokenId, price, size, amountUsd };

  try {
    if (price !== null) {
      // 限价单:size 必填
      if (size === null) {
        return record({ ...common, status: "failed", dryRun, error: "限价单必须指定份额" });
      }
      const params = { tokenId, price, size, side };
      if (dryRun) {
        const signed = await client.createLimitOrder(params);
        return record({ ...common, status: "dry_run", dryRun, response: signed });
      }
      const res = await client.placeLimitOrder(params);
      return record({
        ...common,
        status: res.ok ? "submitted" : "rejected",
        dryRun,
        clobOrderId: res.ok ? res.orderId : null,
        clobStatus: res.ok ? res.status : null,
        error: res.ok ? null : `${res.code}: ${res.message}`,
        response: res,
      });
    }

    // 市价单:BUY 按美元名义,SELL 按份额。maxSpend 卡住含手续费的总支出,
    // 确保任何情况下单笔实际花费都不越过风控上限。
    const params =
      req.side === "BUY"
        ? {
            tokenId,
            side: OrderSide.BUY as const,
            amount: amountUsd,
            maxSpend: tradeLimits().maxUsd,
          }
        : { tokenId, side: OrderSide.SELL as const, shares: size ?? 0 };

    if (req.side === "SELL" && !size) {
      return record({ ...common, status: "failed", dryRun, error: "卖出必须指定份额" });
    }

    if (dryRun) {
      const signed = await client.createMarketOrder(params);
      return record({ ...common, status: "dry_run", dryRun, response: signed });
    }
    const res = await client.placeMarketOrder(params);
    return record({
      ...common,
      status: res.ok ? "submitted" : "rejected",
      dryRun,
      clobOrderId: res.ok ? res.orderId : null,
      clobStatus: res.ok ? res.status : null,
      error: res.ok ? null : `${res.code}: ${res.message}`,
      response: res,
    });
  } catch (err) {
    return record({ ...common, status: "failed", dryRun, error: String(err) });
  }
}
