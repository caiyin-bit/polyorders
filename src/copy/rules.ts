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
  /** 最大可接受的检测延迟。watch 轮询每 5 分钟一轮,给足一轮+抓取余量;
   * 更旧的信号(断线补齐、首次回填)只配做 marks 离线观测,不进裁决样本 */
  maxLagMs: 6 * 60_000,
  /** 同一 (市场, outcome, 方向) 的冷却窗口 */
  cooldownMs: 24 * 3_600_000,
} as const;

/** 5 分钟币价盘:结算周期短于我们的执行延迟,永远别跟 */
const EXCLUDED_TITLE = /\bUp or Down\b/i;

export type SignalForRules = {
  side: string;
  /** 检测时刻 − 成交时刻,毫秒 */
  lagMs: number;
  price: number | null;
  usd: number | null;
  title: string | null;
  bestAsk: number | null;
};

export type Verdict = { copy: true } | { copy: false; reason: string };

export function evaluateSignal(s: SignalForRules): Verdict {
  const skip = (reason: string): Verdict => ({ copy: false, reason });

  // 市场级排除最先判:这类盘无论金额、方向、新鲜度都永远不跟,
  // 先判才能让 skip 统计反映真实死因——否则刷 5 分钟币价盘的机器人
  // 会把海量小单计入 too-small,污染后续的门槛反事实回测
  if (s.title && EXCLUDED_TITLE.test(s.title)) return skip("excluded-market");
  // v1 只跟买入开仓;来源方的卖出作为我们的退出信号是第二期的事
  if (s.side !== "BUY") return skip("non-buy");
  // 新鲜度按实际检测延迟判,不看来源:RTDS 秒级通过,watch 轮询多数在窗口内,
  // 真跑掉的价格由下面的盘口保护兜住。超窗的只配做 marks 离线观测
  if (s.lagMs > RULES.maxLagMs) return skip("stale");
  if (s.price == null || s.price < RULES.minPrice || s.price > RULES.maxPrice) {
    return skip("price-band");
  }
  if ((s.usd ?? 0) < RULES.minUsd) return skip("too-small");
  if (s.bestAsk == null) return skip("no-book");
  if (s.bestAsk > s.price * RULES.maxAskRatio) return skip("price-ran");
  return { copy: true };
}
