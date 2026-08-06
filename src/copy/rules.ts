// 跟单策略 v1。规则刻意保守,全部可测;参数靠 shadow 数据迭代,
// 所以是常量而不是配置界面——现在做灵活配置是过度设计。

export const STRATEGY = "v1";

export const RULES = {
  /** 只跟这个价格带。0.9+ 的收尾盘跟必亏(延迟吃光利润),超低价是彩票 */
  minPrice: 0.05,
  maxPrice: 0.85,
  /** 只跟真金白银的表态,滤掉高手的小额试探 */
  minUsd: 200,
  /** 盘口保护:当前卖一超出信号价 3% 说明价格已经跑了 */
  maxAskRatio: 1.03,
  /** 同一 (市场, outcome, 方向) 的冷却窗口 */
  cooldownMs: 24 * 3_600_000,
} as const;

/** 5 分钟币价盘:结算周期短于我们的执行延迟,永远别跟 */
const EXCLUDED_TITLE = /\bUp or Down\b/i;

export type SignalForRules = {
  side: string;
  source: string;
  price: number | null;
  usd: number | null;
  title: string | null;
  bestAsk: number | null;
};

export type Verdict = { copy: true } | { copy: false; reason: string };

export function evaluateSignal(s: SignalForRules): Verdict {
  const skip = (reason: string): Verdict => ({ copy: false, reason });

  // v1 只跟买入开仓;来源方的卖出作为我们的退出信号是第二期的事
  if (s.side !== "BUY") return skip("non-buy");
  // 轮询来源的信号已滞后 5min~2h,实时跟单只认 RTDS;它们仍会被 marks 观测,
  // 用于离线回答「带延迟跟单还有没有肉」
  if (s.source !== "rtds") return skip("stale-source");
  if (s.price == null || s.price < RULES.minPrice || s.price > RULES.maxPrice) {
    return skip("price-band");
  }
  if ((s.usd ?? 0) < RULES.minUsd) return skip("too-small");
  if (s.title && EXCLUDED_TITLE.test(s.title)) return skip("excluded-market");
  if (s.bestAsk == null) return skip("no-book");
  if (s.bestAsk > s.price * RULES.maxAskRatio) return skip("price-ran");
  return { copy: true };
}
