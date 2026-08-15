#!/bin/sh
# GitHub Actions 经 SSH 强制命令进入本机的唯一入口,按 SSH_ORIGINAL_COMMAND 分发:
#   "<tag>" | "latest"  → 发布(deploy.yml):切换到该镜像版本
#   "fetch <step>"      → 抓取(fetch.yml / live.yml):在 scheduler 容器内跑 run-fetch.sh
# 数据库 2026-08-15 迁入本机内网后,runner 无法直连数据库,抓取只能这样回到 VPS 执行;
# 顺带好处是抓取从首尔 IP 发出,不再受美国 runner 的地区限制影响。
# 一把强制命令密钥覆盖两种用途,靠下面的白名单校验收口,不新增可登录密钥。
#
# 发布调用约定(见 .github/workflows/deploy.yml):
#   echo "$GHCR_TOKEN" | ssh -i <key> root@vps "<tag>"
#   - GHCR 一次性 token 从 stdin 读入 docker login,不落盘
# 本脚本不 build:镜像是 CI 产出的不可变产物,回滚 = 用旧 tag 重新触发
set -e
cd "$(dirname "$0")/.."

CMD="${SSH_ORIGINAL_COMMAND:-latest}"

# ── 抓取分发:只认 "fetch <step>",step 限白名单,杜绝参数注入 ──
case "$CMD" in
  fetch*)
    STEP="${CMD#fetch}"
    STEP="${STEP# }"
    STEP="${STEP:-all}"
    case "$STEP" in
      all|watch|1|2|3|4|5) ;;
      *) echo "非法 step: $STEP" >&2; exit 1 ;;
    esac
    exec docker compose -f docker-compose.vps.yml exec -T scheduler \
      /app/scripts/run-fetch.sh "$STEP"
    ;;
esac

# ── 发布分发:只接受 git 短/长 sha 或 latest ──
TAG="$CMD"
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

# 迁移在旧容器仍在跑时执行,与 vps-deploy.sh 同序:失败则线上保持旧版本。
# 先确保数据库就绪(首次发布时 db 容器尚不存在),否则迁移无处可去
docker compose -f docker-compose.vps.yml up -d --no-build db
docker compose -f docker-compose.vps.yml run --rm --no-deps web pnpm db:migrate
docker compose -f docker-compose.vps.yml up -d --no-build
docker image prune -f

# 部署后补一次 live 抓取,理由与锁同 vps-deploy.sh;失败不算部署失败
docker compose -f docker-compose.vps.yml exec -T scheduler /app/scripts/run-fetch.sh 5 \
  || echo "警告:部署后的 live 抓取未成功(可能与定时任务撞锁),首页动向会在下次定时抓取后更新"

echo "released: $TAG @ $(git rev-parse --short HEAD)"
