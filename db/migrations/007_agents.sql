-- Agent 接入:agent 自主注册,人类认领所有权后方可调用 API
-- 时间单位遵循全局约定:*_at 为毫秒(Date.now())
--
-- 认领模型:注册只写一条 owner_id IS NULL 的待认领记录,此时 agent 调任何
-- 端点都被拒;人类打开 claim_token 对应的链接并登录后,写入 owner_id 才生效。
-- 这样匿名注册端点即使被滥用,也只能产生垃圾行,拿不到任何数据。

CREATE TABLE agents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT,
  description TEXT,
  -- 只存 SHA-256,明文 key 仅在注册响应里出现一次
  key_hash TEXT NOT NULL UNIQUE,
  -- 明文前缀(如 po_ag_ab12…),仅供界面识别,不参与鉴权
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read'],
  -- 认领后置 NULL,保证一次性
  claim_token TEXT UNIQUE,
  -- 认领者的 Telegram 数字 ID;为 NULL 即未认领
  owner_id BIGINT,
  claimed_at BIGINT,
  last_seen_at BIGINT,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_agents_created ON agents (created_at DESC);

-- 审计:每笔订单出自哪个 agent(人工下单为 NULL)。
-- 与 source_address 并列,后者留给第二期跟单标记被跟地址。
ALTER TABLE orders ADD COLUMN agent_id BIGINT;
