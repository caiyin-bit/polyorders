import { authErrorResponse, requireAgent } from "@/src/agent-auth";
import { query } from "@/src/db";

export const dynamic = "force-dynamic";

// 原始信号流:每条信号连同引擎裁决与各持有期观测价。
// 与 copystats 的分工——那边是聚合结论,这边是明细,便于 agent 自己做分析
// 或核对某一条具体信号当时发生了什么。

const MAX_LIMIT = 200;

export async function GET(req: Request) {
  try {
    await requireAgent(req);
    const url = new URL(req.url);
    const limit = Math.min(MAX_LIMIT, Number(url.searchParams.get("limit")) || 50);
    const address = url.searchParams.get("address");
    // 默认只给实时源:轮询来的信号已滞后,引擎不会裁决它们
    const source = url.searchParams.get("source");
    const decision = url.searchParams.get("decision"); // copy | skip

    const where: string[] = [];
    const args: unknown[] = [];
    if (address) {
      args.push(address.toLowerCase());
      where.push(`s.address = $${args.length}`);
    }
    if (source) {
      args.push(source);
      where.push(`s.source = $${args.length}`);
    }
    if (decision) {
      args.push(decision);
      where.push(`d.decision = $${args.length}`);
    }

    const { rows } = await query(
      `SELECT s.id, s.address, c.username, s.condition_id, s.title, s.outcome,
              s.side, s.price, s.usd, s.source, s.best_bid, s.best_ask,
              s.trade_ts, s.detected_at,
              -- 检测延迟(毫秒):高手成交到我们看见之间隔了多久
              s.detected_at - s.trade_ts * 1000 AS detect_lag_ms,
              d.decision, d.skip_reason, d.sim_price, d.sim_usd, d.order_id,
              (SELECT json_object_agg(m.horizon, m.price)
               FROM signal_marks m WHERE m.signal_id = s.id) AS marks
       FROM signals s
       LEFT JOIN copy_decisions d ON d.signal_id = s.id
       LEFT JOIN candidates c ON c.address = s.address
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.detected_at DESC
       LIMIT ${limit}`,
      args,
    );

    return Response.json({
      note: "marks 为各持有期观测价(5m/1h/24h/res);detect_lag_ms 为检测延迟",
      count: rows.length,
      signals: rows,
    });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
