-- 回测数据留存 + 跟单引擎(影子模式)
--
-- signals: 被跟踪地址的每笔成交 = 一条信号。best_bid/best_ask 是检测瞬间
--   的盘口——「高手 0.55 买入,我们看到时已 0.58」这个差值就是跟单成本,事后补不出
-- signal_marks: 信号后 +5m/+1h/+24h/结算 的价格观测,价格从 CLOB 历史接口回填
-- copy_decisions: 引擎对每条信号的裁决,含跳过原因;shadow 模拟成交价即回测样本
-- equity_snapshots: 我方权益每小时一行,权益曲线数据源

CREATE TABLE signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  asset TEXT,
  side TEXT NOT NULL,
  outcome TEXT,
  price DOUBLE PRECISION,
  size DOUBLE PRECISION,
  usd DOUBLE PRECISION,
  title TEXT,
  event_slug TEXT,
  -- 秒(API 原始值);detected_at 毫秒,两者之差即检测延迟
  trade_ts BIGINT NOT NULL,
  detected_at BIGINT NOT NULL,
  source TEXT NOT NULL, -- rtds(秒级) | watch(5min) | live(2h)
  best_bid DOUBLE PRECISION,
  best_ask DOUBLE PRECISION,
  transaction_hash TEXT NOT NULL,
  CONSTRAINT uq_signal UNIQUE NULLS NOT DISTINCT (address, transaction_hash, asset, side)
);
CREATE INDEX idx_signals_detected ON signals (detected_at DESC);
CREATE INDEX idx_signals_addr ON signals (address, detected_at DESC);

CREATE TABLE signal_marks (
  signal_id BIGINT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  horizon TEXT NOT NULL, -- 5m | 1h | 24h | res
  -- NULL = 观测时取不到价(市场下线等),行存在即不再重试
  price DOUBLE PRECISION,
  marked_at BIGINT NOT NULL,
  PRIMARY KEY (signal_id, horizon)
);

CREATE TABLE copy_decisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  signal_id BIGINT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  decision TEXT NOT NULL, -- copy | skip
  skip_reason TEXT,
  sim_price DOUBLE PRECISION, -- shadow:决策时 best_ask
  sim_usd DOUBLE PRECISION,
  order_id BIGINT, -- live 跟单时指向 orders.id
  decided_at BIGINT NOT NULL
);
CREATE INDEX idx_copydec_signal ON copy_decisions (signal_id);

CREATE TABLE equity_snapshots (
  ts BIGINT PRIMARY KEY,
  balance_usd DOUBLE PRECISION NOT NULL,
  positions_value DOUBLE PRECISION NOT NULL,
  unrealized_pnl DOUBLE PRECISION NOT NULL,
  realized_pnl DOUBLE PRECISION NOT NULL
);
