import { query } from "@/src/db";
import { placeOrder, type OrderRequest } from "@/src/trade/order";
import { tradeLimits } from "@/src/trade/risk";

export const dynamic = "force-dynamic";

// 全站 middleware 已拦截 /api/*,此处无需再做鉴权

export async function GET() {
  const [ordersRes, limits] = await Promise.all([
    query(
      `SELECT id, condition_id, market_slug, title, outcome, side, order_type,
              price, size, amount_usd, status, dry_run, clob_order_id,
              clob_status, size_matched, error, created_at
       FROM orders ORDER BY created_at DESC LIMIT 20`,
    ),
    Promise.resolve(tradeLimits()),
  ]);
  return Response.json({ orders: ordersRes.rows, limits });
}

export async function POST(req: Request) {
  let body: Partial<OrderRequest>;
  try {
    body = (await req.json()) as Partial<OrderRequest>;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const market = body.market?.trim();
  const { outcome, side } = body;
  if (!market || (outcome !== "yes" && outcome !== "no")) {
    return Response.json({ error: "缺少市场或 outcome" }, { status: 400 });
  }
  if (side !== "BUY" && side !== "SELL") {
    return Response.json({ error: "side 必须为 BUY 或 SELL" }, { status: 400 });
  }
  if (side === "BUY" && !(Number(body.amountUsd) > 0)) {
    return Response.json({ error: "买入需要填写金额" }, { status: 400 });
  }
  if (side === "SELL" && !(Number(body.shares) > 0)) {
    return Response.json({ error: "卖出需要填写份额" }, { status: 400 });
  }

  try {
    const result = await placeOrder({
      market,
      outcome,
      side,
      amountUsd: body.amountUsd ? Number(body.amountUsd) : undefined,
      shares: body.shares ? Number(body.shares) : undefined,
      limitPrice: body.limitPrice ? Number(body.limitPrice) : undefined,
    });
    return Response.json(result);
  } catch (err) {
    // 客户端初始化失败(私钥未配置等)不会走到 placeOrder 的内部兜底
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
