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
export const TOP_N = 11;

// 交易风控默认值(美元),可由 TRADE_MAX_USD / TRADE_DAILY_MAX_USD 覆盖。
// 默认取保守值:即使环境变量漏配,也不会放出大额单。
export const TRADE_MAX_USD_DEFAULT = 5;
export const TRADE_DAILY_MAX_USD_DEFAULT = 20;
