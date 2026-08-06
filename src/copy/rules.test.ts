import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSignal, RULES, type SignalForRules } from "./rules";

// 一条完全合格的信号;各用例在此基础上破坏单一条件
const good = (): SignalForRules => ({
  side: "BUY",
  source: "rtds",
  price: 0.55,
  usd: 500,
  title: "Will X win the election?",
  bestAsk: 0.56,
});

const reasonOf = (s: SignalForRules): string | null => {
  const v = evaluateSignal(s);
  return v.copy ? null : v.reason;
};

describe("evaluateSignal:策略 v1", () => {
  it("合格信号放行", () => {
    assert.deepEqual(evaluateSignal(good()), { copy: true });
  });

  it("只跟买入", () => {
    assert.equal(reasonOf({ ...good(), side: "SELL" }), "non-buy");
  });

  it("轮询来源一律不实时跟(它们已滞后 5min~2h)", () => {
    assert.equal(reasonOf({ ...good(), source: "watch" }), "stale-source");
    assert.equal(reasonOf({ ...good(), source: "live" }), "stale-source");
  });

  it("价格带过滤:0.9+ 收尾盘与超低价彩票都不跟", () => {
    assert.equal(reasonOf({ ...good(), price: 0.9 }), "price-band");
    assert.equal(reasonOf({ ...good(), price: 0.99 }), "price-band");
    assert.equal(reasonOf({ ...good(), price: 0.04 }), "price-band");
    assert.equal(reasonOf({ ...good(), price: null }), "price-band");
  });

  it("价格带边界值放行", () => {
    assert.deepEqual(evaluateSignal({ ...good(), price: 0.05, bestAsk: 0.05 }), { copy: true });
    assert.deepEqual(evaluateSignal({ ...good(), price: 0.85, bestAsk: 0.85 }), { copy: true });
  });

  it("小额试探不跟", () => {
    assert.equal(reasonOf({ ...good(), usd: 199 }), "too-small");
    assert.equal(reasonOf({ ...good(), usd: null }), "too-small");
  });

  it("5 分钟币价盘不跟(结算周期短于执行延迟)", () => {
    assert.equal(
      reasonOf({ ...good(), title: "Bitcoin Up or Down - August 7, 3:05PM ET" }),
      "excluded-market",
    );
  });

  it("没抓到盘口不跟——没有成本证据的单不进样本", () => {
    assert.equal(reasonOf({ ...good(), bestAsk: null }), "no-book");
  });

  it("价格已经跑了不跟", () => {
    // 0.55 × 1.03 = 0.5665
    assert.equal(reasonOf({ ...good(), bestAsk: 0.57 }), "price-ran");
  });

  it("盘口保护的边界:恰好 3% 以内放行", () => {
    assert.deepEqual(evaluateSignal({ ...good(), bestAsk: 0.55 * RULES.maxAskRatio }), {
      copy: true,
    });
  });
});
