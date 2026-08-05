-- sparkline/详情查询的覆盖索引:LATERAL 每地址取最近 N 笔时无需回表
DROP INDEX idx_cp_addr_ts;
CREATE INDEX idx_cp_addr_ts ON closed_positions (address, "timestamp" DESC)
  INCLUDE (realized_pnl);
