-- 钱包 AI 检视报告
--
-- 分析要跑约半分钟,而弹窗随时会被关掉:任务状态必须活在服务端,
-- 弹窗重开时按 address 捞最新一条即可恢复「分析中」或历史报告。
-- status: running 进行中 / done 完成 / error 失败。
-- running 行没有心跳,进程重启会留下永远 running 的孤儿——读侧按
-- started_at 超时(5 分钟)判定为中断,不依赖清理任务。

CREATE TABLE wallet_analyses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  content TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error TEXT,
  started_at BIGINT NOT NULL,
  finished_at BIGINT
);

-- 唯一查询路径:按地址取最新一条
CREATE INDEX idx_wallet_analyses_addr ON wallet_analyses (address, started_at DESC);
