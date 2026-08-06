// RTDS 实时 watcher:订阅 Polymarket 全平台成交流,过滤出关注池地址后落库。
//
// 定位:best-effort 的低延迟通道,不是正确性来源。断线期间漏掉的成交由
// 每 5 分钟的 --step=watch 轮询按 MAX(timestamp) 增量补齐,天然自愈。
//
// 协议为 scripts/rtds-probe.ts 实测所得:
//   封套 {connection_id, topic:"activity", type:"trades", timestamp:<毫秒>, payload:{…}}
//   payload.timestamp 为秒;无 usdcSize 字段(用 price × size 现算)
//   payload.proxyWallet 是校验和混合大小写,而库内地址统一小写
import {
  WATCH_ALERT_COOLDOWN_MS,
  WATCH_ALERT_MIN_USD,
  WATCH_RELOAD_MS,
} from "../config";
import { query } from "../db";
import { maybeCopy } from "../copy/engine";
import { fetchBookTop, recordSignal } from "../signals";
import { sendAlert } from "../telegram";

// 可用 RTDS_URL 覆盖,便于测试重连路径
const RTDS_URL = process.env.RTDS_URL || "wss://ws-live-data.polymarket.com";
const PING_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

type TradePayload = {
  asset?: string;
  conditionId?: string;
  eventSlug?: string;
  outcome?: string;
  price?: number;
  proxyWallet?: string;
  side?: string;
  size?: number;
  slug?: string;
  timestamp?: number;
  title?: string;
  transactionHash?: string;
  name?: string;
  pseudonym?: string;
};

/** 关注池地址(小写),每 WATCH_RELOAD_MS 从库重载,池子变动无需重启 */
let watched = new Set<string>();
let eventsSeen = 0;
let matchedSeen = 0;
let lastEventAt: number | null = null;
let connectedAt: number | null = null;
let lastError: string | null = null;
const lastAlertAt = new Map<string, number>();
// 必须在模块作用域:放在 connect() 里会随每次重连归零,退避永远停在 1 秒
let reconnectAttempt = 0;

async function reloadWatchlist(): Promise<void> {
  const { rows } = await query<{ address: string }>(
    "SELECT address FROM watchlist",
  );
  watched = new Set(rows.map((r) => r.address.toLowerCase()));
}

async function writeState(connected: boolean): Promise<void> {
  await query(
    `UPDATE watcher_state SET
       connected = $1, connected_at = $2, last_heartbeat_at = $3,
       last_event_at = $4, events_seen = $5, matched_seen = $6, last_error = $7
     WHERE id = 1`,
    [
      connected,
      connectedAt,
      Date.now(),
      lastEventAt,
      eventsSeen,
      matchedSeen,
      lastError,
    ],
  );
}

/** 写入单条成交;返回 true 表示这是新行(而非去重命中) */
async function recordTrade(
  address: string,
  p: TradePayload,
  usdc: number,
): Promise<boolean> {
  const raw = p.timestamp ?? Math.floor(Date.now() / 1000);
  // 表约定为秒;实测 payload 已是秒,这里对毫秒再防御一次
  const ts = raw > 1e12 ? Math.floor(raw / 1000) : raw;

  const res = await query(
    `INSERT INTO trades
       (address, condition_id, asset, side, price, size, usdc_size,
        outcome, title, event_slug, transaction_hash, "timestamp")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (address, transaction_hash, asset, side) DO NOTHING`,
    [
      address,
      p.conditionId ?? null,
      p.asset ?? null,
      p.side ?? "",
      p.price ?? null,
      p.size ?? null,
      usdc,
      p.outcome ?? null,
      p.title ?? null,
      p.eventSlug ?? null,
      p.transactionHash ?? "",
      ts,
    ],
  );
  return (res.rowCount ?? 0) === 1;
}

