"use client";

import { useEffect, useState } from "react";

// CLOB 行情通道。注意与 src/watch/rtds.ts 用的是两条不同的流:
// 那条是 RTDS 全平台成交流(看别人在买什么),这条是按 token 订阅的盘口
// (看我自己的仓位值多少)。协议为 /tmp 探针实测:
//   订阅帧 {assets_ids:[…], custom_feature_enabled:true, type:"market"}
//   首帧 book 快照(bids/asks 全档),之后 price_change 增量带 best_bid/best_ask
//   需应用层心跳:每 5 秒发文本 PING,服务端回 PONG
const CLOB_MARKET_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const PING_MS = 5_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type LivePrice = { bid: number; ask: number; mid: number; at: number };

type Frame = {
  asset_id?: string;
  bids?: Array<{ price: string }>;
  asks?: Array<{ price: string }>;
  price_changes?: Array<{
    asset_id?: string;
    best_bid?: string;
    best_ask?: string;
  }>;
};

function toPrice(bid: number, ask: number): LivePrice | null {
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  return { bid, ask, mid: (bid + ask) / 2, at: Date.now() };
}

/** 从一帧里抽出所有 token 的最新买卖一价 */
function extract(frame: Frame): Record<string, LivePrice> {
  const out: Record<string, LivePrice> = {};

  // 增量:price_change 直接带 best_bid/best_ask
  for (const c of frame.price_changes ?? []) {
    if (!c.asset_id) continue;
    const p = toPrice(Number(c.best_bid), Number(c.best_ask));
    if (p) out[c.asset_id] = p;
  }

  // 快照:book 只给全档,自己取买一/卖一。有了它连上就能出价,
  // 不用干等第一条增量——冷门市场可能几分钟才动一次
  if (frame.asset_id && (frame.bids?.length || frame.asks?.length)) {
    const bid = Math.max(...(frame.bids ?? []).map((b) => Number(b.price)));
    const ask = Math.min(...(frame.asks ?? []).map((a) => Number(a.price)));
    const p = toPrice(bid, ask);
    if (p) out[frame.asset_id] = p;
  }

  return out;
}

/**
 * 订阅一组 token 的实时盘口价。
 *
 * 定位与 RTDS watcher 一致:best-effort 的低延迟通道,不是正确性来源。
 * 断线期间的价格由外层每 30 秒的轮询兜底,所以这里断了不用报错,
 * 把 live 置 false 让界面降级显示即可。
 */
export function useLivePrices(tokenIds: string[]): {
  prices: Record<string, LivePrice>;
  live: boolean;
} {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [live, setLive] = useState(false);

  // 数组每次渲染都是新引用,直接进依赖会无限重连;排序后拼成字符串当依赖键
  const key = tokenIds.slice().sort().join(",");

  useEffect(() => {
    if (!key) {
      setLive(false);
      return;
    }
    const ids = key.split(",");
    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      // close 与 error 会先后触发,用它保证一次断线只排一次重连
      let handled = false;
      const socket = new WebSocket(CLOB_MARKET_WS);
      ws = socket;

      socket.addEventListener("open", () => {
        attempt = 0;
        setLive(true);
        socket.send(
          JSON.stringify({
            assets_ids: ids,
            custom_feature_enabled: true,
            type: "market",
          }),
        );
        ping = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send("PING");
        }, PING_MS);
      });

      socket.addEventListener("message", (ev) => {
        const raw = String(ev.data);
        if (raw === "PONG") return;
        let msg: unknown;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        const updates: Record<string, LivePrice> = {};
        for (const frame of (Array.isArray(msg) ? msg : [msg]) as Frame[]) {
          Object.assign(updates, extract(frame));
        }
        // 只保留我们订阅的 token:同一市场的对手方 token 也会推过来
        for (const id of Object.keys(updates)) {
          if (!ids.includes(id)) delete updates[id];
        }
        if (Object.keys(updates).length > 0) {
          setPrices((prev) => ({ ...prev, ...updates }));
        }
      });

      const onDown = () => {
        if (handled) return;
        handled = true;
        setLive(false);
        if (ping) clearInterval(ping);
        if (disposed) return;
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** attempt++,
          RECONNECT_MAX_MS,
        );
        retry = setTimeout(connect, delay);
      };
      socket.addEventListener("close", onDown);
      socket.addEventListener("error", onDown);
    };

    connect();
    return () => {
      disposed = true;
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [key]);

  return { prices, live };
}
