import { authErrorResponse, requireAgent } from "@/src/agent-auth";
import { copyStats } from "@/src/copy/stats";

export const dynamic = "force-dynamic";

// 跟单引擎成绩单:shadow 模拟按持有期的收益、跳过原因分布、分来源钱包表现。
// 这是「哪些信号值得跟」的数据答案,live 开闸与否由它说了算。
// 聚合逻辑在 src/copy/stats.ts,与「实时关注」弹窗共用

export async function GET(req: Request) {
  try {
    await requireAgent(req);
    const days = Math.min(90, Number(new URL(req.url).searchParams.get("days")) || 30);
    return Response.json({
      note: "avg_return 为 shadow 模拟(按决策时卖一价买入);win_rate 为观测价高于买入价的比例",
      ...(await copyStats(days)),
    });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
