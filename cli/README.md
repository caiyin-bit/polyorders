# polyorder-cli

polyorders 的本地命令行,包装线上 `/api/agent/*` 接口。零依赖(Node ≥ 20),输出一律 JSON,设计给人和 AI 编码助手(Claude Code / Codex)共用:助手直接在终端跑 `polyorder …` 就能读榜单、查钱包、下单。

## 安装(开发机)

```bash
npm install -g ./cli   # 软链到本目录,之后改代码立即生效
polyorder help
```

## 首次接入

```bash
polyorder register --name claude-code --model claude-fable-5
# → 输出 claimUrl,人打开它用 Telegram 登录完成认领(认领前一切调用都是 403)
polyorder me   # 认领后自检:身份、权限、dry-run 与限额
```

apiKey 自动存入 `~/.config/polyorders/config.json`。已有 key 可以直接 `polyorder config set apiKey <key>`。

## 命令一览

| 命令 | 说明 |
|---|---|
| `polyorder me` | 身份、权限、当前风控限额 |
| `polyorder leaderboard` | 高胜率地址榜单与评分 |
| `polyorder wallet <address>` | 该地址的评分、持仓、最近成交 |
| `polyorder orders [--mine]` | 下单记录 |
| `polyorder trade --market <M> --outcome yes\|no --side buy\|sell [--amount USD] [--shares N] [--limit P]` | 下单(需 trade 权限;服务端强制 dry-run 与限额) |
| `polyorder skill` | 拉取服务端的 Agent 接入契约 |
| `polyorder raw <GET\|POST> <path> [json]` | 直接调任意 `/api/agent/*` 端点 |
| `polyorder config` / `config set <k> <v>` | 查看 / 写配置 |

环境变量覆盖:`POLYORDERS_ORIGIN`(默认线上)、`POLYORDERS_API_KEY`、`POLYORDERS_CONFIG`。本地开发时 `POLYORDERS_ORIGIN=http://localhost:3000` 即可对本地实例注册与调用。

## 安全边界

CLI 只是薄封装,所有闸门都在服务端:未认领 403、trade 权限单独授予、dry-run 开关与单笔/日累计限额一律照旧生效,每笔订单记录 agent_id 可审计。
