"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pnl, Spark } from "@/app/components/bits";
import { fmtPct, shortAddr } from "@/app/lib/format";
import { type Config, type FeedTrade, type Funnel, type LeaderRow } from "@/app/lib/types";
import { AgentPanel } from "@/app/panels/agent";
import { FeedLines } from "@/app/panels/feed";
import { FunnelPanel } from "@/app/panels/funnel";
import { PipelinePanel } from "@/app/panels/pipeline";
import { PortfolioPanel } from "@/app/panels/portfolio";
import { TradePanel } from "@/app/panels/trade";
import { WalletModal } from "@/app/panels/wallet-modal";
import {
  WatchPanel,
  WatchStar,
  type WatchRow,
  type WatcherState,
} from "@/app/panels/watch";

type SortKey =
  | "rank"
  | "win_rate"
  | "total_positions"
  | "total_realized_pnl"
  | "avg_pnl"
  | "score";

const PAGE_SIZES = [15, 50, 100];

function pageList(cur: number, count: number): number[] {
  const set = new Set([0, count - 1, cur - 1, cur, cur + 1]);
  return [...set].filter((p) => p >= 0 && p < count).sort((a, b) => a - b);
}

/* ---------- 主榜单 ---------- */

const COLUMNS: Array<{ key: SortKey; label: string; align: "left" | "right" }> = [
  { key: "rank", label: "#", align: "left" },
  { key: "win_rate", label: "胜率", align: "right" },
  { key: "total_positions", label: "仓位数", align: "right" },
  { key: "total_realized_pnl", label: "已实现盈亏", align: "right" },
  { key: "avg_pnl", label: "平均单仓", align: "right" },
  { key: "score", label: "SCORE", align: "right" },
];

