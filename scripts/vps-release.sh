#!/bin/sh
# 标准发布路径:GitHub Actions 构建并推送镜像后,经 SSH 强制命令调本脚本切换版本。
# 调用约定(见 .github/workflows/deploy.yml):
#   echo "$GHCR_TOKEN" | ssh -i <key> root@vps "<tag>"
#   - tag 取自 SSH_ORIGINAL_COMMAND(强制命令下客户端命令原样进这个变量),
#     只接受 git 短/长 sha 或 latest,其余一律拒绝
#   - GHCR 一次性 token 从 stdin 读入 docker login,不落盘
# 本脚本不 build:镜像是 CI 产出的不可变产物,回滚 = 用旧 tag 重新触发
set -e
cd "$(dirname "$0")/.."

TAG="${SSH_ORIGINAL_COMMAND:-latest}"
case "$TAG" in
  latest) ;;
  *[!0-9a-f]*) echo "非法 tag: $TAG" >&2; exit 1 ;;
  ???????*) ;; # ≥7 位十六进制,即 git sha
  *) echo "非法 tag: $TAG" >&2; exit 1 ;;
esac

# 同步编排文件(compose/Caddyfile/脚本)。容器内容来自镜像,工作副本只管编排
git pull --ff-only

docker login ghcr.io -u caiyin-bit --password-stdin

export IMAGE_TAG="$TAG"
docker compose -f docker-compose.vps.yml pull web scheduler
docker logout ghcr.io

# 迁移在旧容器仍在跑时执行,与 vps-deploy.sh 同序:失败则线上保持旧版本
docker compose -f docker-compose.vps.yml run --rm --no-deps web pnpm db:migrate
docker compose -f docker-compose.vps.yml up -d --no-build
docker image prune -f

# 部署后补一次 live 抓取,理由与锁同 vps-deploy.sh;失败不算部署失败
docker compose -f docker-compose.vps.yml exec -T scheduler /app/scripts/run-fetch.sh 5 \
  || echo "警告:部署后的 live 抓取未成功(可能与定时任务撞锁),首页动向会在下次定时抓取后更新"

echo "released: $TAG @ $(git rev-parse --short HEAD)"
