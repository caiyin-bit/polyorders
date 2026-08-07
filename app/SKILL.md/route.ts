import { requestOrigin } from "@/src/agent-auth";

export const dynamic = "force-dynamic";

/**
 * 给 AI Agent 读的接入契约。
 *
 * 这份文档的读者是 LLM 而非人,歧义会直接变成接入失败,所以措辞要能被
 * 一次读懂并照做。origin 从请求推导,本地开发与线上各自指向自己。
 */
function skill(origin: string): string {
  return `# 接入 polyorders

polyorders 是一个 Polymarket 高胜率钱包筛选与交易终端。你正在读的是给 AI Agent 的接入契约:照下面的步骤做,你就能拿到调用它 API 的凭据。

整个流程由你自主完成,只有最后一步「认领」必须由人类操作。

## 接入后你能做什么

- 读取高胜率地址榜单与评分
- 查询指定钱包的持仓与最近成交
- 查询下单记录
- 代表你的人类主人在 Polymarket 下单(需要额外授权,见文末边界说明)

## 第 1 步:注册

    POST ${origin}/api/agent/register
    Content-Type: application/json

    {"name": "你的名字", "model": "你的模型标识", "description": "一句话说明你是谁"}

只有 \`name\` 是必填的。示例:

    curl -X POST ${origin}/api/agent/register \\
      -H 'content-type: application/json' \\
      -d '{"name":"my-agent","model":"claude-opus-5","description":"帮我盯盘"}'

你会拿到:

    {
      "agentId": 1,
      "apiKey": "po_ag_……",
      "claimUrl": "${origin}/agents/claim/……"
    }

## 第 2 步:保存 apiKey

\`apiKey\` **只出现这一次**,服务端只保存它的哈希,无法再次给你。请立刻存进你的配置或密钥管理里。丢了只能重新注册。

## 第 3 步:把 claimUrl 交还给人类(最关键的一步)

**你自己无法完成认领。** 请把 \`claimUrl\` 原样输出给发起这次对话的人,并告诉他:打开链接、用 Telegram 登录、点确认。

在他完成认领之前,你带着 apiKey 调用任何端点都会收到 403。这是设计如此——注册不等于获得权限,所有权必须由人类确认。所以不要在这一步卡住重试,直接把链接交出去。

## 认领之后:如何调用

所有请求都带上:

    Authorization: Bearer <apiKey>

先自检一下,确认认领已生效:

    curl ${origin}/api/agent/me -H 'authorization: Bearer <apiKey>'

### 可用端点

| 方法 | 路径 | 需要权限 | 说明 |
|---|---|---|---|
| GET | \`/api/agent/me\` | read | 你的身份、已获权限、当前风控限额 |
| GET | \`/api/agent/leaderboard\` | read | 入选地址榜单与评分 |
| GET | \`/api/agent/wallet/{address}\` | read | 该地址的持仓与最近成交 |
| GET | \`/api/agent/portfolio\` | read | 我方交易钱包的现金、持仓与盈亏 |
| GET | \`/api/agent/copystats\` | read | 跟单引擎成绩单(shadow 模拟收益、分钱包表现) |
| GET | \`/api/agent/signals\` | read | 原始信号流(含引擎裁决、检测延迟、各持有期观测价) |
| GET | \`/api/agent/watchlist\` | read | 实时关注池与 watcher 连接状态 |
| GET | \`/api/agent/orders\` | read | 下单记录 |
| GET | \`/api/agent/openorders\` | read | 交易所上未成交的挂单 |
| POST/DELETE | \`/api/agent/watchlist\` | **watch** | 增删关注池地址 |
| POST | \`/api/agent/trade\` | **trade** | 下单 |
| DELETE | \`/api/agent/openorders\` | **trade** | 撤单 |

### 实时关注与跟单引擎

关注池决定了系统盯哪些地址的实时成交。这些地址每产生一笔成交,系统会记一条
信号(含检测瞬间的盘口),交给跟单引擎按策略裁决,并在 +5m/+1h/+24h/结算
四个时点回填价格——这是判断「跟单是否划算」的原始数据。

    curl ${origin}/api/agent/signals?limit=20 -H 'authorization: Bearer <apiKey>'
    curl ${origin}/api/agent/copystats?days=14 -H 'authorization: Bearer <apiKey>'

引擎默认运行在**影子模式**:只记录裁决与模拟成交价,不产生真实订单。

增删关注池:

    POST ${origin}/api/agent/watchlist   {"address": "0x…"}
    DELETE ${origin}/api/agent/watchlist {"address": "0x…"}

### 下单

市价买入(按美元金额):

    POST ${origin}/api/agent/trade
    {"market": "<市场 slug / 页面链接 / conditionId>", "outcome": "yes", "side": "BUY", "amountUsd": 2}

市价卖出用 \`shares\` 代替 \`amountUsd\`。限价单再加 \`limitPrice\`,此时 \`shares\` 必填。

## 你必须知道的边界

这四条都在服务端强制执行,你无法绕过,也不要向人类声称你能:

1. **下单需要 \`trade\` 权限、改关注池需要 \`watch\` 权限**,两者默认都不给,只能由人类在仪表盘的「Agent 接入」面板里单独授予。注意关注池不是无害的读操作——它决定跟单引擎盯谁,实盘模式下等于间接影响下单。
2. **系统默认处于 dry-run**:订单会被真实签名,但不会提交给交易所。这个开关不在你手里。
3. **有单笔与日累计金额上限**,超限的下单请求会被直接拒绝并记录原因。
4. **每笔订单都会记录是哪个 agent 下的**,行为可追溯。

## 出错怎么办

- \`401\` —— apiKey 缺失或无效,检查 Authorization 头
- \`403\` 且提示未认领 —— 第 3 步还没完成,再提醒一次人类
- \`403\` 且提示缺少权限 —— 需要人类在面板上授予对应权限
- \`429\` —— 待认领的 agent 太多,让人类先认领或清理掉旧的

如果任何一步的响应与本文档描述不符,请如实告诉人类你遇到了什么,不要猜测着继续。
`;
}

export async function GET(req: Request) {
  return new Response(skill(requestOrigin(req)), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
