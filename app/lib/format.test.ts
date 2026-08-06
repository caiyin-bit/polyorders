import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmtAgo, fmtPct, fmtTime, fmtUsd, shortAddr } from "./format";

// fmtTime 吃秒、fmtAgo 吃毫秒。曾经把毫秒喂给 fmtTime,界面显示成
// 「活跃 +058566-12」(公元五万八千年)。这组用例把单位契约钉死。
describe("时间格式化的单位契约", () => {
  const MS = Date.parse("2026-08-06T12:00:00Z");
  const SEC = MS / 1000;

  it("fmtTime 按秒解释入参", () => {
    assert.equal(fmtTime(SEC), "2026-08-06");
  });

  it("把毫秒喂给 fmtTime 会得到荒谬的年份——这正是当初的 bug", () => {
    const wrong = fmtTime(MS);
    assert.ok(
      !wrong.startsWith("2026"),
      `毫秒当秒用竟然得到了合理年份 ${wrong},说明这个断言失去意义`,
    );
  });

  it("fmtTime 对 0 与 null 返回占位符而不是 1970", () => {
    assert.equal(fmtTime(null), "-");
    assert.equal(fmtTime(0), "-");
  });

  it("fmtAgo 按毫秒解释入参", () => {
    const now = Date.now();
    assert.equal(fmtAgo(now), "刚刚");
    assert.equal(fmtAgo(now - 30_000), "30 秒前");
    assert.equal(fmtAgo(now - 5 * 60_000), "5 分钟前");
    assert.equal(fmtAgo(now - 3 * 3_600_000), "3 小时前");
    assert.equal(fmtAgo(now - 2 * 86_400_000), "2 天前");
  });

  it("fmtAgo 对未来时间不显示负数", () => {
    assert.equal(fmtAgo(Date.now() + 60_000), "刚刚");
  });
});

describe("数值格式化", () => {
  it("fmtUsd 按量级缩写", () => {
    assert.equal(fmtUsd(950), "$950");
    assert.equal(fmtUsd(1500), "$1.5k");
    assert.equal(fmtUsd(2_500_000), "$2.50M");
  });

  it("fmtUsd 负数只带一个负号", () => {
    assert.equal(fmtUsd(-1500), "-$1.5k");
    assert.equal(fmtUsd(-950), "-$950");
  });

  it("fmtUsd 与 fmtPct 的空值返回占位符", () => {
    assert.equal(fmtUsd(null), "-");
    assert.equal(fmtPct(null), "-");
  });

  it("fmtPct 把比率转成百分数", () => {
    assert.equal(fmtPct(0.9676), "96.8%");
  });

  it("shortAddr 保留首尾便于核对", () => {
    assert.equal(
      shortAddr("0x844469e1063a7ba504b8b3931ab027a3b8b9fd58"),
      "0x8444…fd58",
    );
  });
});
