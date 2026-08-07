import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveScopes, ownerTier } from "./agent-auth";

const ENV = ["100"];

describe("ownerTier:认领人当前档位", () => {
  it("未认领视为无效", () => {
    assert.equal(ownerTier(null, ENV, null), "invalid");
  });

  it("环境变量白名单始终是管理员", () => {
    // 与登录准入的兜底逻辑保持一致:这条通道不能被界面操作关掉
    assert.equal(ownerTier(100, ENV, null), "admin");
    assert.equal(ownerTier(100, ENV, { role: "viewer", active: false }), "admin");
  });

  it("库内活跃管理员为 admin", () => {
    assert.equal(ownerTier(200, ENV, { role: "admin", active: true }), "admin");
  });

  it("库内活跃只读用户为 viewer", () => {
    assert.equal(ownerTier(200, ENV, { role: "viewer", active: true }), "viewer");
  });

  it("已停用或查无此人一律无效", () => {
    assert.equal(ownerTier(200, ENV, { role: "admin", active: false }), "invalid");
    assert.equal(ownerTier(200, ENV, null), "invalid");
  });
});

describe("effectiveScopes:权限随认领人收敛", () => {
  const FULL = ["read", "trade", "watch"];

  it("管理员认领的 agent 保留全部权限", () => {
    assert.deepEqual(effectiveScopes(FULL, "admin"), FULL);
  });

  // 这是本次修复的核心:管理员接入带 trade 的 agent 后被降为只读,
  // 若不收敛,他本人下不了单,留下的 agent 却照样能下
  it("认领人降为只读后,agent 只剩读权限", () => {
    assert.deepEqual(effectiveScopes(FULL, "viewer"), ["read"]);
  });

  it("认领人被停用后 agent 完全失效", () => {
    assert.deepEqual(effectiveScopes(FULL, "invalid"), []);
  });

  it("收敛后 trade 与 watch 一定不在", () => {
    for (const tier of ["viewer", "invalid"] as const) {
      const s = effectiveScopes(FULL, tier);
      assert.ok(!s.includes("trade"), `${tier} 仍保留了 trade`);
      assert.ok(!s.includes("watch"), `${tier} 仍保留了 watch`);
    }
  });

  it("本就只有读权限的 agent 不受降权影响", () => {
    assert.deepEqual(effectiveScopes(["read"], "viewer"), ["read"]);
  });
});
