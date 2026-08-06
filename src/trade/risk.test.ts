import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TRADE_DAILY_MAX_USD_DEFAULT, TRADE_MAX_USD_DEFAULT } from "../config";
import { bjDayStart, limitRejection, tradeLimits, type TradeLimits } from "./risk";

const ENV_KEYS = ["TRADING_ENABLED", "TRADE_MAX_USD", "TRADE_DAILY_MAX_USD"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const limits = (over: Partial<TradeLimits> = {}): TradeLimits => ({
  enabled: true,
  maxUsd: 5,
  dailyMaxUsd: 20,
  ...over,
});

describe("tradeLimits:实盘开关", () => {
  // 这是整套系统最重要的一道闸门:任何非精确 "true" 的值都必须视为关闭,
  // 否则一次手滑的配置就会把真单放出去
  it("只有精确的 'true' 才开启实盘", () => {
    process.env.TRADING_ENABLED = "true";
    assert.equal(tradeLimits().enabled, true);
  });

  for (const v of ["1", "yes", "TRUE", "True", " true", "true ", "on", ""]) {
    it(`拒绝近似值 ${JSON.stringify(v)}`, () => {
      process.env.TRADING_ENABLED = v;
      assert.equal(tradeLimits().enabled, false);
    });
  }

  it("未配置时默认关闭", () => {
    delete process.env.TRADING_ENABLED;
    assert.equal(tradeLimits().enabled, false);
  });
});

describe("tradeLimits:金额上限", () => {
  it("读取环境变量", () => {
    process.env.TRADE_MAX_USD = "12.5";
    process.env.TRADE_DAILY_MAX_USD = "99";
    assert.equal(tradeLimits().maxUsd, 12.5);
    assert.equal(tradeLimits().dailyMaxUsd, 99);
  });

  // 配错了要退回保守默认值,而不是变成 NaN 或 0 之后被绕过
  for (const bad of ["", "abc", "0", "-5", "NaN"]) {
    it(`非法值 ${JSON.stringify(bad)} 退回默认值`, () => {
      process.env.TRADE_MAX_USD = bad;
      process.env.TRADE_DAILY_MAX_USD = bad;
      assert.equal(tradeLimits().maxUsd, TRADE_MAX_USD_DEFAULT);
      assert.equal(tradeLimits().dailyMaxUsd, TRADE_DAILY_MAX_USD_DEFAULT);
    });
  }
});

describe("limitRejection:限额判定", () => {
  it("正常单放行", () => {
    assert.equal(limitRejection(2, 0, limits()), null);
  });

  it("金额为 0 或负数一律拒绝", () => {
    for (const bad of [0, -1, -0.01]) {
      assert.match(limitRejection(bad, 0, limits()) ?? "", /必须大于 0/);
    }
  });

  it("NaN 被拒绝", () => {
    // !(NaN > 0) 为 true,这里确认这个隐式行为确实拦住了 NaN
    assert.match(limitRejection(NaN, 0, limits()) ?? "", /必须大于 0/);
  });

  it("恰好等于单笔上限时放行", () => {
    assert.equal(limitRejection(5, 0, limits()), null);
  });

  it("超出单笔上限被拒", () => {
    assert.match(limitRejection(5.01, 0, limits()) ?? "", /超出单笔上限/);
  });

  it("金额一律两位小数,不漏浮点尾巴", () => {
    // 含费金额是乘出来的,99 * 1.04 = 102.96000000000001
    const msg = limitRejection(99 * 1.04, 0, limits()) ?? "";
    assert.match(msg, /\$102\.96 > \$5\.00/);
    assert.doesNotMatch(msg, /000000/);
  });

  it("日累计恰好用满时放行", () => {
    assert.equal(limitRejection(5, 15, limits()), null);
  });

  it("日累计超出一分钱即被拒", () => {
    assert.match(limitRejection(5, 15.01, limits()) ?? "", /超出日累计上限/);
  });

  it("单笔在限内但日累计已满,仍被拒", () => {
    assert.match(limitRejection(1, 20, limits()) ?? "", /超出日累计上限/);
  });

  it("单笔上限优先于日累计上限报错", () => {
    // 两者都超时应报单笔,信息更直接
    assert.match(limitRejection(100, 999, limits()) ?? "", /超出单笔上限/);
  });
});

describe("bjDayStart:北京时间自然日边界", () => {
  const at = (iso: string) => bjDayStart(Date.parse(iso));

  it("同一北京日内的不同时刻归到同一天", () => {
    assert.equal(at("2026-08-06T00:00:00+08:00"), at("2026-08-06T23:59:59+08:00"));
  });

  it("跨过北京午夜后归到新的一天", () => {
    assert.notEqual(at("2026-08-06T23:59:59+08:00"), at("2026-08-07T00:00:01+08:00"));
  });

  it("返回值正是当日北京 00:00", () => {
    assert.equal(at("2026-08-06T15:30:00+08:00"), Date.parse("2026-08-06T00:00:00+08:00"));
  });

  it("UTC 午夜不构成边界(北京已是当日 08:00)", () => {
    // 若误按 UTC 划天,这两个时刻会被分到两天,日累计限额就会在早上 8 点被重置
    assert.equal(at("2026-08-06T07:59:59+08:00"), at("2026-08-06T08:00:01+08:00"));
  });

  it("不受进程时区影响", () => {
    // 容器 TZ=Asia/Shanghai,但线上任何一台机器改了时区都不该影响判定
    const tz = process.env.TZ;
    process.env.TZ = "America/New_York";
    const ny = at("2026-08-06T15:30:00+08:00");
    process.env.TZ = tz;
    assert.equal(ny, Date.parse("2026-08-06T00:00:00+08:00"));
  });
});
