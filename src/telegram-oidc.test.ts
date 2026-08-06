import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { audMatches } from "./telegram-oidc";

// aud 校验是「这个 id_token 是不是发给我们这个 bot 的」唯一一道检查:
// 放宽了就等于任何 Telegram 应用签发的 token 都能登进来
describe("audMatches:受众校验", () => {
  const BOT = "8739367008";

  it("字符串形式匹配", () => {
    assert.equal(audMatches(BOT, BOT), true);
  });

  it("数组形式匹配", () => {
    assert.equal(audMatches(["other", BOT], BOT), true);
  });

  it("别的 bot 不放行", () => {
    assert.equal(audMatches("1234567890", BOT), false);
    assert.equal(audMatches(["1234567890"], BOT), false);
  });

  it("缺失或空一律不放行", () => {
    assert.equal(audMatches(undefined, BOT), false);
    assert.equal(audMatches([], BOT), false);
  });

  it("数字型 aud 也能匹配(JWT 里可能不是字符串)", () => {
    assert.equal(audMatches(8739367008 as unknown as string, BOT), true);
  });

  it("不做前缀/子串匹配", () => {
    assert.equal(audMatches("87393670081", BOT), false);
    assert.equal(audMatches("873936700", BOT), false);
  });
});
