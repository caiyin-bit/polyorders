import { authErrorResponse, requireAgent } from "@/src/agent-auth";
import { query } from "@/src/db";

export const dynamic = "force-dynamic";

// 精简版钱包详情:只给 agent 决策需要的数据。
// 人类版 /api/wallet/[address] 还带 240 点盈亏曲线与已平仓分页,agent 用不上。

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    await requireAgent(req);
    const { address } = await params;

    const [score, open, trades] = await Promise.all([
      query(
        `SELECT rank, total_positions, winning_positions, win_rate,
                total_realized_pnl, avg_pnl
         FROM scores WHERE address = $1`,
        [address],
      ),
      query(
        `SELECT condition_id, outcome, size, avg_price, cur_price,
                current_value, cash_pnl, title, event_slug
         FROM open_positions WHERE address = $1
         ORDER BY current_value DESC NULLS LAST
         LIMIT 50`,
        [address],
      ),
      query(
        `SELECT condition_id, side, price, size, usdc_size, outcome,
                title, event_slug, "timestamp"
         FROM trades WHERE address = $1
         ORDER BY "timestamp" DESC
         LIMIT 50`,
        [address],
      ),
    ]);

    return Response.json({
      address,
      score: score.rows[0] ?? null,
      openPositions: open.rows,
      recentTrades: trades.rows,
    });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
