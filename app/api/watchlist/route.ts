import { WATCH_POOL_LIMIT } from "@/src/config";
import { query } from "@/src/db";

export const dynamic = "force-dynamic";

// 受 middleware 保护(登录后才可达)

export async function GET() {
  const { rows } = await query(
    `SELECT w.address, w.added_at, w.last_fetched_at AS fetched_at, c.username, s.rank,
            (SELECT MAX("timestamp") FROM trades t WHERE t.address = w.address) AS last_trade_ts
     FROM watchlist w
     LEFT JOIN candidates c ON c.address = w.address
     LEFT JOIN scores s ON s.address = w.address
     ORDER BY w.added_at`,
  );
  const { rows: state } = await query<{
    connected: boolean;
    last_heartbeat_at: number | null;
    last_event_at: number | null;
    matched_seen: number;
  }>(
    "SELECT connected, last_heartbeat_at, last_event_at, matched_seen FROM watcher_state WHERE id = 1",
  );

  // 心跳每 30 秒写一次;超过 90 秒没动静就认为实时通道已断,降级到 5 分钟轮询
  const s = state[0];
  const live =
    !!s?.connected &&
    s.last_heartbeat_at !== null &&
    Date.now() - s.last_heartbeat_at < 90_000;

  return Response.json({
    watchlist: rows,
    limit: WATCH_POOL_LIMIT,
    watcher: {
      live,
      lastEventAt: s?.last_event_at ?? null,
      matchedSeen: s?.matched_seen ?? 0,
    },
  });
}

export async function POST(req: Request) {
  let address = "";
  try {
    address = String(((await req.json()) as { address?: unknown }).address ?? "");
  } catch {}
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: "地址格式不合法" }, { status: 400 });
  }
  address = address.toLowerCase();

  const { rows } = await query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM watchlist",
  );
  if (rows[0].n >= WATCH_POOL_LIMIT) {
    return Response.json(
      { error: `关注池已满(${WATCH_POOL_LIMIT} 个),请先移除一个` },
      { status: 409 },
    );
  }

  await query(
    "INSERT INTO watchlist (address, added_at) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING",
    [address, Date.now()],
  );
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  let address = "";
  try {
    address = String(((await req.json()) as { address?: unknown }).address ?? "");
  } catch {}
  if (!address) return Response.json({ error: "缺少 address" }, { status: 400 });

  await query("DELETE FROM watchlist WHERE address = $1", [address.toLowerCase()]);
  return Response.json({ ok: true });
}
