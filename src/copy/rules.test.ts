import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSignal, RULES, type SignalForRules } from "./rules";

// 一条完全合格的信号;各用例在此基础上破坏单一条件
const good = (): SignalForRules => ({
  sourceAddress: "0x1a4de519a3c4a1acfae30f9b0e8a0dc191370b39",
  side: "BUY",
  lagMs: 3_000,
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

  it("超过延迟窗口不跟(断线补齐、首次回填的旧单)", () => {
    assert.equal(reasonOf({ ...good(), lagMs: RULES.maxLagMs + 1 }), "stale");
    assert.equal(reasonOf({ ...good(), lagMs: 2 * 3_600_000 }), "stale");
  });

  it("延迟窗口边界:watch 轮询典型延迟放行", () => {
    assert.deepEqual(evaluateSignal({ ...good(), lagMs: RULES.maxLagMs }), { copy: true });
    assert.deepEqual(evaluateSignal({ ...good(), lagMs: 4 * 60_000 }), { copy: true });
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

  it("市场级排除优先于其他死因——机器人小单刷屏不得污染 too-small 统计", () => {
    assert.equal(
      reasonOf({
        ...good(),
        title: "Dogecoin Up or Down - August 12, 9AM ET",
        usd: 3,
        price: 0.99,
        lagMs: 2 * 3_600_000,
        side: "SELL",
      }),
      "excluded-market",
    );
  });

  it("判负钱包不跟,大小写不敏感", () => {
    const jarod = "0x4a3f86ed9ce6b3dac5b66e2d5478a6bf38cc4333";
    assert.equal(reasonOf({ ...good(), sourceAddress: jarod }), "blacklisted-wallet");
    assert.equal(
      reasonOf({ ...good(), sourceAddress: jarod.toUpperCase().replace("0X", "0x") }),
      "blacklisted-wallet",
    );
  });

  it("市场级排除优先于钱包黑名单——excluded-market 口径不因裁决漂移", () => {
    assert.equal(
      reasonOf({
        ...good(),
        sourceAddress: "0x6b97ebe911d7f2e5e3e8c4a0faad4a5c7c0b8d30",
        title: "Ethereum Up or Down - August 13, 9AM ET",
      }),
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
