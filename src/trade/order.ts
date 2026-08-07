import { OrderSide, type Market } from "@polymarket/client";
import { TRADE_FEE_BUFFER } from "../config";
import { query } from "../db";
import { sendAlert } from "../telegram";
import { getTradeClient } from "./client";
import { expirationTs, orderTypeOf, parseDuration } from "./expiry";
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
  /** 填写则下限价单;留空为市价单 */
  limitPrice?: number;
  /** 限价单有效期:分钟数或 "30m"/"2h"/"1d";留空为挂到撤销为止(GTC) */
  expiresIn?: string | number;
  /** 只做 maker:若会立即吃单则由交易所直接拒绝,用于规避吃单手续费 */
  postOnly?: boolean;
  /** 第二期跟单时标记来源地址 */
  sourceAddress?: string;
  /** 由 agent 发起时记录是哪个 agent,便于审计 */
  agentId?: number;
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

// 以下四个纯函数导出供测试:价格精度、份额取整与敞口折算算错,
// 轻则被交易所拒单,重则突破风控限额。

export function decimalsForTick(tick: number): number {
  return Math.max(2, Math.round(-Math.log10(tick)));
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** 份额一律向下取整到 2 位:宁可少买/少卖,也不要因超量被拒 */
export function floorShares(value: number): number {
  return Math.floor(value * 100) / 100;
}

/**
 * 风控口径的美元敞口。
 *
 * 限价单一律按 份额 × 限价——限价买单不传 amountUsd,按它取会得到 0 而被
 * 当成无效单放行(此处曾出过 bug)。市价买单用美元名义,市价卖单用买一价折算。
 */
export function exposureUsd(args: {
  side: "BUY" | "SELL";
  price: number | null;
  size: number | null;
  amountUsd?: number;
  refPrice: number;
}): number {
  const { side, price, size, amountUsd, refPrice } = args;
  if (price !== null && size !== null) return size * price;
  if (side === "BUY") return amountUsd ?? 0;
  return (size ?? 0) * refPrice;
}

/**
 * 计入手续费的实际支出估计,风控与日累计按它计。
 *
 * 只有买单会因手续费多花钱(卖单的费从收入里扣,不占用支出额度),
 * 所以只给买单加缓冲。这个值与 amount_usd 分开存:前者约束风险,
 * 后者是用户下单时填的数,界面展示应当保持一致。
 */
export function spendUsd(exposure: number, side: "BUY" | "SELL"): number {
  return side === "BUY" ? exposure * (1 + TRADE_FEE_BUFFER) : exposure;
}

/**
 * 参数组合校验;通过返回 null。
 *
 * post-only 配市价单是自相矛盾的:市价单必然吃单。这种情况必须报错而不是
 * 静默忽略——静默忽略会让人以为拿到了"绝不吃单"的保护,实际却照吃不误。
 */
export function validateOrderShape(req: {
  limitPrice?: number;
  postOnly?: boolean;
}): string | null {
  if (req.postOnly && !req.limitPrice) {
    return "post-only 只对限价单有效:市价单必然吃单,无法只做 maker";
  }
  return null;
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
  /** 含手续费的支出估计,供日累计限额统计;未走到风控前为 null */
  spendUsd?: number | null;
  /** 解析后的有效期(分钟),0 或缺省表示 GTC */
  expiryMinutes?: number;
  request: OrderRequest;
  market?: Market | null;
  response?: unknown;
};

const ALERT_LABEL: Record<string, string> = {
  blocked: "🚫 下单被风控拦截",
  rejected: "❌ 交易所拒单",
  failed: "❌ 下单失败",
  submitted: "✅ 实盘下单已提交",
};

/**
 * 订单告警文案;返回 null 表示不告警。
 *
 * 只报「钱真的动了」和「本该动却没动成」两类:dry-run 全程静默,否则演练
 * 阶段会把告警刷成噪音,真出事时反而没人看。
 */
export function formatOrderAlert(
  r: Pick<Recorded, "status" | "dryRun" | "request" | "market" | "amountUsd" | "error">,
  id: number,
): string | null {
  if (r.dryRun) return null;
  const label = ALERT_LABEL[r.status];
  if (!label) return null;

  const title = r.market?.question ?? r.request.market;
  const amount = r.amountUsd != null ? `$${r.amountUsd}` : "";
  const who = r.request.agentId ? ` [agent#${r.request.agentId}]` : "";
  const lines = [
    `${label} #${id}${who}`,
    `${r.request.side} ${r.request.outcome} ${amount} — ${title}`,
  ];
  if (r.error) lines.push(r.error);
  return lines.join("\n");
}

async function record(r: Recorded): Promise<OrderResult> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO orders
       (source_address, condition_id, token_id, market_slug, title, outcome,
        side, order_type, price, size, amount_usd, status, dry_run,
        clob_order_id, clob_status, error, request_json, response_json, created_at,
        agent_id, spend_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING id`,
    [
      r.request.sourceAddress ?? null,
      r.market?.conditionId ?? r.request.market,
      r.tokenId,
      r.market?.slug ?? null,
      r.market?.question ?? null,
      r.request.outcome,
      r.request.side,
      orderTypeOf({
        limitPrice: r.request.limitPrice,
        expiryMinutes: r.expiryMinutes,
      }),
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
      r.request.agentId ?? null,
      r.spendUsd ?? null,
    ],
  );
  // 旁路推送:不 await,告警慢或失败都不该拖住下单响应
  const alert = formatOrderAlert(r, rows[0].id);
  if (alert) void sendAlert(alert);

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

  // 参数问题在下单前拦住,别等交易所拒单
  const parsed = parseDuration(req.expiresIn);
  const shapeError =
    "error" in parsed ? parsed.error : validateOrderShape(req);
  if (shapeError) {
    return record({
      ...EMPTY,
      request: req,
      market,
      tokenId,
      status: "failed",
      dryRun,
      error: shapeError,
    });
  }
  const expiryMinutes = "minutes" in parsed ? parsed.minutes : 0;

  const tick = Number(market.trading.minimumTickSize ?? 0.01);
  const priceDecimals = decimalsForTick(tick);
  const price = req.limitPrice ? roundTo(req.limitPrice, priceDecimals) : null;
  const size = req.shares ? floorShares(req.shares) : null;

  const refPrice = Number(
    market.prices.bestBid ?? market.outcomes[req.outcome].price ?? 0,
  );
  const amountUsd = exposureUsd({
    side: req.side,
    price,
    size,
    amountUsd: req.amountUsd,
    refPrice,
  });

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

  // 风控与日累计按含费支出计,而不是名义金额
  const spend = spendUsd(amountUsd, req.side);
  const blocked = await checkLimits(spend);
  if (blocked) {
    return record({
      ...EMPTY,
      request: req,
      market,
      tokenId,
      price,
      size,
      amountUsd,
      spendUsd: spend,
      status: "blocked",
      dryRun,
      error: blocked,
    });
  }

  const side = req.side === "BUY" ? OrderSide.BUY : OrderSide.SELL;
  const common = {
    ...EMPTY,
    request: req,
    market,
    tokenId,
    price,
    size,
    amountUsd,
    spendUsd: spend,
    expiryMinutes,
  };

  try {
    if (price !== null) {
      // 限价单:size 必填
      if (size === null) {
        return record({ ...common, status: "failed", dryRun, error: "限价单必须指定份额" });
      }
      // 传 expiration 即为 GTD;省略则是 GTC(挂到撤销为止)
      const expiration = expirationTs(expiryMinutes, Date.now());
      const params = {
        tokenId,
        price,
        size,
        side,
        ...(expiration ? { expiration } : {}),
        ...(req.postOnly ? { postOnly: true } : {}),
      };
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
