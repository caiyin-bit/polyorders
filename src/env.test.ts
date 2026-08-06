import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectEnv } from "./env";

const base = { DATABASE_URL: "postgres://x" };
const web = {
  ...base,
  AUTH_SECRET: "s",
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_BOT_USERNAME: "u",
  TELEGRAM_ALLOWED_IDS: "1",
  TELEGRAM_ALERT_CHAT_ID: "1",
};

describe("inspectEnv:必填项", () => {
  it("worker 只需要数据库", () => {
    assert.deepEqual(inspectEnv("worker", base).fatal, []);
  });

  it("缺 DATABASE_URL 即 fatal", () => {
    assert.match(inspectEnv("worker", {}).fatal.join(), /DATABASE_URL/);
  });

  it("web 缺登录相关配置即 fatal", () => {
    const { fatal } = inspectEnv("web", base);
    for (const k of [
      "AUTH_SECRET",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_BOT_USERNAME",
      "TELEGRAM_ALLOWED_IDS",
    ]) {
      assert.ok(
        fatal.some((f) => f.includes(k)),
        `${k} 缺失时未报 fatal`,
      );
    }
  });

  it("配置齐全时 web 无 fatal", () => {
    assert.deepEqual(inspectEnv("web", web).fatal, []);
  });
});

describe("inspectEnv:交易配置的危险组合", () => {
  it("声称实盘却没有私钥,必须 fatal", () => {
    // 这个组合下下单会在最后一刻失败,而人以为系统已经能交易了
    const { fatal } = inspectEnv("worker", { ...base, TRADING_ENABLED: "true" });
    assert.match(fatal.join(), /TRADING_ENABLED=true 但 POLYMARKET_PRIVATE_KEY/);
  });

  it("实盘 + 私钥齐全时放行", () => {
    const { fatal } = inspectEnv("worker", {
      ...base,
      TRADING_ENABLED: "true",
      POLYMARKET_PRIVATE_KEY: "0xabc",
    });
    assert.deepEqual(fatal, []);
  });

  it("未开实盘时不强制要求私钥", () => {
    const { fatal } = inspectEnv("worker", { ...base, TRADING_ENABLED: "" });
    assert.deepEqual(fatal, []);
  });

  it("单笔上限大于日累计上限时警告", () => {
    const { warn } = inspectEnv("worker", {
      ...base,
      TRADE_MAX_USD: "50",
      TRADE_DAILY_MAX_USD: "20",
    });
    assert.match(warn.join(), /日累计上限形同虚设/);
  });

  it("单笔上限不超过日累计时不警告", () => {
    const { warn } = inspectEnv("worker", {
      ...base,
      TRADE_MAX_USD: "5",
      TRADE_DAILY_MAX_USD: "20",
    });
    assert.equal(warn.length, 0);
  });

  it("relayer 凭据只配一半时警告", () => {
    for (const half of [
      { POLYMARKET_RELAYER_KEY: "k" },
      { POLYMARKET_RELAYER_ADDRESS: "0x1" },
    ]) {
      const { warn } = inspectEnv("worker", { ...base, ...half });
      assert.match(warn.join(), /成对配置/);
    }
  });

  it("relayer 凭据成对或都不配时不警告", () => {
    assert.equal(inspectEnv("worker", base).warn.length, 0);
    assert.equal(
      inspectEnv("worker", {
        ...base,
        POLYMARKET_RELAYER_KEY: "k",
        POLYMARKET_RELAYER_ADDRESS: "0x1",
      }).warn.length,
      0,
    );
  });
});

describe("inspectEnv:告警可达性", () => {
  it("配了 bot 却没配告警接收者时警告", () => {
    const { warn } = inspectEnv("worker", { ...base, TELEGRAM_BOT_TOKEN: "t" });
    assert.match(warn.join(), /不会发出告警/);
  });
});
