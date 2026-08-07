# polyorders

Polymarket 高胜率地址筛选终端:抓取排行榜候选地址 → 初筛 → 拉取全部已平仓仓位 → 评分排名,单页仪表盘展示。

## 技术栈

Next.js 16 + React 19 + Tailwind 4 + PostgreSQL 17(pg 驱动)。

## 线上架构(首尔)

- **VPS(Vultr icn,141.164.53.169)**:全 Docker——caddy(TLS)+ web(next start)+ scheduler(crond 定时抓取:live 每 2h、全量每日 UTC 02:00,失败发 Telegram 告警)
- **Supabase(ap-northeast-2)**:线上数据库(裁剪数据)
- **Cloudflare**:polyorders.bluesignals.cc,橙云代理
- **CI/CD(GitHub Actions,deploy.yml)**:push main → typecheck+测试 → 构建镜像推 GHCR(app 与 scheduler 两个 target,tag 为 git 短 sha)→ SSH 触发 VPS 的 `scripts/vps-release.sh` 拉取切换。SSH 用专用密钥 + `authorized_keys` 强制命令(只能触发发布脚本);回滚 = 手动 dispatch 填旧 sha;GHCR 只保留最近 5 个版本
- **手动兜底**:Actions 不可用时 `ssh vps` 后执行 `/opt/polyorders/app/scripts/vps-deploy.sh` 现场构建;fetch / live workflow_dispatch 仍保留为抓取兜底

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
| `pnpm test` | 跑单元测试(Node 内置 test runner,无额外依赖) |
| `pnpm typecheck` | TypeScript 检查 |

## 交易(Polymarket CLOB V2)

仪表盘左栏「手动下单」面板可对任意市场下单,市场支持 slug / 页面链接 / conditionId 三种写法。

- **默认 dry-run**:`TRADING_ENABLED` 必须显式等于 `true` 才会真正提交。dry-run 会真实签名订单(从而校验 tokenId、价格精度与费用)但不发给 CLOB,记录进 `orders` 表供逐字段核对
- **双重限额**:`TRADE_MAX_USD` 单笔、`TRADE_DAILY_MAX_USD` 日累计(按北京时间自然日),留空则用 `src/config.ts` 中的保守默认值;市价买单额外用 SDK 的 `maxSpend` 卡住含手续费的总支出
- **上手顺序**:配好 `.env` 中的 `POLYMARKET_PRIVATE_KEY` → `pnpm wallet:doctor` 确认资金主体钱包与余额 → `pnpm wallet:setup` 完成授权 → 面板发一笔 dry-run 核对 → 再开 `TRADING_ENABLED`
- 资金主体**必须**是私钥派生的 **Deposit Wallet**(doctor 会打印地址)。CLOB V2 只认它,把 `POLYMARKET_WALLET_ADDRESS` 指向官网的旧 Poly Proxy 钱包会被拒单(`maker address not allowed`),所以该变量应留空
- 需要 **Relayer API Key**:polymarket.com → Settings → API Keys → Relayer API Keys 自助创建,把 Signer Address 与 Key 写进 `.env` 的 `POLYMARKET_RELAYER_ADDRESS` / `POLYMARKET_RELAYER_KEY`。没有它,SDK 无法 gasless 部署 Deposit Wallet
- 旧 Poly Proxy 里的历史资金用 `tsx scripts/migrate-to-deposit-wallet.ts <proxy> <deposit> <美元>` 迁移过来
- neg-risk 市场(多候选人盘)下单还需 neg-risk adapter 的授权,`pnpm wallet:setup` 会自动补齐缺口
- 抵押品是 **pUSD**(非 USDC.e),CLOB V2 自 2026-04-28 起生效,V1 SDK 与 V1 签名订单已失效

## Agent 接入

让自己的 AI Agent 接入,读榜单/查钱包/下单。**注册由 Agent 自主完成,人只负责转交指令与最后认领**。

- 仪表盘左栏「Agent 接入」→「接入新 Agent」生成可复制的指令,发给 Agent 即可
- Agent 读 `/SKILL.md`(公开、免登录,内容按请求 origin 动态生成)→ 调 `POST /api/agent/register` → 拿到 `apiKey` 与 `claimUrl`
- **认领是权限闸门**:未认领的 agent 调任何端点都是 403;认领页受登录保护,只有 Telegram 白名单账号能完成
- Agent 端点在 `/api/agent/*`,鉴权走 `Authorization: Bearer <apiKey>`。因 middleware 跑在 Edge 访问不了数据库,该命名空间由 middleware 放行、改在各路由内用 `requireAgent` 校验
- 下单需 `trade` 权限(默认不给,面板上单独授予),且与人工下单**共用同一套 dry-run 开关与限额**,agent 无法绕过;每笔订单记录 `agent_id` 以备审计
- **本地 CLI**:`cli/` 是零依赖命令行 `polyorder`(`npm i -g ./cli` 安装),包装上述 agent API,供开发机上的 Claude Code / Codex 直接读榜单、查钱包、下单,详见 `cli/README.md`

## 信号与跟单(影子模式)

- 被跟踪地址(Top 20 + 关注池)的每笔成交落入 `signals`,RTDS 路径带检测瞬间的盘口(买一/卖一);每 5 分钟的 cron 用 CLOB 历史价接口补 +5m/+1h/+24h 观测与结算终值(`signal_marks`)
- 跟单引擎挂在两条信号路径上(RTDS 实时 + watch 轮询兜底),默认 **shadow**:按策略规则(`src/copy/rules.ts`)对关注池的每条信号做裁决并记录 `copy_decisions`(含跳过原因与模拟成交价),一分钱不动。新鲜度按实际检测延迟判(超过 6 分钟跳 `stale`),不看来源。实盘跟单需 `TRADING_ENABLED` 与 `COPY_TRADING_ENABLED` 双开关,且受独立日预算约束
- 成绩单看 `/api/agent/copystats` 或 `polyorder copystats`:按持有期的模拟收益、跳过原因分布、分来源钱包表现——live 开闸与否由这份数据说了算
- 我方权益每小时快照进 `equity_snapshots`

## 数据说明

- 去重键:`closed_positions (address, condition_id, outcome)`,重复抓取时更新为最新值
- 时间单位:`*_at` 列为毫秒(`Date.now()`);`closed_positions.timestamp` 为秒(API 原始值)
- `scores` 为派生表,可随时用 step 4 重算
- 历史 SQLite 数据的一次性导入脚本:`scripts/import-sqlite.sh`(需要 `sqlite3` 与 `psql` CLI)
