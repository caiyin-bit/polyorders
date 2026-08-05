-- 初始 schema(自 SQLite 迁移,修正:去重键不再包含易变的 timestamp)
-- 时间单位约定:*_at / started_at / finished_at 为毫秒(Date.now());
-- closed_positions.timestamp 为秒(Polymarket API 原始值)

CREATE TABLE candidates (
  address TEXT PRIMARY KEY,
  username TEXT,
  leaderboard_pnl DOUBLE PRECISION,
  leaderboard_vol DOUBLE PRECISION,
  rank INTEGER,
  markets_traded INTEGER,
  passed_prefilter BOOLEAN,
  positions_fetched_at BIGINT,
  fetched_at BIGINT
);

CREATE TABLE closed_positions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  title TEXT,
  outcome TEXT,
  avg_price DOUBLE PRECISION,
  total_bought DOUBLE PRECISION,
  realized_pnl DOUBLE PRECISION NOT NULL,
  "timestamp" BIGINT,
  CONSTRAINT uq_position UNIQUE NULLS NOT DISTINCT (address, condition_id, outcome)
);

CREATE INDEX idx_cp_addr_ts ON closed_positions (address, "timestamp" DESC);
-- 覆盖索引:评分全表聚合无需回表
CREATE INDEX idx_cp_addr_pnl ON closed_positions (address) INCLUDE (realized_pnl);

CREATE TABLE scores (
  address TEXT PRIMARY KEY,
  total_positions INTEGER,
  winning_positions INTEGER,
  win_rate DOUBLE PRECISION,
  total_realized_pnl DOUBLE PRECISION,
  avg_pnl DOUBLE PRECISION,
  score DOUBLE PRECISION,
  rank INTEGER,
  computed_at BIGINT
);

CREATE TABLE fetch_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  step TEXT,
  started_at BIGINT,
  finished_at BIGINT,
  addresses_ok INTEGER,
  addresses_failed INTEGER,
  error TEXT
);

CREATE TABLE markets (
  condition_id TEXT PRIMARY KEY,
  slug TEXT,
  event_slug TEXT,
  fetched_at BIGINT
);
