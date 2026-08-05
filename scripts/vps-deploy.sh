#!/bin/sh
# VPS 上执行:拉代码并重建重启(在 /opt/polyorders/app 目录运行)
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f docker-compose.vps.yml build
docker compose -f docker-compose.vps.yml run --rm web pnpm db:migrate
docker compose -f docker-compose.vps.yml up -d
docker image prune -f
echo "deployed: $(git rev-parse --short HEAD)"
