-- 门禁码申请流程
--
-- 不在白名单的 Telegram 用户,验签通过后处于「有身份、无权限」的待审状态,
-- 可提交访问申请;管理员在 Telegram 上点按钮批准后拿到一次性门禁码,
-- 线下转交给申请人,对方输入即以只读身份进入。
--
-- 门禁码只存哈希(同 agents.key_hash 的做法),且与申请人绑定——
-- 码泄露给第三方也用不了,校验时会比对当前会话的 Telegram ID。

CREATE TABLE access_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  -- pending 待审 / approved 已批准待输码 / rejected 已拒 / used 已使用 / expired 已过期
  status TEXT NOT NULL DEFAULT 'pending',
  code_hash TEXT,
  code_expires_at BIGINT,
  -- 输错次数,超过上限即作废,防爆破
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at BIGINT NOT NULL,
  decided_at BIGINT,
  decided_by BIGINT,
  used_at BIGINT
);

-- 按申请人查最新一条;审批与校验都走这条路径
CREATE INDEX idx_access_req_tg ON access_requests (telegram_id, requested_at DESC);
