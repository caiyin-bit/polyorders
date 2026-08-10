-- LLM 调用账本:统一网关的审计与预算依据。
--
-- 成功失败都记——失败同样消耗供应商配额,也是审计对象。
-- cost_usd 按 src/config.ts 注册表单价即时核算,只作预算闸门与用量观察,
-- 不是供应商对账单。记账是旁路:写入失败不阻断业务调用(同 Telegram 告警)。

CREATE TABLE llm_calls (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 消费方标识(如 wallet-analysis / list-analysis),审计的主维度
  caller TEXT NOT NULL,
  -- 业务关联对象(如钱包地址),问题回溯用
  ref_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL, -- ok / error
  error TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  reasoning_tokens INTEGER,
  cost_usd DOUBLE PRECISION,
  latency_ms INTEGER,
  started_at BIGINT NOT NULL,
  finished_at BIGINT
);

-- 日预算查询(按北京时间自然日 SUM 当日 cost_usd)与用量看板都按时间扫
CREATE INDEX idx_llm_calls_time ON llm_calls (started_at DESC);
