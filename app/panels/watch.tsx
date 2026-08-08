"use client";

import { fmtAgo, shortAddr } from "@/app/lib/format";
import { useState } from "react";

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

type WatchCandidate = {
  address: string;
  username: string | null;
  pseudonym: string | null;
};

/** 自由输入添加:地址 / Polymarket 主页链接 / @handle / 用户名 */
function AddWatchForm({
  onAdd,
  full,
}: {
  onAdd: (address: string, username: string | null) => Promise<void>;
  full: boolean;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<WatchCandidate[] | null>(null);

  async function pick(c: WatchCandidate) {
    setBusy(true);
    try {
      await onAdd(c.address, c.username);
      setInput("");
      setCandidates(null);
      setErr(null);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setErr(null);
    setCandidates(null);
    try {
      const res = await fetch(`/api/watchlist/resolve?q=${encodeURIComponent(q)}`);
      const d = (await res.json()) as {
        candidates?: WatchCandidate[];
        error?: string;
      };
      if (!res.ok || !d.candidates) {
        setErr(d.error ?? "解析失败");
        return;
      }
      if (d.candidates.length === 1) {
        await pick(d.candidates[0]);
      } else {
        setCandidates(d.candidates);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    // 面板整体是「点开详情」的热区,表单不能把点击漏上去
    <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          disabled={full || busy}
          placeholder={full ? "关注池已满" : "地址 / 主页链接 / 用户名"}
          className="min-w-0 flex-1 rounded border border-line bg-panel2 px-2 py-1 text-[11px] placeholder:text-mut/60 focus:border-mut focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={() => void submit()}
          disabled={full || busy || !input.trim()}
          className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-ink2 hover:border-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "…" : "添加"}
        </button>
      </div>
      {err && <p className="mt-1.5 text-[11px] text-bad-ink">{err}</p>}
      {candidates && (
        <ul className="mt-1.5 space-y-1">
          <li className="text-[10px] text-mut">找到多个账号,点选要关注的:</li>
          {candidates.map((c) => (
            <li key={c.address}>
              <button
                onClick={() => void pick(c)}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded border border-line bg-panel2 px-2 py-1 text-left text-[11px] hover:border-mut"
              >
                <span className="truncate">{c.username ?? c.pseudonym ?? "-"}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-mut">
                  {shortAddr(c.address)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WatchPanel({
  watch,
  limit,
  error,
  watcher,
  onRemove,
  onOpen,
  onAdd,
}: {
  watch: WatchRow[];
  limit: number;
  error: string | null;
  watcher: WatcherState | null;
  onRemove: (address: string) => void;
  onOpen: () => void;
  onAdd: (address: string, username: string | null) => Promise<void>;
}) {
  const live = watcher?.live ?? false;
  return (
    <section
      onClick={onOpen}
      title="查看信号流、跟单引擎与影子成绩"
      className="cursor-pointer rounded-lg border border-line bg-panel p-4 transition-colors hover:border-mut"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink2">
          实时关注
          <span className="ml-2 font-mono tabular-nums text-mut">
            {watch.length}/{limit}
          </span>
          <span className="ml-2 font-normal text-mut/70">详情 →</span>
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
              live ? "bg-ok" : "bg-mut/50"
            }`}
          />
          {live ? "实时" : "每 5 分钟"}
        </span>
      </div>

      {watch.length === 0 ? (
        <p className="text-[11px] leading-4 text-mut">
          点榜单行首的 ☆,或在下方输入地址 / Polymarket 用户名,把地址加入
          关注池,持仓与动向将以 5 分钟级刷新。
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
                onClick={(e) => {
                  // 整个板块可点开详情弹窗,行内操作不能触发它
                  e.stopPropagation();
                  onRemove(w.address);
                }}
                className="shrink-0 text-bad-ink hover:underline"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddWatchForm onAdd={onAdd} full={watch.length >= limit} />

      {error && <p className="mt-2 text-[11px] text-bad-ink">{error}</p>}
    </section>
  );
}
