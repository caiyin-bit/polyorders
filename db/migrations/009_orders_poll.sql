-- 订单状态轮询回填:提交后从 CLOB 查询的最新状态
-- size_matched: 已成交份额;clob_checked_at: 最近一次轮询时间(毫秒)

ALTER TABLE orders ADD COLUMN size_matched DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN clob_checked_at BIGINT;
