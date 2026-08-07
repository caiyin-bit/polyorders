import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canRequest,
  canVerify,
  CODE_TTL_MS,
  generateCode,
  hashCode,
  MAX_ATTEMPTS,
  parseCallback,
  REJECT_COOLDOWN_MS,
} from "./access";

const NOW = 1_786_000_000_000;

describe("generateCode:门禁码生成", () => {
  it("固定 8 位", () => {
    for (let i = 0; i < 20; i++) assert.equal(generateCode().length, 8);
  });

  // 门禁码要口头转述或手抄,0/O、1/l/I 混淆会让人反复输错
  it("不含易混字符", () => {
    for (let i = 0; i < 50; i++) {
      assert.doesNotMatch(generateCode(), /[0O1lI]/);
    }
  });

  it("每次都不同", () => {
    const set = new Set(Array.from({ length: 50 }, generateCode));
    assert.equal(set.size, 50);
  });
});

describe("hashCode:门禁码哈希", () => {
  it("大小写与空格不敏感——用户手抄难免带空格", async () => {
    const a = await hashCode("ABCD2345");
    assert.equal(await hashCode(" abcd2345 "), a);
    assert.equal(await hashCode("AbCd2345"), a);
  });

  it("不同码哈希不同", async () => {
    assert.notEqual(await hashCode("ABCD2345"), await hashCode("ABCD2346"));
  });

  it("输出是 64 位十六进制,不含明文", async () => {
    const h = await hashCode("ABCD2345");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.ok(!h.includes("ABCD"));
  });
});

describe("canRequest:能否发起申请", () => {
  it("从未申请过可以申请", () => {
    assert.equal(canRequest(undefined, NOW), null);
  });

  it("已有待审申请时不能重复提交", () => {
    assert.match(
      canRequest({ status: "pending", decided_at: null, code_expires_at: null }, NOW) ?? "",
      /已有一条待审申请/,
    );
  });

  it("已批准且门禁码未过期时,引导去输码而不是重新申请", () => {
    assert.match(
      canRequest(
        { status: "approved", decided_at: NOW, code_expires_at: NOW + CODE_TTL_MS },
        NOW,
      ) ?? "",
      /请输入管理员给你的门禁码/,
    );
  });

  it("已批准但门禁码已过期,可以重新申请", () => {
    assert.equal(
      canRequest(
        { status: "approved", decided_at: NOW - CODE_TTL_MS * 2, code_expires_at: NOW - 1 },
        NOW,
      ),
      null,
    );
  });

  it("已用过的账号提示直接登录", () => {
    assert.match(
      canRequest({ status: "used", decided_at: NOW, code_expires_at: null }, NOW) ?? "",
      /已获授权/,
    );
  });

  // 没有冷却期的话,被拒的人可以反复申请把管理员的 Telegram 刷屏
  it("被拒后处于冷却期内不能再申请", () => {
    assert.match(
      canRequest({ status: "rejected", decided_at: NOW, code_expires_at: null }, NOW + 60_000) ?? "",
      /分钟后再试/,
    );
  });

  it("冷却期满后可以重新申请", () => {
    assert.equal(
      canRequest(
        { status: "rejected", decided_at: NOW, code_expires_at: null },
        NOW + REJECT_COOLDOWN_MS + 1,
      ),
      null,
    );
  });
});

describe("canVerify:能否校验门禁码", () => {
  const approved = {
    status: "approved" as const,
    code_expires_at: NOW + CODE_TTL_MS,
    attempts: 0,
  };

  it("已批准且未过期未超次数时放行", () => {
    assert.equal(canVerify(approved, NOW), null);
  });

  it("没有申请记录时拒绝", () => {
    assert.match(canVerify(undefined, NOW) ?? "", /先提交申请/);
  });

  it("尚未审批的不能校验", () => {
    assert.match(
      canVerify({ ...approved, status: "pending" }, NOW) ?? "",
      /尚未通过审批/,
    );
  });

  it("已拒绝的不能校验", () => {
    assert.match(
      canVerify({ ...approved, status: "rejected" }, NOW) ?? "",
      /已被拒绝/,
    );
  });

  // 一次性:用过就作废,防止码被转发给第三方后重复使用
  it("已使用过的门禁码不能再用", () => {
    assert.match(canVerify({ ...approved, status: "used" }, NOW) ?? "", /已被使用/);
  });

  it("过期即失效", () => {
    assert.match(
      canVerify({ ...approved, code_expires_at: NOW - 1 }, NOW) ?? "",
      /已过期/,
    );
  });

  it("输错次数用尽后作废", () => {
    assert.match(
      canVerify({ ...approved, attempts: MAX_ATTEMPTS }, NOW) ?? "",
      /次数过多/,
    );
  });

  // 顺序很重要:过期码即便被狂试,也应先报过期而不是耗尽次数
  it("同时过期与超次数时,先报过期", () => {
    assert.match(
      canVerify(
        { ...approved, code_expires_at: NOW - 1, attempts: MAX_ATTEMPTS },
        NOW,
      ) ?? "",
      /已过期/,
    );
  });
});

describe("parseCallback:审批按钮载荷", () => {
  it("解析批准与拒绝", () => {
    assert.deepEqual(parseCallback("approve:42"), { action: "approve", id: 42 });
    assert.deepEqual(parseCallback("reject:7"), { action: "reject", id: 7 });
  });

  // 这个端点是公开的,任何构造的载荷都可能打进来
  it("拒绝畸形或伪造的载荷", () => {
    for (const bad of [
      undefined,
      "",
      "approve",
      "approve:",
      "approve:abc",
      "delete:1",
      "approve:1;drop",
      " approve:1",
      "approve:1 ",
    ]) {
      assert.equal(parseCallback(bad), null, `${bad} 本该被拒`);
    }
  });
});
