#!/usr/bin/env bash
# 一次性迁移:SQLite → PostgreSQL
# 用法: ./scripts/import-sqlite.sh [sqlite文件路径]
# closed_positions 按新去重键 (address, condition_id, outcome) 去重,保留时间戳最新的一行;
# scores 不迁移(导入后用 pnpm fetch --step=4 重算)。
set -euo pipefail

SQLITE_DB="${1:-data/polyorders.db}"
PG_URL="${DATABASE_URL:-postgres://polyorders:polyorders@localhost:5432/polyorders}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== 清空目标表"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -c \
  "TRUNCATE candidates, closed_positions, scores, markets, fetch_runs RESTART IDENTITY;"

echo "== candidates"
sqlite3 -csv "$SQLITE_DB" "
  SELECT address, username, leaderboard_pnl, leaderboard_vol, rank, markets_traded,
         CASE passed_prefilter WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE '' END,
         positions_fetched_at, fetched_at
  FROM candidates ORDER BY rank;" > "$TMP/candidates.csv"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -c \
  "\\copy candidates (address, username, leaderboard_pnl, leaderboard_vol, rank, markets_traded, passed_prefilter, positions_fetched_at, fetched_at) FROM '$TMP/candidates.csv' WITH (FORMAT csv, NULL '')"

echo "== closed_positions(按新去重键去重,保留最新时间戳)"
sqlite3 -csv "$SQLITE_DB" "
  SELECT address, condition_id, title, outcome, avg_price, total_bought,
         realized_pnl, MAX(timestamp)
  FROM closed_positions
  GROUP BY address, condition_id, outcome;" > "$TMP/positions.csv"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -c \
  "\\copy closed_positions (address, condition_id, title, outcome, avg_price, total_bought, realized_pnl, \"timestamp\") FROM '$TMP/positions.csv' WITH (FORMAT csv, NULL '')"

echo "== markets"
sqlite3 -csv "$SQLITE_DB" \
  "SELECT condition_id, slug, event_slug, fetched_at FROM markets;" > "$TMP/markets.csv"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -c \
  "\\copy markets (condition_id, slug, event_slug, fetched_at) FROM '$TMP/markets.csv' WITH (FORMAT csv, NULL '')"

echo "== fetch_runs"
sqlite3 -csv "$SQLITE_DB" "
  SELECT step, started_at, finished_at, addresses_ok, addresses_failed, error
  FROM fetch_runs ORDER BY id;" > "$TMP/fetch_runs.csv"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -c \
  "\\copy fetch_runs (step, started_at, finished_at, addresses_ok, addresses_failed, error) FROM '$TMP/fetch_runs.csv' WITH (FORMAT csv, NULL '')"

echo "== 行数校验"
psql "$PG_URL" -t -c "
  SELECT 'candidates: ' || COUNT(*) FROM candidates
  UNION ALL SELECT 'closed_positions: ' || COUNT(*) FROM closed_positions
  UNION ALL SELECT 'markets: ' || COUNT(*) FROM markets
  UNION ALL SELECT 'fetch_runs: ' || COUNT(*) FROM fetch_runs;"

echo "完成。请运行 pnpm fetch --step=4 重算评分。"
