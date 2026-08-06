import { authErrorResponse, requireAgent } from "@/src/agent-auth";
import { tradeLimits } from "@/src/trade/risk";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const agent = await requireAgent(req);
    const limits = tradeLimits();
    return Response.json({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      scopes: agent.scopes,
      trading: {
        // 让 agent 明确知道自己受哪些约束,避免它误以为下单会真实成交
        mode: limits.enabled ? "live" : "dry-run",
        maxUsdPerOrder: limits.maxUsd,
        maxUsdPerDay: limits.dailyMaxUsd,
        canTrade: agent.scopes.includes("trade"),
      },
    });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
