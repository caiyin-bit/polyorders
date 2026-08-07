import { authErrorResponse, requireAgent, requireScope } from "@/src/agent-auth";
import { placeOrder, type OrderRequest } from "@/src/trade/order";

export const dynamic = "force-dynamic";

// Agent 下单与人类走同一个内核:TRADING_ENABLED 的 dry-run 开关、
// 单笔与日累计限额一律照旧生效,agent 无法绕过。

export async function POST(req: Request) {
  let agentId: number;
  try {
    const agent = await requireAgent(req);
    requireScope(agent, "trade");
    agentId = agent.id;
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }

  let body: Partial<OrderRequest>;
  try {
    body = (await req.json()) as Partial<OrderRequest>;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const market = body.market?.trim();
  const { outcome, side } = body;
  if (!market || (outcome !== "yes" && outcome !== "no")) {
    return Response.json(
      { error: "缺少 market 或 outcome(outcome 只能是 yes / no)" },
      { status: 400 },
    );
  }
  if (side !== "BUY" && side !== "SELL") {
    return Response.json({ error: "side 必须为 BUY 或 SELL" }, { status: 400 });
  }
  if (side === "BUY" && !body.limitPrice && !(Number(body.amountUsd) > 0)) {
    return Response.json(
      { error: "市价买入需要 amountUsd" },
      { status: 400 },
    );
  }
  if ((side === "SELL" || body.limitPrice) && !(Number(body.shares) > 0)) {
    return Response.json(
      { error: "卖出与限价单需要 shares" },
      { status: 400 },
    );
  }

  try {
    const result = await placeOrder({
      market,
      outcome,
      side,
      amountUsd: body.amountUsd ? Number(body.amountUsd) : undefined,
      shares: body.shares ? Number(body.shares) : undefined,
      limitPrice: body.limitPrice ? Number(body.limitPrice) : undefined,
      // 分钟数或 "30m"/"2h"/"1d";仅对限价单有意义,解析与校验在 placeOrder 内
      expiresIn: body.expiresIn,
      postOnly: body.postOnly === true,
      agentId,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
