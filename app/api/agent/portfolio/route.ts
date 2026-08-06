import { authErrorResponse, requireAgent } from "@/src/agent-auth";
import { portfolioSnapshot } from "@/src/portfolio";

export const dynamic = "force-dynamic";

// 只读:agent 看得到我方钱包的持仓与盈亏,但下单仍受 trade 权限与限额约束

export async function GET(req: Request) {
  try {
    await requireAgent(req);
    return Response.json(await portfolioSnapshot());
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
