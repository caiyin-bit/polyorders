export const DATA_API = "https://data-api.polymarket.com";

export const LEADERBOARD = {
  timePeriod: "MONTH",
  orderBy: "PNL",
  pageSize: 50,
  maxOffset: 1000,
} as const;

export const PREFILTER_MIN_TRADED = 20;
export const SCORE_MIN_POSITIONS = 30;
export const SCORE_MAX_POSITIONS = 5000;
export const TOP_N = 20;

// trades 是唯一无限累积的表,不清理会撑爆 Supabase 免费档(500 MB)。
// UI 只用到「每地址最近 3 笔」与钱包弹窗的「最近 50 笔」,长期历史无用。
// 保留窗口外仍每地址保底留最新若干条:否则不活跃地址会被清空,
// fetchNewTrades 的 MAX(timestamp) 增量游标失效,每轮都重新回填再删。
export const TRADES_RETENTION_DAYS = 14;
export const TRADES_KEEP_PER_ADDRESS = 50;

// 实时关注池:小池子才支撑得起 5 分钟级高频定向拉取
export const WATCH_POOL_LIMIT = 5;

// RTDS 实时 watcher。全平台成交流约 28 条/秒,只有命中关注池的才落库。
// 大额成交推 Telegram;冷却按地址生效,避免连续成交刷屏。
export const WATCH_ALERT_MIN_USD = Number(process.env.WATCH_ALERT_MIN_USD) || 500;
export const WATCH_ALERT_COOLDOWN_MS = 60_000;
export const WATCH_RELOAD_MS = 30_000;

// 交易风控默认值(美元),可由 TRADE_MAX_USD / TRADE_DAILY_MAX_USD 覆盖。
// 默认取保守值:即使环境变量漏配,也不会放出大额单。
export const TRADE_MAX_USD_DEFAULT = 5;
export const TRADE_DAILY_MAX_USD_DEFAULT = 20;

// Agent 接入:注册端点必须匿名可调(agent 没有凭据),因此靠「未认领配额 +
// 过期清理」限制滥用。选配额而非 IP 限速,是因为它不依赖内存状态,
// 重启与多容器都成立。
export const AGENT_UNCLAIMED_LIMIT = 20;
export const AGENT_CLAIM_TTL_MS = 24 * 3600_000;
