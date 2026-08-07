#!/bin/sh
# 手动兜底:VPS 上现场 build 并重启(正常发布走 GitHub Actions + vps-release.sh)。
# 适用于 Actions 不可用或需要部署未推送代码的紧急场景
set -e
cd "$(dirname "$0")/.."
git pull --ff-only

# 构建期 ISR 预渲染要连库,compose 的 database_url secret 从 shell 环境取值
set -a; . ./.env; set +a
docker compose -f docker-compose.vps.yml build

# 在新镜像里跑测试。位置刻意排在迁移与重启之前:测试挂掉时数据库没被动过,
# 线上容器也还在跑旧版本,失败的部署等于什么都没发生(set -e 会中止)。
# 紧急情况需要绕过时,直接手工执行下面几条 docker compose 命令即可。
docker compose -f docker-compose.vps.yml run --rm web pnpm test

docker compose -f docker-compose.vps.yml run --rm web pnpm db:migrate
docker compose -f docker-compose.vps.yml up -d
docker image prune -f

# 首页在构建期预渲染,反映的是抓取之前的数据库状态;部署后立刻补一次 live 抓取,
# 免得用户在 ISR 的 5 分钟窗口内看到过期动向。走 run-fetch.sh 是为了复用它的
# flock(与定时任务共享同一把锁,避免和 cron 撞车)与失败告警。
# 抓取失败不应让部署判定为失败,故不受 set -e 影响。
docker compose -f docker-compose.vps.yml exec -T scheduler /app/scripts/run-fetch.sh 5 \
  || echo "警告:部署后的 live 抓取未成功(可能与定时任务撞锁),首页动向会在下次定时抓取后更新"

echo "deployed: $(git rev-parse --short HEAD)"
