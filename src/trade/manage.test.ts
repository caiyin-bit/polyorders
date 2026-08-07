import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cancelEligibility, interpretCancel } from "./manage";

const ID = "0x6790af119aa334989324734642029b2032ee52ea21da1fbece30d8aa7e6dd39e";

describe("interpretCancel:撤单回执解读", () => {
  it("在 canceled 列表里视为成功", () => {
    assert.deepEqual(interpretCancel({ canceled: [ID] }, ID), {
      ok: true,
      clobOrderId: ID,
    });
  });

  it("被拒时带回交易所给的原因", () => {
    const r = interpretCancel({ notCanceled: { [ID]: "order not found" } }, ID);
    assert.equal(r.ok, false);
    assert.equal(r.error, "order not found");
  });

  // 这条是本模块最重要的断言:默认成功会让「以为撤了其实没撤」的单
  // 继续挂在盘上,属于最危险的静默失败
  it("既没确认也没拒绝时,必须当失败", () => {
    assert.equal(interpretCancel({}, ID).ok, false);
    assert.equal(interpretCancel({ canceled: [] }, ID).ok, false);
    assert.equal(interpretCancel({ canceled: ["0xother"] }, ID).ok, false);
  });

  it("拒绝原因优先于成功列表——两者同时出现按失败处理", () => {
    const r = interpretCancel(
      { canceled: [ID], notCanceled: { [ID]: "already filled" } },
      ID,
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "already filled");
  });

  it("只认自己这一单,别人的回执不算数", () => {
    assert.equal(
      interpretCancel({ notCanceled: { "0xother": "nope" }, canceled: [] }, ID).ok,
      false,
    );
  });
});

describe("cancelEligibility:可撤性判定", () => {
  const submitted = {
    clob_order_id: ID,
    status: "submitted",
    dry_run: false,
  };

  it("已提交的实盘单可撤", () => {
    assert.equal(cancelEligibility(1, submitted), null);
  });

  it("订单不存在", () => {
    assert.match(cancelEligibility(42, undefined) ?? "", /订单 42 不存在/);
  });

  it("dry-run 单没进交易所,无需撤销", () => {
    assert.match(
      cancelEligibility(1, { ...submitted, dry_run: true }) ?? "",
      /未提交到交易所/,
    );
  });

  it("没有 CLOB 订单号的单同样无需撤销", () => {
    assert.match(
      cancelEligibility(1, { ...submitted, clob_order_id: null }) ?? "",
      /未提交到交易所/,
    );
  });

  it("终态单不可撤,并说明当前状态", () => {
    for (const status of ["canceled", "failed", "blocked", "rejected"]) {
      const msg = cancelEligibility(1, { ...submitted, status }) ?? "";
      assert.match(msg, /不可撤销/);
      assert.match(msg, new RegExp(status));
    }
  });
});
