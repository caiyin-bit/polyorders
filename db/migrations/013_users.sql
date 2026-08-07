-- 多用户只读 + 单一交易主体
--
-- 用户身份原先只存在于签名 cookie 里,从未落库,白名单也只在环境变量中。
-- 这里把用户持久化,并用 role 区分能力:
--   admin  —— 可下单/撤单、改关注池、管理 agent 与用户、触发抓取
--   viewer —— 只读:看盘、看持仓、看信号
--
-- 交易主体仍是唯一的那个钱包(POLYMARKET_PRIVATE_KEY),不做资金隔离。
-- 因此 role 约束的是「谁能动这一个账户」,而不是「各自的账户」。
--
-- 登录门禁保持双通道:环境变量 TELEGRAM_ALLOWED_IDS 始终有效(引导与防锁死),
-- 加上本表中 active 的用户。管理员可在界面里增删用户而无需改环境变量。

CREATE TABLE users (
  -- Telegram 数字 ID,天然唯一,不再自增
  id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  -- 谁邀请进来的(Telegram ID);环境变量引导进来的为 NULL
  invited_by BIGINT,
  created_at BIGINT NOT NULL,
  last_login_at BIGINT
);

-- 操作留痕:此前只知道是哪个 agent 下的单,不知道是哪个人
ALTER TABLE orders ADD COLUMN user_id BIGINT;
ALTER TABLE watchlist ADD COLUMN added_by BIGINT;
