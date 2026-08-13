import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COPY_READINESS,
  MIN_CI_SAMPLES,
  evaluateCopyReadiness,
  feeAdjustedReturn,
  isExecutableOutcome,
  shouldReportNormalCi,
  type CopyReadinessMetrics,
} from "./stats";

describe("feeAdjustedReturn:影子收益扣除实测买入费率", () => {
  it("价格不动时应体现 3.1% 实测买入费用造成的亏损", () => {
    assert.ok(Math.abs(feeAdjustedReturn(0) - (1 / 1.031 - 1)) < 1e-12);
  });

  it("毛收益 3.1% 时费后恰好打平", () => {
    assert.ok(Math.abs(feeAdjustedReturn(0.031)) < 1e-12);
  });
});

describe("isExecutableOutcome:当前实盘只支持 yes/no", () => {
  it("大小写 yes/no 都可执行", () => {
    assert.equal(isExecutableOutcome("Yes"), true);
    assert.equal(isExecutableOutcome("no"), true);
  });

  it("队名、空值与空串都不可执行", () => {
    assert.equal(isExecutableOutcome("Seattle Storm"), false);
    assert.equal(isExecutableOutcome(null), false);
    assert.equal(isExecutableOutcome(""), false);
  });
});

describe("shouldReportNormalCi:小样本不伪装成可信 95% 区间", () => {
  it("低于 30 条隐藏,达到 30 条才展示大样本近似", () => {
    assert.equal(shouldReportNormalCi(MIN_CI_SAMPLES - 1), false);
    assert.equal(shouldReportNormalCi(MIN_CI_SAMPLES), true);
  });
});

describe("evaluateCopyReadiness:实盘开闸五项门槛", () => {
  const ready: CopyReadinessMetrics = {
    observedDays: COPY_READINESS.minDays,
    resolvedExecutable: COPY_READINESS.minResolved,
    netAvgReturn: 0.01,
    maxWalletShare: COPY_READINESS.maxWalletShare - 0.01,
    rtdsLive: true,
    rtdsConnectedForMs: COPY_READINESS.minRtdsStableMs,
  };

  it("五项全部达标才 ready", () => {
    const result = evaluateCopyReadiness(ready);
    assert.equal(result.ready, true);
    assert.equal(result.checks.length, 5);
    assert.equal(result.checks.every((c) => c.pass), true);
  });

  it("样本天数、结算数与费后收益任一不达标都拒绝", () => {
    for (const metrics of [
      { ...ready, observedDays: COPY_READINESS.minDays - 0.01 },
      { ...ready, resolvedExecutable: COPY_READINESS.minResolved - 1 },
      { ...ready, netAvgReturn: 0 },
      { ...ready, netAvgReturn: null },
    ]) {
      assert.equal(evaluateCopyReadiness(metrics).ready, false);
    }
  });

  it("最大钱包占比必须严格低于 50%", () => {
    assert.equal(
      evaluateCopyReadiness({
        ...ready,
        maxWalletShare: COPY_READINESS.maxWalletShare,
      }).ready,
      false,
    );
  });

  it("RTDS 必须健康且当前连接连续满 24 小时", () => {
    assert.equal(evaluateCopyReadiness({ ...ready, rtdsLive: false }).ready, false);
    assert.equal(
      evaluateCopyReadiness({
        ...ready,
        rtdsConnectedForMs: COPY_READINESS.minRtdsStableMs - 1,
      }).ready,
      false,
    );
  });
});
