-- 实时关注池:人工圈选的地址,由 crond 每 5 分钟定向拉取持仓与成交
-- (全量 live 仍为每 2 小时覆盖 Top N)。上限在 API 层强制。

CREATE TABLE watchlist (
  address TEXT PRIMARY KEY,
  added_at BIGINT NOT NULL,
  -- watch 最近一次拉取完成时刻;不能从 open_positions 推导——空仓地址在
  -- 那里没有行,新鲜度会永远显示未拉取
  last_fetched_at BIGINT
);
