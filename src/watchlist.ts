import { RTDS_EVENT_STALE_MS, WATCH_POOL_LIMIT } from "./config";
import { query } from "./db";
import { backfillManualAddress } from "./fetch/manual";
import { fetchJson } from "./http";

// 关注池的增删查。人类面板与 agent 端点共用,池子上限只在这里判一次。
// 注意:改动关注池会改变跟单引擎的输入——live 模式下等于间接影响下单,
// 所以 agent 侧的写操作要求独立的 watch 权限,不与 read 混同。

/** 校验并规整地址;不合法返回 null */
export function normalizeAddress(input: unknown): string | null {
  const s = typeof input === "string" ? input.trim() : "";
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : null;
}

// ── 自由输入解析:地址 / profile 链接 / @handle / 用户名 ──────────────

export type WatchInput =
  | { kind: "address"; address: string }
  | { kind: "username"; username: string };

/**
 * 把用户随手粘贴的东西解析成地址或用户名。纯函数,可测。
 * 支持:0x 地址、polymarket.com/profile/0x…、polymarket.com/zh/@handle?via=…
 * (语言前缀与查询参数都容忍)、@handle、裸用户名。解析不了返回 null
 */
export function parseWatchInput(raw: unknown): WatchInput | null {
  const s = (typeof raw === "string" ? raw : "").trim();
  if (!s) return null;

  const direct = normalizeAddress(s);
  if (direct) return { kind: "address", address: direct };

  // URL / 带斜杠的路径:逐段找地址或 @handle,天然跳过语言前缀;查询参数先剁掉
  if (s.includes("/")) {
    for (const seg of s.split(/[?#]/)[0].split("/")) {
      const addr = normalizeAddress(seg);
      if (addr) return { kind: "address", address: addr };
      if (seg.startsWith("@") && seg.length > 1) {
        return { kind: "username", username: seg.slice(1) };
      }
    }
    return null;
  }

  if (s.startsWith("@") && s.length > 1) {
    return { kind: "username", username: s.slice(1) };
  }
  // 裸用户名:限定保守字符集,不把任意文本发给搜索接口
  if (/^[A-Za-z0-9_.-]{2,50}$/.test(s)) return { kind: "username", username: s };
  return null;
}

export type WatchCandidate = {
  address: string;
  username: string | null;
  pseudonym: string | null;
};

const GAMMA_API = "https://gamma-api.polymarket.com";

/**
 * 解析成可入池的候选地址。地址输入反查资料补显示名(查不到不拦——
 * 纯地址也可能有仓位);用户名走公开搜索,精确同名(含 pseudonym)唯一
 * 时只返回它,否则返回前几个候选交给界面让人挑
 */
export async function resolveWatchInput(
  input: WatchInput,
): Promise<WatchCandidate[]> {
  if (input.kind === "address") {
    try {
      const p = await fetchJson<{ name?: string; pseudonym?: string }>(
        `${GAMMA_API}/public-profile?address=${input.address}`,
      );
      return [
        {
          address: input.address,
          username: p.name ?? p.pseudonym ?? null,
          pseudonym: p.pseudonym ?? null,
        },
      ];
    } catch {
      return [{ address: input.address, username: null, pseudonym: null }];
    }
  }

  const { profiles } = await fetchJson<{
    profiles?: Array<{ name?: string; pseudonym?: string; proxyWallet?: string }>;
  }>(
    `${GAMMA_API}/public-search?q=${encodeURIComponent(input.username)}&search_profiles=true`,
  );
  const list: WatchCandidate[] = (profiles ?? [])
    .filter((p) => normalizeAddress(p.proxyWallet))
    .map((p) => ({
      address: normalizeAddress(p.proxyWallet)!,
      username: p.name ?? null,
      pseudonym: p.pseudonym ?? null,
    }));
  const q = input.username.toLowerCase();
  const exact = list.filter(
    (p) => p.username?.toLowerCase() === q || p.pseudonym?.toLowerCase() === q,
  );
  return exact.length === 1 ? exact : list.slice(0, 8);
}

export type WatchlistView = {
  watchlist: unknown[];
  limit: number;
  watcher: {
    live: boolean;
    connectedSince: number | null;
    lastHeartbeatAt: number | null;
    lastEventAt: number | null;
    matchedSeen: number;
  };
};

export type WatcherStateRow = {
  connected: boolean;
  connected_at: number | null;
  last_heartbeat_at: number | null;
  last_event_at: number | null;
};

/** 心跳只能证明进程活着;事件新鲜度才能证明 RTDS 数据真的还在流 */
export function watcherStatus(s: WatcherStateRow, now = Date.now()) {
  const heartbeatFresh =
    s.last_heartbeat_at !== null && now - s.last_heartbeat_at < 90_000;
  const eventFresh =
    s.last_event_at !== null && now - s.last_event_at < RTDS_EVENT_STALE_MS;
  return {
    live: s.connected && heartbeatFresh && eventFresh,
    connectedSince: s.connected_at,
    lastHeartbeatAt: s.last_heartbeat_at,
    lastEventAt: s.last_event_at,
  };
}

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
    query<WatcherStateRow & { matched_seen: number }>(
      "SELECT connected, connected_at, last_heartbeat_at, last_event_at, matched_seen FROM watcher_state WHERE id = 1",
    ),
  ]);

  const s = state.rows[0];
  const status = s
    ? watcherStatus(s)
    : {
        live: false,
        connectedSince: null,
        lastHeartbeatAt: null,
        lastEventAt: null,
      };

  return {
    watchlist: pool.rows,
    limit: WATCH_POOL_LIMIT,
    watcher: {
      ...status,
      matchedSeen: s?.matched_seen ?? 0,
    },
  };
}

/** 加入关注池。返回中文错误原因,成功返回 null */
export async function addToWatchlist(
  address: string,
  addedBy?: number,
  username?: string | null,
): Promise<string | null> {
  const { rows } = await query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM watchlist WHERE address <> $1",
    [address],
  );
  if (rows[0].n >= WATCH_POOL_LIMIT) {
    return `关注池已满(${WATCH_POOL_LIMIT} 个),请先移除一个`;
  }
  // 榜单外地址在 candidates 无行,列表与信号流只能显示裸地址;
  // 解析得到的显示名回填进去,已有名字(榜单抓取来的)不覆盖
  if (username) {
    await query(
      `INSERT INTO candidates (address, username) VALUES ($1, $2)
       ON CONFLICT (address) DO UPDATE
         SET username = COALESCE(candidates.username, EXCLUDED.username)`,
      [address, username],
    );
  }
  await query(
    `INSERT INTO watchlist (address, added_at, added_by) VALUES ($1, $2, $3)
     ON CONFLICT (address) DO NOTHING`,
    [address, Date.now(), addedBy ?? null],
  );
  // 榜单外地址后台回填(拉平仓仓位+算评分行),让它以「精选」出现在
  // 入围列表;榜单内地址已有评分行,回填自会跳过。不阻塞本次请求
  void backfillManualAddress(address);
  return null;
}

export async function removeFromWatchlist(address: string): Promise<void> {
  await query("DELETE FROM watchlist WHERE address = $1", [address]);
}
