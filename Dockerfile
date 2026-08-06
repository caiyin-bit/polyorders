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
# 首页 ISR 预渲染在构建期访问数据库
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN pnpm build && mkdir -p data /var/log/fetch

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]

FROM app AS scheduler
COPY deploy/crontab /etc/crontabs/root
RUN chmod +x scripts/run-fetch.sh
CMD ["crond", "-f", "-l", "8"]
