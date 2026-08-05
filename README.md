# polyorders

Polymarket 高胜率地址筛选终端:抓取排行榜候选地址 → 初筛 → 拉取全部已平仓仓位 → 评分排名,单页仪表盘展示。

## 技术栈

Next.js 16 + React 19 + Tailwind 4 + PostgreSQL 17(pg 驱动)。

## 线上架构(首尔)

- **VPS(Vultr icn,141.164.53.169)**:全 Docker——caddy(TLS)+ web(next start)+ scheduler(crond 定时抓取:live 每 2h、全量每日 UTC 02:00,失败发 Telegram 告警)
- **Supabase(ap-northeast-2)**:线上数据库(裁剪数据)
- **Cloudflare**:polyorders.bluesignals.cc,橙云代理
- **GitHub Actions**:仅手动兜底(fetch / live workflow_dispatch)
- 线上更新:`ssh vps` 后执行 `/opt/polyorders/app/scripts/vps-deploy.sh`

## 本地开发(Docker)

```bash
docker compose up -d          # Postgres + Web(自动 pnpm install + 迁移 + next dev)
open http://localhost:3000
```

也可只用 Docker 跑数据库、宿主机跑应用:

```bash
docker compose up -d db
pnpm install
pnpm db:migrate
pnpm dev
```

数据库连接串通过 `DATABASE_URL` 覆盖(默认 `postgres://polyorders:polyorders@localhost:5432/polyorders`,见 `.env.example`)。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动开发服务器 |
| `pnpm db:migrate` | 应用 `db/migrations/` 下未执行的迁移(按序号) |
| `pnpm fetch` | 运行完整抓取管线(四步) |
| `tsx src/fetch/index.ts --step=N [--force] [--max=N]` | 单步运行:1 候选 / 2 初筛 / 3 仓位 / 4 评分 |
| `pnpm typecheck` | TypeScript 检查 |

## 数据说明

- 去重键:`closed_positions (address, condition_id, outcome)`,重复抓取时更新为最新值
- 时间单位:`*_at` 列为毫秒(`Date.now()`);`closed_positions.timestamp` 为秒(API 原始值)
- `scores` 为派生表,可随时用 step 4 重算
- 历史 SQLite 数据的一次性导入脚本:`scripts/import-sqlite.sh`(需要 `sqlite3` 与 `psql` CLI)
