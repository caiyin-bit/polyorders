import { TRADE_FEE_RATE } from "@/src/config";
import { query } from "@/src/db";

export const dynamic = "force-dynamic";

// 影子成绩明细:「实时关注」弹窗聚合行点开后的逐笔模拟跟单。
// 口径与 copyStats 对齐:segment=executable 只含当前可下单的 yes/no 盘;
// 传 horizon 时只返回已有该观测价的样本,保证明细条数与聚合行的 n 一致。
// 受 middleware 登录保护

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const days = Math.min(90, Number(p.get("days")) || 30);
  const horizonRaw = p.get("horizon");
  const horizon = ["5m", "1h", "24h", "res"].includes(horizonRaw ?? "")
    ? horizonRaw
    : null;
  const addressRaw = (p.get("address") ?? "").toLowerCase();
  const address = /^0x[0-9a-f]{40}$/.test(addressRaw) ? addressRaw : null;
  const executable = p.get("segment") === "executable";

  const { rows } = await query(
    `SELECT d.signal_id, d.decided_at, d.sim_price, d.sim_usd, d.order_id,
            s.address, c.username, s.title, s.outcome, s.side, s.event_slug,
            s.price AS signal_price, s.usd AS signal_usd, s.source,
            s.detected_at - s.trade_ts * 1000 AS detect_lag_ms,
            (SELECT json_object_agg(m.horizon, m.price)
             FROM signal_marks m WHERE m.signal_id = d.signal_id) AS marks
     FROM copy_decisions d
     JOIN signals s ON s.id = d.signal_id
     LEFT JOIN candidates c ON c.address = s.address
     WHERE d.decision = 'copy' AND d.sim_price > 0 AND d.decided_at > $1
       AND ($2::text IS NULL OR s.address = $2)
       AND (NOT $3::boolean OR lower(s.outcome) IN ('yes', 'no'))
       AND ($4::text IS NULL OR EXISTS (
             SELECT 1 FROM signal_marks m
             WHERE m.signal_id = d.signal_id AND m.horizon = $4
               AND m.price IS NOT NULL))
     ORDER BY d.decided_at DESC
     LIMIT 500`,
    [Date.now() - days * 86_400_000, address, executable, horizon],
  );

  return Response.json({ feeRate: TRADE_FEE_RATE, copies: rows });
}
