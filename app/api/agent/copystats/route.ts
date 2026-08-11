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
      note:
        "segment=executable 仅含当前实盘支持的 yes/no;avg_return 为卖一价毛收益;" +
        "net_avg_return 扣除保守买入费用;95% 区间仅在 n>=30 时提供大样本正态近似;" +
        "readiness 只提供证据,不会自动开启实盘",
      ...(await copyStats(days)),
    });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