export default function Dashboard({
  rows,
  funnel,
  feed,
  config,
}: {
  rows: LeaderRow[];
  funnel: Funnel;
  feed: FeedTrade[];
  config: Config;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState("");
  const [minWinRate, setMinWinRate] = useState("");
  const [minPositions, setMinPositions] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selected, setSelected] = useState<string | null>(null);
  const [watch, setWatch] = useState<WatchRow[]>([]);
  const [watchLimit, setWatchLimit] = useState(5);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [watcher, setWatcher] = useState<WatcherState | null>(null);

  const loadWatch = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const data = (await res.json()) as {
        watchlist: WatchRow[];
        limit: number;
        watcher: WatcherState;
      };
      setWatch(data.watchlist);
      setWatchLimit(data.limit);
      setWatcher(data.watcher);
    } catch {
      /* 关注池不可用不影响主看板 */
    }
  }, []);

  // 实时通道下成交秒级到达,10 秒轮询才跟得上;池子为空时没必要频繁打接口
  useEffect(() => {
    loadWatch();
    const t = setInterval(loadWatch, watch.length > 0 ? 10_000 : 30_000);
    return () => clearInterval(t);
  }, [loadWatch, watch.length]);

  const watchedSet = useMemo(
    () => new Set(watch.map((w) => w.address.toLowerCase())),
    [watch],
  );

  const toggleWatch = useCallback(
    async (address: string) => {
      setWatchError(null);
      const isWatched = watchedSet.has(address.toLowerCase());
      try {
        const res = await fetch("/api/watchlist", {
          method: isWatched ? "DELETE" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setWatchError(data.error ?? "操作失败");
        }
      } catch (err) {
        setWatchError(String(err));
      }
      await loadWatch();
    },
    [watchedSet, loadWatch],
  );

  useEffect(() => {
    setPage(0);
  }, [search, minWinRate, minPositions, sortKey, sortAsc, pageSize]);

  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get("w");
    if (w) setSelected(w);
  }, []);

  const openWallet = useCallback((addr: string | null) => {
    setSelected(addr);
    const url = new URL(window.location.href);
    if (addr) url.searchParams.set("w", addr);
    else url.searchParams.delete("w");
    window.history.replaceState(null, "", url);
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const minWr = Number(minWinRate) / 100;
    const minPos = Number(minPositions);
    let out = rows.filter((r) => {
      if (s && !r.address.toLowerCase().includes(s) &&
          !(r.username ?? "").toLowerCase().includes(s))
        return false;
      if (minWinRate && r.win_rate < minWr) return false;
      if (minPositions && r.total_positions < minPos) return false;
      return true;
    });
    const dir = sortAsc ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return av === bv ? a.rank - b.rank : av < bv ? -dir : dir;
    });
    return out;
  }, [rows, search, minWinRate, minPositions, sortKey, sortAsc]);

  const feedByAddr = useMemo(() => {
    const m = new Map<string, FeedTrade[]>();
    for (const t of feed) {
      let arr = m.get(t.address);
      if (!arr) m.set(t.address, (arr = []));
      arr.push(t);
    }
    return m;
  }, [feed]);

  const firstPageSize = config.topN;
  const pageCount = Math.max(
    1,
    1 + Math.ceil(Math.max(0, filtered.length - firstPageSize) / pageSize)
  );
  const curPage = Math.min(page, pageCount - 1);
  const pageStart =
    curPage === 0 ? 0 : firstPageSize + (curPage - 1) * pageSize;
  const pageEnd = Math.min(
    curPage === 0 ? firstPageSize : pageStart + pageSize,
    filtered.length
  );
  const visible = filtered.slice(pageStart, pageEnd);

  const tableRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    tableRef.current?.scrollIntoView({ block: "start" });
  }, [curPage]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === "rank");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
      <div className="space-y-4">
        <FunnelPanel funnel={funnel} config={config} />
        <WatchPanel
          watch={watch}
          limit={watchLimit}
          error={watchError}
          watcher={watcher}
          onRemove={toggleWatch}
        />
        <PortfolioPanel />
        <TradePanel />
        <AgentPanel />
        <PipelinePanel />
      </div>

      <section
        ref={tableRef}
        className="min-w-0 scroll-mt-4 rounded-lg border border-line bg-panel"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="text-xs font-medium tracking-wide text-ink2">
            入围地址
            <span className="ml-2 font-mono tabular-nums text-mut">
              {filtered.length}/{rows.length}
            </span>
          </h2>
          <span className="text-[11px] text-mut">
            {/* 不写死颜色名:配色可切换,文案会跟着说谎 */}
            前 {config.topN} 名为最终入选(排名高亮)
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="地址 / 用户名…"
              className="w-44 rounded border border-line bg-panel2 px-2 py-1 text-xs placeholder-mut focus:border-accent focus:outline-none"
            />
            <label className="flex items-center gap-1 text-[11px] text-mut">
              胜率≥
              <input
                value={minWinRate}
                onChange={(e) => setMinWinRate(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0"
                className="w-12 rounded border border-line bg-panel2 px-1.5 py-1 text-right font-mono text-xs focus:border-accent focus:outline-none"
              />
              %
            </label>
            <label className="flex items-center gap-1 text-[11px] text-mut">
              仓位≥
              <input
                value={minPositions}
                onChange={(e) => setMinPositions(e.target.value.replace(/\D/g, ""))}
                placeholder="0"
                className="w-14 rounded border border-line bg-panel2 px-1.5 py-1 text-right font-mono text-xs focus:border-accent focus:outline-none"
              />
            </label>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-mut">
            暂无排名数据,点击左侧「数据更新」的 RUN 开始抓取
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] text-mut">
              <tr className="border-b border-line">
                <th className="py-2 pl-4 font-normal">
                  <button
                    onClick={() => toggleSort("rank")}
                    className="hover:text-ink2"
                  >
                    #{sortKey === "rank" && (sortAsc ? " ▲" : " ▼")}
                  </button>
                </th>
                <th className="py-2 font-normal">地址 / 用户名</th>
                {COLUMNS.slice(1).map((col) => (
                  <th key={col.key} className="py-2 pr-3 text-right font-normal">
                    <button
                      onClick={() => toggleSort(col.key)}
                      className="hover:text-ink2"
                    >
                      {col.label}
                      {sortKey === col.key && (sortAsc ? " ▲" : " ▼")}
                    </button>
                  </th>
                ))}
                <th className="py-2 pr-4 text-right font-normal">近 24 笔</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const isTop = r.rank <= config.topN;
                const trades = feedByAddr.get(r.address);
                return (
                  <Fragment key={r.address}>
                    <tr
                      onClick={() => openWallet(r.address)}
                      className="cursor-pointer border-t border-line/60 first:border-t-0 hover:bg-panel2"
                    >
                      <td className="py-1.5 pl-4 pr-2">
                        <span
                          className={`font-mono tabular-nums ${
                            // 入选标记用主色:它表达「被选中」而非「上涨」,
                            // 跟着涨跌配色翻转毫无意义
                            isTop ? "font-semibold text-accent" : "text-mut"
                          }`}
                        >
                          {r.rank}
                        </span>
                      </td>
                      <td className="max-w-52 py-1.5 pr-3">
                        <div className="flex items-baseline gap-2">
                          <WatchStar
                            watched={watchedSet.has(r.address.toLowerCase())}
                            onToggle={() => toggleWatch(r.address)}
                            size="text-xs"
                          />
                          <span className="shrink-0 font-mono text-ink">
                            {shortAddr(r.address)}
                          </span>
                          {r.username && (
                            <span className="truncate text-mut">
                              {r.username}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <span className="font-mono tabular-nums">
                          {fmtPct(r.win_rate)}
                        </span>
                        <div className="mt-0.5 ml-auto h-[3px] w-14 rounded-sm bg-panel2">
                          <div
                            // 胜率是量级不是方向,用主色;否则红涨配色下整张表
                            // 会被染成一片红,看着像全是亏损
                            className="h-full rounded-sm bg-accent"
                            style={{ width: `${r.win_rate * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink2">
                        {r.total_positions}
                        <div className="text-[10px] text-mut">
                          胜 {r.winning_positions}
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        <Pnl value={r.total_realized_pnl} />
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        <Pnl value={r.avg_pnl} />
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink2">
                        {r.score.toFixed(3)}
                      </td>
                      <td className="py-1.5 pr-4">
                        <div className="flex justify-end">
                          <Spark values={r.spark} />
                        </div>
                      </td>
                    </tr>
                    {trades && trades.length > 0 && (
                      <tr
                        onClick={() => openWallet(r.address)}
                        className="cursor-pointer hover:bg-panel2"
                      >
                        <td colSpan={8} className="max-w-0 px-4 pb-2.5 pt-0">
                          <FeedLines trades={trades} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 font-mono text-[11px] text-mut">
            <span className="tabular-nums">
              {pageStart + 1}–{pageEnd} / {filtered.length} 条
            </span>
            <label className="flex items-center gap-1">
              每页
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded border border-line bg-panel2 px-1 py-0.5 text-ink2 focus:border-accent focus:outline-none"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setPage(curPage - 1)}
                disabled={curPage === 0}
                className="rounded border border-line px-2 py-1 hover:border-mut hover:text-ink2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ←
              </button>
              {pageList(curPage, pageCount).map((p, i, arr) => (
                <span key={p} className="flex items-center gap-1">
                  {i > 0 && arr[i - 1] !== p - 1 && (
                    <span className="px-0.5">…</span>
                  )}
                  <button
                    onClick={() => setPage(p)}
                    className={`min-w-7 rounded border px-1.5 py-1 tabular-nums ${
                      p === curPage
                        ? "border-accent/60 bg-accent/10 text-accent"
                        : "border-line hover:border-mut hover:text-ink2"
                    }`}
                  >
                    {p + 1}
                  </button>
                </span>
              ))}
              <button
                onClick={() => setPage(curPage + 1)}
                disabled={curPage >= pageCount - 1}
                className="rounded border border-line px-2 py-1 hover:border-mut hover:text-ink2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <WalletModal
          address={selected}
          onClose={() => openWallet(null)}
          watched={watchedSet.has(selected.toLowerCase())}
          onToggleWatch={() => toggleWatch(selected)}
        />
      )}
    </div>
  );
}
