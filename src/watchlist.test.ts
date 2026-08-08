import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAddress, parseWatchInput } from "./watchlist";

// 关注池是 agent 可写的接口,地址校验是它唯一的输入门槛:
// 放进一个非法值会污染抓取目标,而错误要到 5 分钟后的抓取日志里才显形
describe("normalizeAddress:地址校验", () => {
  const ADDR = "0x27f738fe203827445690339104aae35b20bc44b0";

  it("合法地址统一转小写", () => {
    assert.equal(normalizeAddress(ADDR.toUpperCase().replace("0X", "0x")), ADDR);
    assert.equal(normalizeAddress(ADDR), ADDR);
  });

  it("容忍首尾空白(从界面复制常带空格)", () => {
    assert.equal(normalizeAddress(`  ${ADDR}\n`), ADDR);
  });

  it("长度不对一律拒绝", () => {
    assert.equal(normalizeAddress(ADDR.slice(0, -1)), null);
    assert.equal(normalizeAddress(ADDR + "0"), null);
  });

  it("缺 0x 前缀或含非法字符时拒绝", () => {
    assert.equal(normalizeAddress(ADDR.slice(2)), null);
    assert.equal(normalizeAddress(ADDR.replace("a", "z")), null);
  });

  it("非字符串输入不抛错,一律返回 null", () => {
    for (const bad of [null, undefined, 123, {}, [], true]) {
      assert.equal(normalizeAddress(bad), null);
    }
  });

  it("不接受 ENS 之类的非十六进制写法", () => {
    assert.equal(normalizeAddress("vitalik.eth"), null);
  });
});


// 自由输入解析:面板「添加关注」接受人随手粘贴的各种写法,
// 解析错了轻则搜不到,重则把错误地址喂给抓取管线
describe("parseWatchInput:自由输入解析", () => {
  const ADDR = "0x3725d52f3c252e8374999cc8617292ea2608ad88";

  it("裸地址与大小写混写", () => {
    assert.deepEqual(parseWatchInput(ADDR), { kind: "address", address: ADDR });
    assert.deepEqual(parseWatchInput(ADDR.toUpperCase().replace("0X", "0x")), {
      kind: "address",
      address: ADDR,
    });
  });

  it("profile 链接提取地址", () => {
    assert.deepEqual(parseWatchInput(`https://polymarket.com/profile/${ADDR}`), {
      kind: "address",
      address: ADDR,
    });
  });

  it("带语言前缀与查询参数的 @handle 链接", () => {
    assert.deepEqual(
      parseWatchInput("https://polymarket.com/zh/@almach?via=ace-cq9c"),
      { kind: "username", username: "almach" },
    );
  });

  it("@handle 与裸用户名", () => {
    assert.deepEqual(parseWatchInput("@almach"), { kind: "username", username: "almach" });
    assert.deepEqual(parseWatchInput("almach"), { kind: "username", username: "almach" });
    assert.deepEqual(parseWatchInput("  Jarod21 \n"), { kind: "username", username: "Jarod21" });
  });

  it("解析不了的输入返回 null", () => {
    assert.equal(parseWatchInput(""), null);
    assert.equal(parseWatchInput("   "), null);
    assert.equal(parseWatchInput("https://polymarket.com/zh"), null);
    assert.equal(parseWatchInput("你好世界"), null);
    assert.equal(parseWatchInput("@"), null);
    assert.equal(parseWatchInput(42), null);
  });
});
