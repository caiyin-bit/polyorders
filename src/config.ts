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
// 被跟踪地址(Top N + 关注池)的成交延长保留:它们是回测的原始佐证
export const TRACKED_TRADES_RETENTION_DAYS = 90;

// 信号与观测数据的保留窗口(signals 级联带走 marks 与 copy_decisions)
export const SIGNALS_RETENTION_DAYS = 90;

// 跟单引擎:默认 shadow(只记录);live 需 TRADING_ENABLED 与
// COPY_TRADING_ENABLED 双开关。日预算独立于全局限额且更低,
// 跟单挤占不了手动下单的额度。
export const COPY_ORDER_USD = 2;
export const COPY_DAILY_MAX_USD_DEFAULT = 10;

// 实时关注池:小池子才支撑得起 5 分钟级高频定向拉取
export const WATCH_POOL_LIMIT = 10;

// RTDS 实时 watcher。全平台成交流约 28 条/秒,只有命中关注池的才落库。
// 大额成交推 Telegram;冷却按地址生效,避免连续成交刷屏。
export const WATCH_ALERT_MIN_USD = Number(process.env.WATCH_ALERT_MIN_USD) || 500;
export const WATCH_ALERT_COOLDOWN_MS = 60_000;
export const WATCH_RELOAD_MS = 30_000;

// 交易风控默认值(美元),可由 TRADE_MAX_USD / TRADE_DAILY_MAX_USD 覆盖。
// 默认取保守值:即使环境变量漏配,也不会放出大额单。
export const TRADE_MAX_USD_DEFAULT = 5;
export const TRADE_DAILY_MAX_USD_DEFAULT = 20;

// 买单手续费按成交额比例加在支出之上(卖单则从收入里扣,不占用支出额度)。
// 实测:名义 $2 的市价买单,交易所计的含费金额为 $2.0628,约 3.1%。
// 取 4% 作为缓冲——限额约束的应当是实际支出,宁可略严也不要超支。
export const TRADE_FEE_BUFFER = 0.04;

// ── LLM 网关 ────────────────────────────────────────────
// 逻辑模型注册表:业务代码只写逻辑名,供应商、真实模型名、单价都在这里。
// 换供应商或升级模型只改这张表,不动业务代码。
// 单价(美元/百万 token)用于账本成本核算,来源为各供应商公开定价,
// 调价后要跟着改——算出来的成本只作预算与审计,不是对账单。
//
// DeepSeek 直连:主力模型,量大且最便宜;官方 API 无钉版本 ID,
// deepseek-v4-flash 会被原地升级(当前指向 0731),留意输出分布漂移。
// 海外长尾模型走 OpenRouter 聚合,国产模型(Qwen/GLM/Kimi)走硅基流动。
// 硅基流动按人民币计价,注册表折算成美元(汇率取 7.1)供预算与账本用。
export type LlmProvider = "deepseek" | "openrouter" | "siliconflow";
export type LlmModelSpec = {
  provider: LlmProvider;
  /** 供应商侧的真实模型名 */
  model: string;
  inUsdPerM: number;
  outUsdPerM: number;
  /** 强制推理的模型(实测关思考直接 400),reasoning:"none" 自动降为最低档 */
  alwaysReasoning?: boolean;
};
export const LLM_MODELS: Record<string, LlmModelSpec> = {
  "deepseek-v4-flash": {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    inUsdPerM: 0.09,
    outUsdPerM: 0.18,
  },
  "claude-sonnet": {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-5",
    inUsdPerM: 2,
    outUsdPerM: 10,
  },
  "gemini-flash": {
    provider: "openrouter",
    model: "google/gemini-3.6-flash",
    inUsdPerM: 1.5,
    outUsdPerM: 7.5,
    // 实测:该端点 "Reasoning is mandatory ... cannot be disabled"
    alwaysReasoning: true,
  },
  "gpt-mini": {
    provider: "openrouter",
    model: "openai/gpt-5.6-luna",
    inUsdPerM: 0.1,
    outUsdPerM: 0.6,
  },
  // Qwen 旗舰,OpenRouter 接入(硅基流动未上架 3.8 系列)。
  // 实测同 gemini:强制推理不可关思考
  "qwen-max": {
    provider: "openrouter",
    model: "qwen/qwen3.8-max",
    inUsdPerM: 2,
    outUsdPerM: 6,
    alwaysReasoning: true,
  },
  // ¥0.8 / ¥6.4 每百万(<128K 上下文档位),按 7.1 折美元
  qwen: {
    provider: "siliconflow",
    model: "Qwen/Qwen3.5-122B-A10B",
    inUsdPerM: 0.11,
    outUsdPerM: 0.9,
  },
  // ¥6 / ¥24 每百万,按 7.1 折美元。GLM-5.2 已上线但未公布定价,先钉 5.1
  glm: {
    provider: "siliconflow",
    model: "Pro/zai-org/GLM-5.1",
    inUsdPerM: 0.85,
    outUsdPerM: 3.38,
  },
  // 编码特化版(通用版 K2.6 未公布定价);官网美元价
  kimi: {
    provider: "siliconflow",
    model: "moonshotai/Kimi-K2.7-Code",
    inUsdPerM: 0.86,
    outUsdPerM: 3.8,
  },
};
export const LLM_DEFAULT_MODEL = "deepseek-v4-flash";
// 日预算与并发:对齐交易风控的哲学,默认取保守值,宁可分析停摆不可账单失控
export const LLM_DAILY_MAX_USD_DEFAULT = 2;
export const LLM_CONCURRENCY = 3;
export const LLM_SPACING_MS = 1000;
// 单次调用的 max_tokens 封顶:防止单次调用写出天价(推理+正文同池)
export const LLM_MAX_TOKENS_CAP = 16384;

// Agent 接入:注册端点必须匿名可调(agent 没有凭据),因此靠「未认领配额 +
// 过期清理」限制滥用。选配额而非 IP 限速,是因为它不依赖内存状态,
// 重启与多容器都成立。
export const AGENT_UNCLAIMED_LIMIT = 20;
export const AGENT_CLAIM_TTL_MS = 24 * 3600_000;
