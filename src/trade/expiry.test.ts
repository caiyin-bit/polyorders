import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expirationTs,
  MAX_EXPIRY_MINUTES,
  MIN_EXPIRY_MINUTES,
  orderTypeOf,
  parseDuration,
} from "./expiry";

const ok = (r: ReturnType<typeof parseDuration>) => {
  assert.ok("minutes" in r, `期望解析成功,实际: ${JSON.stringify(r)}`);
  return r.minutes;
};
const err = (r: ReturnType<typeof parseDuration>) => {
  assert.ok("error" in r, `期望解析失败,实际: ${JSON.stringify(r)}`);
  return r.error;
};

describe("parseDuration:有效期解析", () => {
  it("留空表示不设有效期(GTC)", () => {
    for (const v of [undefined, null, ""]) assert.equal(ok(parseDuration(v)), 0);
  });

  it("纯数字按分钟", () => {
    assert.equal(ok(parseDuration(90)), 90);
    assert.equal(ok(parseDuration("90")), 90);
  });

  it("支持 m/h/d 后缀", () => {
    assert.equal(ok(parseDuration("30m")), 30);
    assert.equal(ok(parseDuration("2h")), 120);
    assert.equal(ok(parseDuration("1d")), 1440);
    assert.equal(ok(parseDuration("7d")), 10080);
  });

  it("大小写与空格都容忍", () => {
    assert.equal(ok(parseDuration(" 2H ")), 120);
    assert.equal(ok(parseDuration("1D")), 1440);
  });

  // 交易所硬性要求 3 分钟,我们取 5 分钟给网络延迟与时钟偏移留余量。
  // 卡在边界上下单会被交易所拒,不如在本地就说清楚
  it("低于下限时拒绝并说明原因", () => {
    for (const v of [1, "1m", 4, "4m"]) {
      assert.match(err(parseDuration(v)), /至少 5 分钟/);
    }
  });

  it("恰好等于下限放行", () => {
    assert.equal(ok(parseDuration(MIN_EXPIRY_MINUTES)), MIN_EXPIRY_MINUTES);
  });

  it("超过一年拒绝——多半是把秒当成了分钟", () => {
    assert.match(err(parseDuration(MAX_EXPIRY_MINUTES + 1)), /最长/);
  });

  it("负数与非法写法拒绝", () => {
    assert.match(err(parseDuration(-5)), /正数/);
    for (const v of ["abc", "2w", "1.5.2", "h", "2 hours"]) {
      assert.ok("error" in parseDuration(v), `${v} 本该被拒`);
    }
  });
});

describe("expirationTs:到期时刻", () => {
  const NOW = 1_786_000_000_000;

  it("0 表示不过期,不产生时间戳", () => {
    assert.equal(expirationTs(0, NOW), undefined);
  });

  it("按分钟换算成 Unix 秒", () => {
    assert.equal(expirationTs(30, NOW), Math.floor(NOW / 1000) + 1800);
    assert.equal(expirationTs(1440, NOW), Math.floor(NOW / 1000) + 86400);
  });

  it("输出为整秒——带小数会被交易所拒", () => {
    const ts = expirationTs(7.5, NOW);
    assert.ok(Number.isInteger(ts));
  });

  it("结果始终晚于交易所要求的 3 分钟下限", () => {
    const ts = expirationTs(MIN_EXPIRY_MINUTES, NOW)!;
    assert.ok(ts - Math.floor(NOW / 1000) >= 180 + 60, "余量不足 1 分钟");
  });
});

describe("orderTypeOf:订单类型", () => {
  it("市价单为 FAK", () => {
    assert.equal(orderTypeOf({}), "FAK");
    assert.equal(orderTypeOf({ expiryMinutes: 60 }), "FAK");
  });

  it("限价无有效期为 GTC", () => {
    assert.equal(orderTypeOf({ limitPrice: 0.5 }), "GTC");
    assert.equal(orderTypeOf({ limitPrice: 0.5, expiryMinutes: 0 }), "GTC");
  });

  it("限价带有效期为 GTD", () => {
    assert.equal(orderTypeOf({ limitPrice: 0.5, expiryMinutes: 60 }), "GTD");
  });
});
