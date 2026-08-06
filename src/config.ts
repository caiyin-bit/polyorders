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
