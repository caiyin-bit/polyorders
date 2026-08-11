-- 实时面板每 10 秒按裁决和时间聚合成绩,避免随样本增长退化为全表扫描。
CREATE INDEX idx_copydec_decision_time
  ON copy_decisions (decision, decided_at DESC)
  INCLUDE (signal_id, sim_price);
