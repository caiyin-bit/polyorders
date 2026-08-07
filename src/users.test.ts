import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envAllowedIds, loginDecision } from "./users";

// 登录准入是最容易把自己锁在门外的地方:环境变量白名单必须永远有效,
// 且不受界面上的停用/降权影响。
describe("loginDecision:登录准入", () => {
  const ENV = ["100", "200"];

  it("环境变量白名单首次登录即为管理员", () => {
    assert.deepEqual(loginDecision(100, ENV, undefined), {
      allow: true,
      role: "admin",
    });
  });

  it("不在白名单且库里没有记录的,拒绝登录", () => {
    assert.equal(loginDecision(999, ENV, undefined).allow, false);
  });

  it("库内 active 用户按其角色放行", () => {
    assert.deepEqual(
      loginDecision(300, ENV, { active: true, role: "viewer" }),
      { allow: true, role: "viewer" },
    );
    assert.deepEqual(
      loginDecision(301, ENV, { active: true, role: "admin" }),
      { allow: true, role: "admin" },
    );
  });

  it("库内已停用的用户拒绝登录", () => {
    assert.equal(
      loginDecision(300, ENV, { active: false, role: "admin" }).allow,
      false,
    );
  });

  // 防锁死:即便误把内置管理员在库里停用或降权,仍能从环境变量登录回来
  it("环境变量白名单即使被停用也放行,且强制为管理员", () => {
    assert.deepEqual(loginDecision(100, ENV, { active: false, role: "viewer" }), {
      allow: true,
      role: "admin",
    });
  });

  it("环境变量为空时,只有库内 active 用户能登录", () => {
    assert.equal(loginDecision(100, [], undefined).allow, false);
    assert.equal(
      loginDecision(100, [], { active: true, role: "viewer" }).allow,
      true,
    );
  });
});

describe("envAllowedIds:白名单解析", () => {
  it("逗号分隔并容忍空格", () => {
    assert.deepEqual(
      envAllowedIds({ TELEGRAM_ALLOWED_IDS: " 100, 200 ,300 " }),
      ["100", "200", "300"],
    );
  });

  it("未配置或空串返回空数组", () => {
    assert.deepEqual(envAllowedIds({}), []);
    assert.deepEqual(envAllowedIds({ TELEGRAM_ALLOWED_IDS: "" }), []);
    assert.deepEqual(envAllowedIds({ TELEGRAM_ALLOWED_IDS: " , , " }), []);
  });
});
