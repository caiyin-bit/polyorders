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
| `pnpm wallet:doctor` | 交易钱包体检:地址、pUSD 余额、授权、风控配置 |
| `pnpm wallet:setup` | 一次性交易授权(幂等) |
| `pnpm typecheck` | TypeScript 检查 |

## 交易(Polymarket CLOB V2)

仪表盘左栏「手动下单」面板可对任意市场下单,市场支持 slug / 页面链接 / conditionId 三种写法。

- **默认 dry-run**:`TRADING_ENABLED` 必须显式等于 `true` 才会真正提交。dry-run 会真实签名订单(从而校验 tokenId、价格精度与费用)但不发给 CLOB,记录进 `orders` 表供逐字段核对
- **双重限额**:`TRADE_MAX_USD` 单笔、`TRADE_DAILY_MAX_USD` 日累计(按北京时间自然日),留空则用 `src/config.ts` 中的保守默认值;市价买单额外用 SDK 的 `maxSpend` 卡住含手续费的总支出
- **上手顺序**:配好 `.env` 中的 `POLYMARKET_PRIVATE_KEY` → `pnpm wallet:doctor` 确认资金主体钱包与余额 → `pnpm wallet:setup` 完成授权 → 面板发一笔 dry-run 核对 → 再开 `TRADING_ENABLED`
- 资金主体默认是私钥派生的 **Deposit Wallet**,与在官网充值的钱包很可能不是同一个;doctor 会把地址打出来。要沿用官网账户,把 `POLYMARKET_WALLET_ADDRESS` 设为该钱包地址
- 抵押品是 **pUSD**(非 USDC.e),CLOB V2 自 2026-04-28 起生效,V1 SDK 与 V1 签名订单已失效

## 数据说明

- 去重键:`closed_positions (address, condition_id, outcome)`,重复抓取时更新为最新值
- 时间单位:`*_at` 列为毫秒(`Date.now()`);`closed_positions.timestamp` 为秒(API 原始值)
- `scores` 为派生表,可随时用 step 4 重算
- 历史 SQLite 数据的一次性导入脚本:`scripts/import-sqlite.sh`(需要 `sqlite3` 与 `psql` CLI)
