import { authErrorResponse, requireAgent } from "@/src/agent-auth";
import { TOP_N } from "@/src/config";
import { query } from "@/src/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAgent(req);
    const { rows } = await query(
      `SELECT s.rank, s.address, c.username, s.total_positions, s.winning_positions,
              s.win_rate, s.total_realized_pnl, s.avg_pnl, s.score
       FROM scores s LEFT JOIN candidates c ON c.address = s.address
       WHERE s.rank IS NOT NULL
       ORDER BY s.rank`,
    );
    return Response.json({
      // 前 topN 名为最终入选,其余是入围但未进前列的
      topN: TOP_N,
      scoring: "win_rate × ln(total_positions)",
      addresses: rows,
    });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