async function handleTrade(p: TradePayload): Promise<void> {
  const address = p.proxyWallet?.toLowerCase();
  if (!address || !watched.has(address)) return;

  // RTDS 会推送一类无市场元数据的成交(conditionId/title/outcome 全为空串),
  // 无法关联市场、面板上只是空行。实测占刷量地址成交量的 6 成以上,
  // 而 REST 通道从不产生这类记录——过滤掉既去噪又不会造成两条通道不一致。
  if (!p.conditionId) return;

  matchedSeen++;
  const usdc = (p.price ?? 0) * (p.size ?? 0);
  const inserted = await recordTrade(address, p, usdc);

  const who = p.name || p.pseudonym || address.slice(0, 10);
  console.log(
    `watcher: ${inserted ? "新成交" : "已有"} ${who} ${p.side} ${p.outcome} ` +
      `$${usdc.toFixed(2)} — ${p.title?.slice(0, 50) ?? ""}`,
  );
  if (!inserted) return;

  // 信号链路:先抓检测瞬间的盘口(跟单成本的关键证据),落 signals 后交给引擎。
  // 整条链路不抛错,失败只损失一条信号,不影响 watcher 主流程
  if (p.transactionHash && p.side) {
    try {
      const book = p.asset
        ? await fetchBookTop(p.asset)
        : { bestBid: null, bestAsk: null };
      const signal = await recordSignal(
        address,
        {
          conditionId: p.conditionId,
          asset: p.asset,
          side: p.side,
          outcome: p.outcome,
          price: p.price,
          size: p.size,
          usd: usdc,
          title: p.title,
          eventSlug: p.eventSlug,
          timestamp: p.timestamp ?? Math.floor(Date.now() / 1000),
          transactionHash: p.transactionHash,
        },
        "rtds",
        book,
      );
      if (signal) await maybeCopy(signal, address);
    } catch (err) {
      console.error(`watcher: 信号处理失败 ${String(err)}`);
    }
  }

  // 只在真正插入后推送,避免重复;再按地址冷却,避免连续成交刷屏
  if (usdc < WATCH_ALERT_MIN_USD) return;
  const now = Date.now();
  if (now - (lastAlertAt.get(address) ?? 0) < WATCH_ALERT_COOLDOWN_MS) return;
  lastAlertAt.set(address, now);

  const link = p.eventSlug ? `\nhttps://polymarket.com/event/${p.eventSlug}` : "";
  await sendAlert(
    `🔔 关注地址成交\n${who}(${address.slice(0, 10)}…)\n` +
      `${p.side} ${p.outcome} @ ${p.price} × ${p.size} = $${usdc.toFixed(2)}\n` +
      `${p.title ?? ""}${link}`,
  );
}

function connect(): void {
  const ws = new WebSocket(RTDS_URL);
  let ping: ReturnType<typeof setInterval> | undefined;

  ws.addEventListener("open", () => {
    reconnectAttempt = 0;
    connectedAt = Date.now();
    lastError = null;
    console.log(`watcher: 已连接,关注 ${watched.size} 个地址`);
    ws.send(
      JSON.stringify({
        action: "subscribe",
        subscriptions: [{ topic: "activity", type: "trades" }],
      }),
    );
    // RTDS 要求的应用层心跳
    ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("PING");
    }, PING_MS);
    void writeState(true);
  });

  ws.addEventListener("message", (ev: MessageEvent) => {
    const raw = String(ev.data);
    // 服务端会发空帧/PONG,非 JSON 直接忽略
    if (!raw.startsWith("{")) return;

    let msg: { topic?: string; type?: string; payload?: TradePayload };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.topic !== "activity" || msg.type !== "trades" || !msg.payload) return;

    eventsSeen++;
    lastEventAt = Date.now();
    // 不 await:单条落库不应阻塞消费全平台流
    void handleTrade(msg.payload).catch((err) =>
      console.error(`watcher: 处理成交失败 ${String(err)}`),
    );
  });

  ws.addEventListener("error", () => {
    lastError = "WebSocket error";
  });

  ws.addEventListener("close", (ev: CloseEvent) => {
    if (ping) clearInterval(ping);
    connectedAt = null;
    lastError = `连接关闭 code=${ev.code} ${ev.reason}`.trim();
    void writeState(false);

    reconnectAttempt++;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** (reconnectAttempt - 1),
      RECONNECT_MAX_MS,
    );
    console.error(`watcher: ${lastError},${delay / 1000}s 后重连`);
    setTimeout(connect, delay);
  });
}

export async function runWatcher(): Promise<void> {
  await reloadWatchlist();
  console.log(
    `watcher: 启动,关注池 ${watched.size} 个地址,大额推送阈值 $${WATCH_ALERT_MIN_USD}`,
  );

  setInterval(() => {
    void reloadWatchlist().catch((err) =>
      console.error(`watcher: 重载关注池失败 ${String(err)}`),
    );
  }, WATCH_RELOAD_MS);

  setInterval(() => {
    void writeState(connectedAt !== null).catch((err) =>
      console.error(`watcher: 心跳写入失败 ${String(err)}`),
    );
  }, HEARTBEAT_MS);

  connect();
}
