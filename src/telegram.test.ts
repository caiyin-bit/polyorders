import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { sendAlert } from "./telegram";

const saved = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_ALERT_CHAT_ID: process.env.TELEGRAM_ALERT_CHAT_ID,
};
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("sendAlert:未配置时的行为", () => {
  // 告警是旁路,缺配置必须静默跳过而不是抛错——否则一笔已成交的订单
  // 会因为通知发不出去而走进错误分支
  it("缺 token 时返回 false 且不抛错", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_ALERT_CHAT_ID = "1";
    assert.equal(await sendAlert("x"), false);
  });

  it("缺 chat id 时返回 false 且不抛错", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "t";
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    assert.equal(await sendAlert("x"), false);
  });

  it("两者都缺时返回 false", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    assert.equal(await sendAlert("x"), false);
  });
});
