-- RTDS watcher 的运行状态(单行)。
-- 没有它,一个静默死掉的 watcher 和「市场很安静」在界面上长得一模一样。
-- 时间单位遵循全局约定:*_at 为毫秒(Date.now())

CREATE TABLE watcher_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  connected BOOLEAN NOT NULL DEFAULT false,
  connected_at BIGINT,
  last_heartbeat_at BIGINT,
  last_event_at BIGINT,
  events_seen BIGINT NOT NULL DEFAULT 0,
  matched_seen BIGINT NOT NULL DEFAULT 0,
  last_error TEXT
);

INSERT INTO watcher_state (id) VALUES (1);
