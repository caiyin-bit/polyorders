"use client";

import { shortAddr } from "@/app/lib/format";

/* ---------- 实时关注池 ---------- */

export type WatchRow = {
  address: string;
  added_at: number;
  username: string | null;
  rank: number | null;
  fetched_at: number | null;
  last_trade_ts: number | null;
};

export type WatcherState = {
  live: boolean;
  lastEventAt: number | null;
  matchedSeen: number;
};

/** 秒级粒度的相对时间:实时通道下「刚刚 / 12 秒前」比「0 分钟前」有意义得多 */
function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "刚刚";
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  return `${Math.round(s / 86400)} 天前`;
}

export function WatchStar({
  watched,
  onToggle,
  size = "text-sm",
}: {
  watched: boolean;
  onToggle: () => void;
  size?: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={watched ? "移出关注池" : "加入关注池(5 分钟级更新)"}
      className={`shrink-0 leading-none ${size} ${
        watched ? "text-accent" : "text-mut/50 hover:text-accent"
      }`}
    >
      {watched ? "★" : "☆"}
    </button>
  );
}

export function WatchPanel({
  watch,
  limit,
  error,
  watcher,
  onRemove,
}: {
  watch: WatchRow[];
  limit: number;
  error: string | null;
  watcher: WatcherState | null;
  onRemove: (address: string) => void;
}) {
  const live = watcher?.live ?? false;
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink2">
          实时关注
          <span className="ml-2 font-mono tabular-nums text-mut">
            {watch.length}/{limit}
          </span>
        </h2>
        <span
          className="flex items-center gap-1 text-[10px] text-mut"
          title={
            live
              ? "WebSocket 已连接,成交秒级到达;5 分钟轮询仍在兜底"
              : "实时通道未连接,已降级为每 5 分钟轮询"
          }
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              live ? "bg-up" : "bg-mut/50"
            }`}
          />
          {live ? "实时" : "每 5 分钟"}
        </span>
      </div>

      {watch.length === 0 ? (
        <p className="text-[11px] leading-4 text-mut">
          点榜单行首的 ☆ 把地址加入关注池,持仓与动向将以 5 分钟级刷新。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {watch.map((w) => (
            <li
              key={w.address}
              className="flex items-center gap-2 rounded border border-line bg-panel2 px-2 py-1.5 text-[11px]"
            >
              <span className="font-mono">{shortAddr(w.address)}</span>
              {w.rank !== null && (
                <span className="rounded bg-panel px-1 font-mono text-[10px] text-mut">
                  #{w.rank}
                </span>
              )}
              {w.username && <span className="truncate text-mut">{w.username}</span>}
              <span
                className="ml-auto shrink-0 text-mut"
                title={
                  w.last_trade_ts
                    ? `最新成交 ${new Date(w.last_trade_ts * 1000).toLocaleString("zh-CN")}`
                    : "尚无成交记录"
                }
              >
                {w.last_trade_ts
                  ? `成交 ${fmtAgo(w.last_trade_ts * 1000)}`
                  : w.fetched_at
                    ? `拉取 ${fmtAgo(w.fetched_at)}`
                    : "待首轮"}
              </span>
              <button
                onClick={() => onRemove(w.address)}
                className="shrink-0 text-down-ink hover:underline"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-[11px] text-down-ink">{error}</p>}
    </section>
  );
}
