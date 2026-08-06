import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decimalsForTick,
  exposureUsd,
  floorShares,
  formatOrderAlert,
  roundTo,
  spendUsd,
} from "./order";

describe("decimalsForTick:价格精度", () => {
  it("按 tick 推导小数位", () => {
    assert.equal(decimalsForTick(0.01), 2);
    assert.equal(decimalsForTick(0.001), 3);
    assert.equal(decimalsForTick(0.0001), 4);
  });

  it("粗于 0.01 的 tick 仍保留 2 位", () => {
    // CLOB 最少接受 2 位,不能因为 tick 粗就把价格精度降到 1 位
    assert.equal(decimalsForTick(0.1), 2);
    assert.equal(decimalsForTick(1), 2);
  });
});

describe("roundTo:价格取整", () => {
  it("四舍五入到指定位数", () => {
    assert.equal(roundTo(0.2149, 3), 0.215);
    assert.equal(roundTo(0.2144, 3), 0.214);
    assert.equal(roundTo(0.5, 2), 0.5);
  });

  it("消除浮点误差,不留长尾小数", () => {
    // 0.1 + 0.2 = 0.30000000000000004,直接发给 CLOB 会因精度被拒
    assert.equal(roundTo(0.1 + 0.2, 2), 0.3);
    assert.equal(roundTo(1.005, 2), 1.0); // 二进制表示下 1.005 略小于中值
  });
});

describe("floorShares:份额取整", () => {
  it("向下取整到 2 位", () => {
    assert.equal(floorShares(9.3029), 9.3);
    assert.equal(floorShares(9.309), 9.3);
    assert.equal(floorShares(10), 10);
  });

  it("永不向上取整——宁可少买少卖也不能超量", () => {
    // 向上取整会导致卖出超过持仓、买入超过授权额度,一律被交易所拒单
    for (const v of [1.999, 0.019, 100.009]) {
      assert.ok(floorShares(v) <= v, `${v} 被放大了`);
    }
  });

  it("小于 0.01 的份额归零", () => {
    assert.equal(floorShares(0.009), 0);
  });
});

describe("exposureUsd:风控敞口折算", () => {
  it("限价买单按 份额 × 限价(曾经的 bug:按 amountUsd 取会得到 0)", () => {
    const usd = exposureUsd({
      side: "BUY",
      price: 0.5,
      size: 100,
      amountUsd: undefined,
      refPrice: 0.49,
    });
    assert.equal(usd, 50);
  });

  it("限价卖单同样按 份额 × 限价", () => {
    assert.equal(
      exposureUsd({ side: "SELL", price: 0.3, size: 10, refPrice: 0.9 }),
      3,
    );
  });

  it("限价单忽略传入的 amountUsd,以 份额 × 限价 为准", () => {
    // 否则调用方传一个小额 amountUsd 就能绕过单笔上限
    assert.equal(
      exposureUsd({ side: "BUY", price: 0.5, size: 100, amountUsd: 1, refPrice: 0.5 }),
      50,
    );
  });

  it("市价买单用美元名义", () => {
    assert.equal(
      exposureUsd({ side: "BUY", price: null, size: null, amountUsd: 2, refPrice: 0.21 }),
      2,
    );
  });

  it("市价买单缺金额时算作 0,交由限额判定拒绝", () => {
    assert.equal(
      exposureUsd({ side: "BUY", price: null, size: null, refPrice: 0.21 }),
      0,
    );
  });

  it("市价卖单按买一价折算", () => {
    assert.equal(
      exposureUsd({ side: "SELL", price: null, size: 10, refPrice: 0.25 }),
      2.5,
    );
  });

  it("市价卖单在买一价缺失时算作 0", () => {
    // refPrice 取自 bestBid,冷门市场可能没有买单
    assert.equal(
      exposureUsd({ side: "SELL", price: null, size: 10, refPrice: 0 }),
      0,
    );
  });

  it("复现线上那笔实盘单的敞口", () => {
    // 市价买 $2 → 记录的 amount_usd 就是 2(不含手续费,与线上一致)
    assert.equal(
      exposureUsd({ side: "BUY", price: null, size: null, amountUsd: 2, refPrice: 0.2145 }),
      2,
    );
  });
});

describe("formatOrderAlert:告警策略", () => {
  const req = { market: "some-slug", outcome: "yes" as const, side: "BUY" as const };
  const base = { request: req, amountUsd: 2, error: null, market: null };

  it("dry-run 一律不告警", () => {
    // 演练阶段会产生大量订单,全推会把告警刷成噪音
    for (const status of ["dry_run", "blocked", "failed", "submitted"]) {
      assert.equal(formatOrderAlert({ ...base, status, dryRun: true }, 1), null);
    }
  });

  it("实盘的风控拦截、拒单、失败、提交都告警", () => {
    for (const status of ["blocked", "rejected", "failed", "submitted"]) {
      assert.notEqual(
        formatOrderAlert({ ...base, status, dryRun: false }, 1),
        null,
        `${status} 未告警`,
      );
    }
  });

  it("未知状态不告警", () => {
    assert.equal(formatOrderAlert({ ...base, status: "pending", dryRun: false }, 1), null);
  });

  it("带上订单号、方向、金额与市场标题", () => {
    const text = formatOrderAlert(
      { ...base, status: "submitted", dryRun: false, market: { question: "会不会下雨?" } as never },
      42,
    );
    assert.match(text ?? "", /#42/);
    assert.match(text ?? "", /BUY yes \$2/);
    assert.match(text ?? "", /会不会下雨\?/);
  });

  it("附上错误原文,便于直接判断原因", () => {
    const text = formatOrderAlert(
      { ...base, status: "blocked", dryRun: false, error: "超出单笔上限:$6 > $5" },
      7,
    );
    assert.match(text ?? "", /超出单笔上限/);
  });

  it("标记发起的 agent,便于追责", () => {
    const text = formatOrderAlert(
      { ...base, request: { ...req, agentId: 3 }, status: "submitted", dryRun: false },
      8,
    );
    assert.match(text ?? "", /agent#3/);
  });

  it("无市场信息时退回原始市场引用", () => {
    const text = formatOrderAlert({ ...base, status: "failed", dryRun: false }, 9);
    assert.match(text ?? "", /some-slug/);
  });
});

describe("spendUsd:含手续费的支出", () => {
  it("买单在名义金额上加手续费缓冲", () => {
    // 实测 $2 名义单交易所计 $2.0628;缓冲取 4%,必须覆盖实测值
    const spend = spendUsd(2, "BUY");
    assert.ok(spend >= 2.0628, `缓冲不足以覆盖实测手续费: ${spend}`);
    assert.ok(spend < 2.2, `缓冲过大,额度被浪费: ${spend}`);
  });

  it("卖单不加缓冲——手续费从收入里扣,不占用支出额度", () => {
    assert.equal(spendUsd(10, "SELL"), 10);
  });

  it("0 敞口仍是 0", () => {
    assert.equal(spendUsd(0, "BUY"), 0);
  });

  it("缓冲后的支出用于风控,可能让贴着上限的单被拒", () => {
    // 名义 $4.9 在 $5 上限内,含费后超出——这正是这次修正要达到的效果
    assert.ok(spendUsd(4.9, "BUY") > 5);
  });
});
