-- Top N 地址的实时数据:未平仓持仓快照(每次抓取整体替换)+ 成交流水(增量追加)

CREATE TABLE open_positions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  outcome TEXT,
  size DOUBLE PRECISION,
  avg_price DOUBLE PRECISION,
  cur_price DOUBLE PRECISION,
  initial_value DOUBLE PRECISION,
  current_value DOUBLE PRECISION,
  cash_pnl DOUBLE PRECISION,
  redeemable BOOLEAN,
  title TEXT,
  event_slug TEXT,
  fetched_at BIGINT
);
CREATE INDEX idx_op_addr ON open_positions (address);

CREATE TABLE trades (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  asset TEXT,
  side TEXT NOT NULL,
  price DOUBLE PRECISION,
  size DOUBLE PRECISION,
  usdc_size DOUBLE PRECISION,
  outcome TEXT,
  title TEXT,
  event_slug TEXT,
  transaction_hash TEXT NOT NULL,
  "timestamp" BIGINT NOT NULL,
  CONSTRAINT uq_trade UNIQUE NULLS NOT DISTINCT (address, transaction_hash, asset, side)
);
CREATE INDEX idx_trades_ts ON trades ("timestamp" DESC);
CREATE INDEX idx_trades_addr_ts ON trades (address, "timestamp" DESC);
