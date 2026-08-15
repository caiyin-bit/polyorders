# 生产镜像:web(next start)与 scheduler(crond 定时抓取)共用同一构建
# 不用 standalone 输出:RUN 按钮与 scheduler 都需要完整 node_modules(tsx)
# node 24:@polymarket/client 的 engines 要求 >=24
FROM node:24-alpine AS app
RUN apk add --no-cache curl tzdata && corepack enable
# 全链路(含构建期 ISR 预渲染)使用北京时间
ENV TZ=Asia/Shanghai
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# 构建期不连数据库:库已迁至 VPS 内网(compose 网络内的 db 服务,不对外暴露),
# 页面一律运行期渲染,构建机(GitHub runner)无需也无法访问数据库
RUN pnpm build && mkdir -p data /var/log/fetch

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]

FROM app AS scheduler
COPY deploy/crontab /etc/crontabs/root
RUN chmod +x scripts/run-fetch.sh
CMD ["crond", "-f", "-l", "8"]
