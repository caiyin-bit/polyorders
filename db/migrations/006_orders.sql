-- 我方下单记录(区别于抓取来的他人成交表 trades)
-- 时间单位遵循全局约定:created_at 为毫秒(Date.now())
-- status: dry_run 已签名未提交 / submitted 已提交 / rejected CLOB 拒绝
--         / blocked 风控拦截 / failed 本地异常

CREATE TABLE orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 第二期跟单时记录被跟的地址;手动下单为 NULL
  source_address TEXT,
  condition_id TEXT NOT NULL,
  token_id TEXT,
  market_slug TEXT,
  title TEXT,
  outcome TEXT,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  price DOUBLE PRECISION,
  size DOUBLE PRECISION,
  amount_usd DOUBLE PRECISION,
  status TEXT NOT NULL,
  dry_run BOOLEAN NOT NULL,
  clob_order_id TEXT,
  clob_status TEXT,
  error TEXT,
  request_json JSONB,
  response_json JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_orders_created ON orders (created_at DESC);
