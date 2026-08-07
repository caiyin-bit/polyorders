import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  createPendingToken,
  createSession,
  verifyPendingToken,
  verifySession,
} from "./auth";

before(() => {
  process.env.AUTH_SECRET = "test-secret-for-unit-tests";
});

const USER = { id: 123, username: "alice" };

describe("会话与待审凭证的隔离", () => {
  it("正式会话可被 verifySession 识别", async () => {
    const t = await createSession(USER);
    assert.deepEqual(await verifySession(t), { id: 123, name: "alice" });
  });

  it("待审凭证可被 verifyPendingToken 识别", async () => {
    const t = await createPendingToken(USER);
    assert.deepEqual(await verifyPendingToken(t), { id: 123, name: "alice" });
  });

  // 两者用同一套 HMAC 签名,若不靠 typ 区分,把 po_pending 的值塞进
  // po_session 就能直接进看板——这是本设计最关键的一道边界
  it("待审凭证不能当正式会话使用", async () => {
    const pending = await createPendingToken(USER);
    assert.equal(await verifySession(pending), null);
  });

  it("正式会话不能当待审凭证使用", async () => {
    const session = await createSession(USER);
    assert.equal(await verifyPendingToken(session), null);
  });

  it("签名被篡改一律拒绝", async () => {
    const t = await createSession(USER);
    // 末位换成一个必定不同的字符:签名是十六进制,直接拼 "0" 有 1/16 概率
    // 与原值相同,那样根本没发生篡改,断言会假阴性
    const tampered = t.slice(0, -1) + (t.endsWith("0") ? "1" : "0");
    assert.notEqual(tampered, t);
    assert.equal(await verifySession(tampered), null);
    assert.equal(await verifySession("garbage"), null);
    assert.equal(await verifySession(""), null);
  });

  it("改了 payload 但不改签名会被拒", async () => {
    const t = await createSession(USER);
    const [payload, sig] = t.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ id: 999, name: "mallory", exp: 9e9 }),
      "utf8",
    ).toString("base64url");
    assert.notEqual(payload, tampered);
    assert.equal(await verifySession(`${tampered}.${sig}`), null);
  });
});
