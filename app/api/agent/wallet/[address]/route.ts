import { authErrorResponse, requireAgent } from "@/src/agent-auth";
import { walletSnapshot } from "@/src/wallet";

export const dynamic = "force-dynamic";

// 精简版钱包详情:只给 agent 决策需要的数据。
// 人类版 /api/wallet/[address] 在同一份快照上额外带 240 点盈亏曲线与已平仓分页。

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    await requireAgent(req);
    const { address } = await params;
    return Response.json({ address, ...(await walletSnapshot(address)) });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
