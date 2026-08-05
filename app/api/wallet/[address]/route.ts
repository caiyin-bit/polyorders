import { query } from "@/src/db";
import { getEventSlugs } from "@/src/markets";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const CURVE_MAX_POINTS = 240;

type PositionRow = {
  condition_id: string;
  title: string | null;
  outcome: string | null;
  avg_price: number | null;
  total_bought: number | null;
  realized_pnl: number;
  timestamp: number | null;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const q = (url.searchParams.get("q") ?? "").trim();
  const withCurve = url.searchParams.get("curve") === "1";

  const where = q ? "address = $1 AND title ILIKE $2" : "address = $1";
  const args: unknown[] = q ? [address, `%${q}%`] : [address];

  const [scoreRes, candRes, countRes, posRes] = await Promise.all([
    query(
      `SELECT total_positions, winning_positions, win_rate,
              total_realized_pnl, avg_pnl, rank
       FROM scores WHERE address = $1`,
      [address],
    ),
    query<{ username: string | null }>(
      "SELECT username FROM candidates WHERE address = $1",
      [address],
    ),
    query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM closed_positions WHERE ${where}`,
      args,
    ),
    query<PositionRow>(
      `SELECT condition_id, title, outcome, avg_price, total_bought, realized_pnl, "timestamp"
       FROM closed_positions WHERE ${where}
       ORDER BY "timestamp" DESC NULLS LAST
       LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      args,
    ),
  ]);

  const slugs = await getEventSlugs([
    ...new Set(posRes.rows.map((p) => p.condition_id)),
  ]);
  const rows = posRes.rows.map((p) => ({
    ...p,
    slug: slugs.get(p.condition_id) ?? null,
  }));

  let curve: Array<[number, number]> | null = null;
  if (withCurve) {
    const { rows: pts } = await query<{
      realized_pnl: number;
      timestamp: number;
    }>(
      `SELECT realized_pnl, "timestamp" FROM closed_positions
       WHERE address = $1 AND "timestamp" IS NOT NULL
       ORDER BY "timestamp" ASC`,
      [address],
    );
    let acc = 0;
    const series: Array<[number, number]> = pts.map((p) => [
      p.timestamp,
      (acc += p.realized_pnl),
    ]);
    if (series.length <= CURVE_MAX_POINTS) {
      curve = series;
    } else {
      const step = Math.ceil(series.length / CURVE_MAX_POINTS);
      curve = series.filter(
        (_, i) => i % step === 0 || i === series.length - 1,
      );
    }
  }

  return Response.json({
    username: candRes.rows[0]?.username ?? null,
    score: scoreRes.rows[0] ?? null,
    totalRows: countRes.rows[0].n,
    pageSize: PAGE_SIZE,
    positions: rows,
    curve,
  });
}
