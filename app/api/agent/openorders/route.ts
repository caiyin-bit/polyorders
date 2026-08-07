import { authErrorResponse, requireAgent, requireScope } from "@/src/agent-auth";
import { cancelByClobId, cancelByOrderId, openOrders } from "@/src/trade/manage";

export const dynamic = "force-dynamic";

// 未成交挂单的查询与撤销。
// 查询只需 read;撤单归入 trade 权限——它虽然不花钱,但会改变资金的实际去向,
// 与下单是同一类操作,不该让只读 agent 能动。

export async function GET(req: Request) {
  try {
    await requireAgent(req);
    const orders = await openOrders();
    return Response.json({ count: orders.length, openOrders: orders });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const agent = await requireAgent(req);
    requireScope(agent, "trade");

    let body: { id?: unknown; clobOrderId?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {}

    // 两种指定方式:库内订单号(我方下的单)或 CLOB 订单号(含官网手动挂的)
    const res =
      body.id !== undefined
        ? await cancelByOrderId(Number(body.id), { agentId: agent.id })
        : typeof body.clobOrderId === "string"
          ? await cancelByClobId(body.clobOrderId, { agentId: agent.id })
          : null;

    if (!res) {
      return Response.json(
        { error: "需要 id(库内订单号)或 clobOrderId 之一" },
        { status: 400 },
      );
    }
    return Response.json(res, { status: res.ok ? 200 : 409 });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
