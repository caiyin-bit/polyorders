// 跨面板共用的数据行类型。拆分面板后放这里,避免面板与 dashboard 互相 import。

export type LeaderRow = {
  address: string;
  username: string | null;
  total_positions: number;
  winning_positions: number;
  win_rate: number;
  total_realized_pnl: number | null;
  avg_pnl: number | null;
  score: number | null;
  /** 手动关注的榜单外地址无名次;次日全量重算若达标会获得正式 rank */
  rank: number | null;
  /** 手动加入关注池的榜单外地址:置顶并标「精选」 */
  pinned: boolean;
  spark: number[];
};

export type RunRow = {
  step: string;
  started_at: number;
  finished_at: number | null;
  addresses_ok: number | null;
  addresses_failed: number | null;
  error: string | null;
};

export type TradeLine = {
  side: string;
  price: number | null;
  usdc_size: number | null;
  outcome: string | null;
  title: string | null;
  event_slug: string | null;
  timestamp: number;
};

export type FeedTrade = TradeLine & { address: string };


export type Funnel = {
  candidates: number;
  prefilterPass: number;
  positionsFetched: number;
  closedPositions: number;
  qualified: number;
};

export type Config = {
  topN: number;
  leaderboardPages: number;
  timePeriod: string;
  minTraded: number;
  minPositions: number;
  maxPositions: number;
};

export type FetchSession = {
  group: string;
  kind: string;
  started_at: number;
  finished_at: number | null;
  ok: boolean;
  steps: RunRow[];
};

export type FetchStatus = {
  running: boolean;
  canRun?: boolean;
  current: { step: string; started_at: number } | null;
  polymarket?: { ok: boolean; latencyMs: number | null };
  nextRun?: { at: number; kind: "live" | "full" };
  sessions?: FetchSession[];
  counts: {
    candidates: number;
    prefiltered: number;
    passed: number;
    positionsFetched: number;
    scored: number;
  } | null;
  targets: { candidates: number } | null;
};
