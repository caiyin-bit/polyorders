import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dueHorizons, HORIZON_MS } from "./signals";

describe("dueHorizons:观测点到期判定", () => {
  const t0 = 1_700_000_000_000;

  it("刚检测到时没有任何观测点到期", () => {
    assert.deepEqual(dueHorizons(t0, t0 + 1000, new Set()), []);
  });

  it("按时间推移逐个到期", () => {
    assert.deepEqual(dueHorizons(t0, t0 + HORIZON_MS["5m"], new Set()), ["5m"]);
    assert.deepEqual(dueHorizons(t0, t0 + HORIZON_MS["1h"], new Set()), ["5m", "1h"]);
    assert.deepEqual(dueHorizons(t0, t0 + HORIZON_MS["24h"], new Set()), [
      "5m",
      "1h",
      "24h",
    ]);
  });

  it("已标记的不重复返回", () => {
    assert.deepEqual(
      dueHorizons(t0, t0 + HORIZON_MS["24h"], new Set(["5m", "1h"])),
      ["24h"],
    );
  });

  it("全部标记后为空——cron 空转成本必须为零", () => {
    assert.deepEqual(
      dueHorizons(t0, t0 + HORIZON_MS["24h"] * 2, new Set(["5m", "1h", "24h"])),
      [],
    );
  });
});
