import { authErrorResponse, requireAgent } from "@/src/agent-auth";
import { query } from "@/src/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const agent = await requireAgent(req);
    const mine = new URL(req.url).searchParams.get("mine") === "1";

    const { rows } = await query(
      `SELECT id, condition_id, market_slug, title, outcome, side, order_type,
              price, size, amount_usd, status, dry_run, clob_status, error,
              agent_id, created_at
       FROM orders
       ${mine ? "WHERE agent_id = $1" : ""}
       ORDER BY created_at DESC
       LIMIT 50`,
      mine ? [agent.id] : [],
    );
    return Response.json({ orders: rows });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
