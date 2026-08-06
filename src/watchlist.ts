import { WATCH_POOL_LIMIT } from "./config";
import { query } from "./db";

// 关注池的增删查。人类面板与 agent 端点共用,池子上限只在这里判一次。
// 注意:改动关注池会改变跟单引擎的输入——live 模式下等于间接影响下单,
// 所以 agent 侧的写操作要求独立的 watch 权限,不与 read 混同。

/** 校验并规整地址;不合法返回 null */
export function normalizeAddress(input: unknown): string | null {
  const s = typeof input === "string" ? input.trim() : "";
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : null;
}

export type WatchlistView = {
  watchlist: unknown[];
  limit: number;
  watcher: {
    live: boolean;
    lastEventAt: number | null;
    matchedSeen: number;
  };
};

export async function watchlistView(): Promise<WatchlistView> {
  const [pool, state] = await Promise.all([
    query(
      `SELECT w.address, w.added_at, w.last_fetched_at AS fetched_at,
              c.username, s.rank,
              (SELECT MAX("timestamp") FROM trades t WHERE t.address = w.address)
                AS last_trade_ts
       FROM watchlist w
       LEFT JOIN candidates c ON c.address = w.address
       LEFT JOIN scores s ON s.address = w.address
       ORDER BY w.added_at`,
    ),
    query<{
      connected: boolean;
      last_heartbeat_at: number | null;
      last_event_at: number | null;
      matched_seen: number;
    }>(
      "SELECT connected, last_heartbeat_at, last_event_at, matched_seen FROM watcher_state WHERE id = 1",
    ),
  ]);

  // 心跳每 30 秒写一次;超过 90 秒没动静就认为实时通道已断,降级到 5 分钟轮询
  const s = state.rows[0];
  const live =
    !!s?.connected &&
    s.last_heartbeat_at !== null &&
    Date.now() - s.last_heartbeat_at < 90_000;

  return {
    watchlist: pool.rows,
    limit: WATCH_POOL_LIMIT,
    watcher: {
      live,
      lastEventAt: s?.last_event_at ?? null,
      matchedSeen: s?.matched_seen ?? 0,
    },
  };
}

/** 加入关注池。返回中文错误原因,成功返回 null */
export async function addToWatchlist(address: string): Promise<string | null> {
  const { rows } = await query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM watchlist WHERE address <> $1",
    [address],
  );
  if (rows[0].n >= WATCH_POOL_LIMIT) {
    return `关注池已满(${WATCH_POOL_LIMIT} 个),请先移除一个`;
  }
  await query(
    "INSERT INTO watchlist (address, added_at) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING",
    [address, Date.now()],
  );
  return null;
}

export async function removeFromWatchlist(address: string): Promise<void> {
  await query("DELETE FROM watchlist WHERE address = $1", [address]);
}
