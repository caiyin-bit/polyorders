"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pnl, Spark } from "@/app/components/bits";
import { useToast } from "@/app/components/toast";
import { fmtPct, shortAddr } from "@/app/lib/format";
import { type Config, type FeedTrade, type Funnel, type LeaderRow } from "@/app/lib/types";
import { AgentPanel } from "@/app/panels/agent";
import { FeedLines } from "@/app/panels/feed";
import { FunnelPanel } from "@/app/panels/funnel";
import { LlmPanel } from "@/app/panels/llm";
import { PipelinePanel } from "@/app/panels/pipeline";
import { PortfolioPanel } from "@/app/panels/portfolio";
import { TradePanel } from "@/app/panels/trade";
import { UsersPanel } from "@/app/panels/users";
import { WalletModal } from "@/app/panels/wallet-modal";
import { WatchModal } from "@/app/panels/watch-modal";
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

/**
 * 可排序表头。
 *
 * 未激活的列也常驻一个淡箭头:原先箭头只在激活列显示,其余列与不可点的
 * 「地址 / 用户名」看起来毫无区别,没人知道它能点。cursor-pointer 同理——
 * 浏览器给 button 的默认光标是箭头而非手型,Tailwind 也不会自动加。
 */
function SortButton({
  label,
  col,
  sortKey,
  sortAsc,
  onClick,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortAsc: boolean;
  onClick: (key: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <button
      onClick={() => onClick(col)}
      title={`按${label === "#" ? "排名" : label}排序`}
      className={`cursor-pointer whitespace-nowrap hover:text-ink2 ${
        active ? "font-medium text-ink2" : ""
      }`}
    >
      {label}
      <span className={active ? "" : "opacity-30"}>
        {active ? (sortAsc ? " ▲" : " ▼") : " ▼"}
      </span>
    </button>
  );
}

/* ---------- AI 评级(「列表分析」的产出) ---------- */

type RatingItem = {
  address: string;
  status: string | null;
  rating: string | null;
  reason: string | null;
  /** 交叉分析的成员评级计数(如 [{回避,3},{观望,1}]),单模型分析为 null */
  members: Array<{ rating: string; count: number }> | null;
  finishedAt: number | null;
};

const RATING_STYLE: Record<string, string> = {
  强烈关注: "bg-up/15 text-up-ink",
  值得关注: "bg-accent/10 text-accent",
  观望: "bg-panel2 text-ink2",
  回避: "bg-down/15 text-down-ink",
};

function RatingCell({ item }: { item: RatingItem | undefined }) {
  if (!item || item.status === null)
    return <span className="text-mut">-</span>;
  if (item.status === "running")
    return <span className="text-mut">分析中…</span>;
  if (item.status === "error" || !item.rating)
    return <span className="text-down-ink">失败</span>;
  return (
    <div className="min-w-0">
      <span
        className={`rounded px-1.5 py-px text-[10px] font-semibold ${
          RATING_STYLE[item.rating] ?? "bg-panel2 text-ink2"
        }`}
      >
        {item.rating}
      </span>
      {item.members && item.members.length > 0 && (
        <span
          title="交叉分析中各模型的独立评级计数"
          className="ml-1.5 font-mono text-[10px] text-mut"
        >
          {item.members.map((m) => `${m.count}${m.rating}`).join("+")}
        </span>
      )}
      {item.reason && (
        <div className="mt-0.5 max-w-56 whitespace-normal break-words text-[10px] leading-snug text-mut">
          {item.reason}
        </div>
      )}
    </div>
  );
}

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
  const toast = useToast();
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
  const [watcher, setWatcher] = useState<WatcherState | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [ratings, setRatings] = useState<Map<string, RatingItem>>(new Map());

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

  const addWatch = useCallback(
    async (address: string, username: string | null) => {
      try {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address, username }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          toast.error(data.error ?? "添加失败");
        } else {
          toast.success(`已加入关注池 ${shortAddr(address)}`);
        }
      } catch (err) {
        toast.error(String(err));
      }
      await loadWatch();
    },
    [loadWatch, toast],
  );

  const toggleWatch = useCallback(
    async (address: string) => {
      const isWatched = watchedSet.has(address.toLowerCase());
      try {
        const res = await fetch("/api/watchlist", {
          method: isWatched ? "DELETE" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          toast.error(data.error ?? "操作失败");
        } else {
          // 星标在榜单里,关注池在左栏,不给回执就只能靠自己找那颗星变没变色
          toast.success(
            `${isWatched ? "已移出" : "已加入"}关注池 ${shortAddr(address)}`,
          );
        }
      } catch (err) {
        toast.error(String(err));
      }
      await loadWatch();
    },
    [watchedSet, loadWatch, toast],
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
      // 精选行永远置顶,不参与用户排序
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return av === bv
        ? (a.rank ?? Infinity) - (b.rank ?? Infinity)
        : av < bv
          ? -dir
          : dir;
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

  // 第一页固定 topN 行,只在按排名排序时有意义——那是「最终入选」的一批。
  // 换成按胜率等维度排序后,这个 20 就成了没来由的数字,回归正常分页
  const firstPageSize = sortKey === "rank" ? config.topN : pageSize;
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

  // 「列表分析」针对的是当前页可见地址——用户翻到哪页,分析的就是哪页;
  // 曾经写死 Top N,翻到第二页点按钮就成了「毫无反应」
  const visibleKey = useMemo(
    () => visible.map((r) => r.address.toLowerCase()).join(","),
    [visible],
  );

  const loadRatings = useCallback(async () => {
    if (!visibleKey) return;
    try {
      const res = await fetch(`/api/leaderboard/analyze?addrs=${visibleKey}`);
      const data = (await res.json()) as { items: RatingItem[] };
      setRatings(new Map(data.items.map((i) => [i.address.toLowerCase(), i])));
    } catch {
      /* 评级不可用不影响主看板 */
    }
  }, [visibleKey]);

  // 翻页/筛选变化即重拉当前页的评级
  useEffect(() => {
    loadRatings();
  }, [loadRatings]);

  const analyzingCount = useMemo(
    () => [...ratings.values()].filter((i) => i.status === "running").length,
    [ratings],
  );

  // 批量分析进行中才轮询;全部完结后这个 effect 自然停摆
  useEffect(() => {
    if (analyzingCount === 0) return;
    const t = setInterval(loadRatings, 4000);
    return () => clearInterval(t);
  }, [analyzingCount, loadRatings]);

  async function analyzeAll() {
    try {
      const res = await fetch("/api/leaderboard/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: visibleKey.split(",") }),
      });
      const d = (await res.json()) as {
        queued?: number;
        skipped?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      if (d.queued === 0) toast.info("本页地址都有近期报告,未重新分析");
      else if (d.skipped)
        toast.info(`${d.queued} 个开始分析,${d.skipped} 个有近期报告已跳过`);
      await loadRatings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发起失败");
    }
  }

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
          watcher={watcher}
          onRemove={toggleWatch}
          onOpen={() => setWatchOpen(true)}
          onAdd={addWatch}
        />
        <PortfolioPanel />
        <TradePanel />
        <AgentPanel />
        <LlmPanel />
        <UsersPanel />
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
          <button
            onClick={analyzeAll}
            disabled={analyzingCount > 0}
            title={`对当前页 ${visible.length} 个地址逐一生成 AI 检视报告`}
            className="rounded border border-accent/60 px-2 py-0.5 text-[11px] text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyzingCount > 0 ? `分析中 剩 ${analyzingCount} 个…` : "✦ 列表分析"}
          </button>
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
                <th className="py-2 text-center font-normal">
                  <SortButton
                    label="#"
                    col="rank"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onClick={toggleSort}
                  />
                </th>
                <th className="py-2 text-center font-normal">地址 / 用户名</th>
                {COLUMNS.slice(1).map((col) => (
                  <th key={col.key} className="py-2 pr-3 text-right font-normal">
                    <SortButton
                      label={col.label}
                      col={col.key}
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onClick={toggleSort}
                    />
                  </th>
                ))}
                <th className="py-2 pr-3 font-normal">AI 评级</th>
                {/* 该列的柱状图是居中的,表头跟着居中才对得上 */}
                <th className="py-2 text-center font-normal">近 24 笔</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const isTop = r.rank !== null && r.rank <= config.topN;
                const trades = feedByAddr.get(r.address);
                // 有动向行时,柱状图单元格纵跨两行,在合并区域内居中
                const hasFeed = Boolean(trades && trades.length > 0);
                return (
                  <Fragment key={r.address}>
                    <tr
                      onClick={() => openWallet(r.address)}
                      className="cursor-pointer border-t border-line/60 first:border-t-0 hover:bg-panel2"
                    >
                      <td className="py-1.5 pl-4 pr-2">
                        {r.pinned ? (
                          <span
                            className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent"
                            title="手动加入关注池的账号;评分达标后会在次日全量重算中获得正式名次"
                          >
                            精选
                          </span>
                        ) : (
                          <span
                            className={`font-mono tabular-nums ${
                              // 入选标记用主色:它表达「被选中」而非「上涨」,
                              // 跟着涨跌配色翻转毫无意义
                              isTop ? "font-semibold text-accent" : "text-mut"
                            }`}
                          >
                            {r.rank}
                          </span>
                        )}
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
                        {r.score !== null ? r.score.toFixed(3) : "-"}
                      </td>
                      <td className="py-1.5 pr-3 text-[11px]">
                        <RatingCell
                          item={ratings.get(r.address.toLowerCase())}
                        />
                      </td>
                      <td
                        rowSpan={hasFeed ? 2 : 1}
                        className="px-4 py-1.5 align-middle"
                      >
                        <div className="flex justify-center">
                          <Spark values={r.spark} />
                        </div>
                      </td>
                    </tr>
                    {trades && trades.length > 0 && (
                      <tr
                        onClick={() => openWallet(r.address)}
                        className="cursor-pointer hover:bg-panel2"
                      >
                        {/* 8 而非 9:最后一列已被上一行的 rowSpan 占用 */}
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

      {watchOpen && <WatchModal onClose={() => setWatchOpen(false)} />}
    </div>
  );
}
