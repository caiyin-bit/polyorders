import { COPY_ORDER_USD } from "@/src/config";
import { copyDailyMax, copyMode } from "@/src/copy/engine";
import { RULES, STRATEGY } from "@/src/copy/rules";
import { copyStats } from "@/src/copy/stats";
import { query } from "@/src/db";
import { bjDayStart } from "@/src/trade/risk";

export const dynamic = "force-dynamic";

// 「实时关注」弹窗数据:关注池最新信号明细(含引擎裁决与观测价)
// + 跟单引擎运行状态 + 影子成绩聚合。受 middleware 登录保护

export async function GET(req: Request) {
  const days = Math.min(90, Number(new URL(req.url).searchParams.get("days")) || 30);

  const [signals, today, stats] = await Promise.all([
    query(
      `SELECT s.id, s.address, c.username, s.title, s.outcome, s.side, s.price,
              s.usd, s.source, s.best_ask, s.event_slug, s.trade_ts, s.detected_at,
              s.detected_at - s.trade_ts * 1000 AS detect_lag_ms,
              d.decision, d.skip_reason, d.sim_price,
              (SELECT json_object_agg(m.horizon, m.price)
               FROM signal_marks m WHERE m.signal_id = s.id) AS marks
       FROM signals s
       JOIN watchlist w ON w.address = s.address
       LEFT JOIN copy_decisions d ON d.signal_id = s.id
       LEFT JOIN candidates c ON c.address = s.address
       ORDER BY s.detected_at DESC
       LIMIT 50`,
    ),
    // 今日(北京时间)裁决计数
    query<{ decision: string; n: number }>(
      `SELECT decision, COUNT(*)::int AS n
       FROM copy_decisions WHERE decided_at >= $1 GROUP BY decision`,
      [bjDayStart(Date.now())],
    ),
    copyStats(days),
  ]);

  const todayN = Object.fromEntries(today.rows.map((r) => [r.decision, r.n]));

  return Response.json({
    engine: {
      mode: copyMode(),
      strategy: STRATEGY,
      orderUsd: COPY_ORDER_USD,
      dailyMaxUsd: copyDailyMax(),
      rules: RULES,
      todayCopies: todayN.copy ?? 0,
      todaySkips: todayN.skip ?? 0,
    },
    signals: signals.rows,
    stats,
  });
}
