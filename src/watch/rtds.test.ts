import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearConnectionTimers,
  closeStaleStream,
  isStreamStale,
  RTDS_EVENT_STALE_MS,
} from "./rtds";

describe("isStreamStale:RTDS 静默连接判死", () => {
  const now = 1_786_400_000_000;

  it("90 秒窗口内仍视为有活性", () => {
    assert.equal(isStreamStale(now - RTDS_EVENT_STALE_MS + 1, now), false);
  });

  it("恰好达到 90 秒即判死,触发现有重连路径", () => {
    assert.equal(isStreamStale(now - RTDS_EVENT_STALE_MS, now), true);
    assert.equal(isStreamStale(now - 30 * 60_000, now), true);
  });
});

describe("closeStaleStream:watchdog 实际触发关闭", () => {
  const now = 1_786_400_000_000;

  it("静默达到阈值调用一次关闭回调", () => {
    let closed = 0;
    assert.equal(
      closeStaleStream(now - RTDS_EVENT_STALE_MS, now, () => closed++),
      true,
    );
    assert.equal(closed, 1);
  });

  it("流仍新鲜时不关闭", () => {
    let closed = 0;
    assert.equal(closeStaleStream(now - 1_000, now, () => closed++), false);
    assert.equal(closed, 0);
  });
});

describe("clearConnectionTimers:断线不遗留旧连接定时器", () => {
  it("ping 与 watchdog 都被清理", () => {
    const cleared: number[] = [];
    clearConnectionTimers(11, 22, (id) => cleared.push(id as number));
    assert.deepEqual(cleared, [11, 22]);
  });
});
