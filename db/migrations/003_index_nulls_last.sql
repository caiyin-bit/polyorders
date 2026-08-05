-- 索引排序方向与查询完全一致(DESC NULLS LAST),使 LIMIT 能走索引顺序提前终止;
-- 否则每地址全量扫描后排序(702 地址 × 平均 852 行)
DROP INDEX idx_cp_addr_ts;
CREATE INDEX idx_cp_addr_ts ON closed_positions (address, "timestamp" DESC NULLS LAST)
  INCLUDE (realized_pnl);
