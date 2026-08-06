#!/bin/sh
# 定时抓取入口:flock 防重叠,失败发 Telegram 告警
# 用法: run-fetch.sh 5   → 只跑 step 5(live)
#       run-fetch.sh all → 全量管线
STEP="${1:-all}"
LOCK="/tmp/fetch-${STEP}.lock"
cd /app || exit 1

if [ "$STEP" = "all" ]; then
  ARGS=""
else
  ARGS="--step=$STEP"
fi

echo "[$(date '+%F %T')] start step=$STEP"
if flock -n "$LOCK" ./node_modules/.bin/tsx src/fetch/index.ts $ARGS; then
  echo "[$(date '+%F %T')] done step=$STEP"
else
  RC=$?
  echo "[$(date '+%F %T')] FAILED step=$STEP rc=$RC"
  # watch 每 5 分钟一轮,失败不告警(否则外部故障时每 5 分钟轰炸一次);
  # 全量 live 每 2 小时会照常告警,故障不会漏报
  if [ "$STEP" != "watch" ] && [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_ALERT_CHAT_ID" ]; then
    curl -s -m 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_ALERT_CHAT_ID}" \
      --data-urlencode "text=⚠️ polyorders 抓取失败 step=${STEP} @ $(date '+%F %T') 北京时间" >/dev/null
  fi
  exit "$RC"
fi
