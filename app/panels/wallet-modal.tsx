"use client";

import { Pnl } from "@/app/components/bits";
import { fmtAgo, fmtPct, fmtTime, fmtUsd, shortAddr } from "@/app/lib/format";
import { type TradeLine } from "@/app/lib/types";
import { FeedLines } from "@/app/panels/feed";
import { WatchStar } from "@/app/panels/watch";
import { useEffect, useMemo, useRef, useState } from "react";

/* ---------- 钱包详情弹窗 ---------- */

type OpenPositionRow = {
  condition_id: string;
  outcome: string | null;
  size: number | null;
  avg_price: number | null;
  cur_price: number | null;
  cash_pnl: number | null;
  title: string | null;
  event_slug: string | null;
};

type WalletAnalysis = {
  status: "running" | "done" | "error";
  content: string | null;
  model: string | null;
  usage: { promptTokens: number; completionTokens: number };
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

type WalletDetail = {
  username: string | null;
  score: {
    total_positions: number;
    winning_positions: number;
    win_rate: number;
    total_realized_pnl: number | null;
    avg_pnl: number | null;
    rank: number | null;
  } | null;
  totalRows: number;
  pageSize: number;
  openPositions: OpenPositionRow[];
  openTotal: number;
  trades: TradeLine[];
  positions: Array<{
    condition_id: string;
    title: string | null;
    outcome: string | null;
    avg_price: number | null;
    total_bought: number | null;
    realized_pnl: number;
    timestamp: number | null;
    slug: string | null;
  }>;
  curve: Array<[number, number]> | null;
};

function EquityCurve({ points }: { points: Array<[number, number]> }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 520;
  const H = 130;
  const PAD = 6;

  const { path, area, zeroY, xs, ys } = useMemo(() => {
    const ts = points.map((p) => p[0]);
    const vs = points.map((p) => p[1]);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const vMin = Math.min(0, ...vs);
    const vMax = Math.max(0, ...vs);
    const x = (t: number) =>
      PAD + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - PAD * 2);
    const y = (v: number) =>
      PAD + ((vMax - v) / Math.max(1e-9, vMax - vMin)) * (H - PAD * 2);
    const xs = ts.map(x);
    const ys = vs.map(y);
    const path = xs.map((px, i) => `${i === 0 ? "M" : "L"}${px},${ys[i]}`).join("");
    const area = `${path}L${xs[xs.length - 1]},${y(0)}L${xs[0]},${y(0)}Z`;
    return { path, area, zeroY: y(0), xs, ys };
  }, [points]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  }

  const h = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={PAD}
          x2={W - PAD}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--t-line)"
          strokeWidth="1"
        />
        <path d={area} fill="var(--t-accent)" opacity="0.1" />
        <path
          d={path}
          fill="none"
          stroke="var(--t-accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover !== null && (
          <>
            <line
              x1={xs[hover]}
              x2={xs[hover]}
              y1={PAD}
              y2={H - PAD}
              stroke="var(--t-mut)"
              strokeWidth="1"
            />
            <circle
              cx={xs[hover]}
              cy={ys[hover]}
              r="4"
              fill="var(--t-accent)"
              stroke="var(--t-panel)"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 rounded border border-line bg-panel2 px-2 py-1 font-mono text-[11px]"
          style={{
            left: `${(xs[hover!] / W) * 100}%`,
            transform: xs[hover!] > W / 2 ? "translateX(-105%)" : "translateX(8px)",
          }}
        >
          <div className="text-mut">{fmtTime(h[0])}</div>
          <div className={h[1] >= 0 ? "text-up-ink" : "text-down-ink"}>
            {fmtUsd(h[1])}
          </div>
        </div>
      )}
    </div>
  );
}

export function WalletModal({
  address,
  onClose,
  watched,
  onToggleWatch,
}: {
  address: string;
  onClose: () => void;
  watched: boolean;
  onToggleWatch: () => void;
}) {
  const [detail, setDetail] = useState<WalletDetail | null>(null);
  const [curve, setCurve] = useState<Array<[number, number]> | null>(null);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [copied, setCopied] = useState(false);
  const [analysis, setAnalysis] = useState<WalletAnalysis | null>(null);
  const [analysisHidden, setAnalysisHidden] = useState(false);

  // 任务状态活在服务端:打开弹窗即恢复该地址的历史报告或进行中的分析,
  // 中途关掉再打开也不丢
  useEffect(() => {
    let cancelled = false;
    setAnalysis(null);
    setAnalysisHidden(false);
    fetch(`/api/wallet/${address}/analyze`)
      .then((r) => r.json())
      .then((d: { analysis: WalletAnalysis | null }) => {
        if (!cancelled) setAnalysis(d.analysis);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address]);

  // 进行中每 3 秒轮询一次,直到状态离开 running
  useEffect(() => {
    if (analysis?.status !== "running") return;
    const t = setInterval(() => {
      fetch(`/api/wallet/${address}/analyze`)
        .then((r) => r.json())
        .then((d: { analysis: WalletAnalysis | null }) => {
          if (d.analysis) setAnalysis(d.analysis);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [address, analysis?.status]);

  async function analyze() {
    if (analysis?.status === "running") return;
    setAnalysisHidden(false);
    try {
      const r = await fetch(`/api/wallet/${address}/analyze`, {
        method: "POST",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setAnalysis(d.analysis);
    } catch (err) {
      setAnalysis({
        status: "error",
        content: null,
        model: null,
        usage: { promptTokens: 0, completionTokens: 0 },
        error: err instanceof Error ? err.message : "分析请求失败,请重试",
        startedAt: Date.now(),
        finishedAt: null,
      });
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    const needCurve = curve === null;
    const params = new URLSearchParams({ offset: String(offset) });
    if (debouncedQ) params.set("q", debouncedQ);
    if (needCurve) params.set("curve", "1");
    fetch(`/api/wallet/${address}?${params}`)
      .then((r) => r.json())
      .then((d: WalletDetail) => {
        if (cancelled) return;
        setDetail(d);
        if (d.curve) setCurve(d.curve);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, offset, debouncedQ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 弹窗存续期间锁住背景滚动:否则滚轮事件会穿透蒙板,把底下的榜单一起滚走,
  // 关掉弹窗后页面已经不知道滚到哪里去了
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function copy() {
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  const s = detail?.score;
  const stats = [
    { label: "排名", value: s?.rank ? `#${s.rank}` : "-" },
    { label: "胜率", value: s ? fmtPct(s.win_rate) : "-" },
    { label: "已实现盈亏", value: s ? fmtUsd(s.total_realized_pnl) : "-" },
    { label: "仓位数", value: s?.total_positions ?? "-" },
    { label: "盈利仓位", value: s?.winning_positions ?? "-" },
    { label: "平均单仓", value: s ? fmtUsd(s.avg_pnl) : "-" },
  ];
  const total = detail?.totalRows ?? 0;
  const pageSize = detail?.pageSize ?? 50;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative flex max-h-[92vh] w-[94vw] max-w-[1600px] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-line px-6 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <WatchStar watched={watched} onToggle={onToggleWatch} size="text-base" />
              <h2 className="font-mono text-base font-semibold">
                {shortAddr(address)}
              </h2>
              {detail?.username && (
                <span className="truncate text-sm text-ink2">
                  {detail.username}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-mut">
              <span className="select-all break-all">{address}</span>
              <button
                onClick={copy}
                className="shrink-0 rounded border border-line px-1.5 py-0.5 hover:border-mut hover:text-ink2"
              >
                {copied ? "✓" : "复制"}
              </button>
              <a
                href={`https://polymarket.com/profile/${address}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded border border-line px-1.5 py-0.5 hover:border-mut hover:text-ink2"
              >
                Polymarket ↗
              </a>
            </div>
          </div>
          <div className="ml-3 flex shrink-0 items-center gap-2">
            <button
              onClick={analyze}
              disabled={analysis?.status === "running"}
              className="rounded border border-accent/60 px-2.5 py-1 text-sm text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analysis?.status === "running"
                ? "分析中…"
                : analysis?.status === "done"
                  ? "重新分析"
                  : "✦ 分析"}
            </button>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="rounded border border-line px-2 py-1 text-sm text-ink2 hover:border-mut hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-6 py-5 lg:overflow-hidden">
          <div className="grid shrink-0 grid-cols-3 gap-2.5 sm:grid-cols-6">
            {stats.map((st) => (
              <div
                key={st.label}
                className="rounded border border-line bg-panel2 px-3 py-2.5 text-center"
              >
                <div className="font-mono text-sm font-semibold tabular-nums">
                  {st.value}
                </div>
                <div className="mt-0.5 text-[10px] text-mut">{st.label}</div>
              </div>
            ))}
          </div>

          {analysis && !analysisHidden && (
            <div className="mt-4 shrink-0 rounded border border-accent/30 bg-panel2 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium tracking-wide text-accent">
                  AI 检视报告
                  {analysis.status === "done" && analysis.finishedAt && (
                    <span
                      className="ml-2 font-mono font-normal text-mut"
                      suppressHydrationWarning
                    >
                      {fmtAgo(analysis.finishedAt)}
                    </span>
                  )}
                </h3>
                {analysis.status !== "running" && (
                  <button
                    onClick={() => setAnalysisHidden(true)}
                    className="text-[11px] text-mut hover:text-ink2"
                  >
                    收起
                  </button>
                )}
              </div>
              {analysis.status === "running" ? (
                <p className="text-xs text-mut">
                  正在调用模型分析该地址的持仓、成交与历史盈亏,约需半分钟…
                  关掉弹窗也不会中断,回来即可查看。
                </p>
              ) : analysis.status === "error" ? (
                <p className="text-xs text-down-ink">
                  {analysis.error ?? "分析失败,请重试"}
                </p>
              ) : (
                <>
                  <div className="max-h-[38vh] overflow-y-auto overscroll-contain whitespace-pre-wrap text-xs leading-relaxed text-ink2">
                    {analysis.content}
                  </div>
                  <div className="mt-2 border-t border-line/60 pt-1.5 font-mono text-[10px] text-mut">
                    {analysis.model} · {analysis.usage.promptTokens} in /{" "}
                    {analysis.usage.completionTokens} out ·
                    仅供参考,不构成投资建议
                  </div>
                </>
              )}
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-8 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
            <section className="min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
              <h3 className="mb-2 text-xs font-medium tracking-wide text-ink2">
                最新动向
              </h3>

              {detail && detail.openTotal > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-medium tracking-wide text-ink2">
                当前持仓
                <span className="ml-2 font-mono font-normal text-mut">
                  {detail.openTotal.toLocaleString()} 个
                  {detail.openTotal > detail.openPositions.length &&
                    `,按市值显示前 ${detail.openPositions.length}`}
                </span>
              </h3>
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] text-mut">
                  <tr>
                    <th className="py-2 font-normal">市场</th>
                    <th className="py-2 font-normal">方向</th>
                    <th className="py-2 text-right font-normal">数量</th>
                    <th className="py-2 text-right font-normal">均价→现价</th>
                    <th className="py-2 text-right font-normal">浮动盈亏</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {detail.openPositions.map((p, i) => (
                    <tr key={i}>
                      <td className="max-w-64 truncate py-2 pr-3">
                        {p.event_slug ? (
                          <a
                            href={`https://polymarket.com/event/${p.event_slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-ink2 hover:text-accent hover:underline"
                          >
                            {p.title ?? "-"}
                          </a>
                        ) : (
                          <span className="text-ink2">{p.title ?? "-"}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-mut">{p.outcome ?? "-"}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums text-mut">
                        {p.size !== null ? p.size.toFixed(0) : "-"}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-mut">
                        {p.avg_price !== null ? p.avg_price.toFixed(2) : "-"}
                        {" → "}
                        {p.cur_price !== null ? p.cur_price.toFixed(2) : "-"}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        <Pnl value={p.cash_pnl} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              )}

              <div className="mt-5">
                <h3 className="mb-2 text-xs font-medium tracking-wide text-ink2">
                  成交流水
                  <span className="ml-2 font-mono font-normal text-mut">
                    最近 {detail?.trades.length ?? 0} 笔
                  </span>
                </h3>
                {!detail ? (
                  <p className="text-xs text-mut">加载中…</p>
                ) : detail.trades.length > 0 ? (
                  <FeedLines trades={detail.trades} roomy />
                ) : (
                  <p className="text-xs text-mut">暂无成交数据</p>
                )}
              </div>
            </section>

            <section className="min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
              <h3 className="mb-2 text-xs font-medium tracking-wide text-ink2">
                已平仓
                <span className="ml-2 font-mono font-normal text-mut">
                  {total.toLocaleString()} 条
                </span>
              </h3>

          <div>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-ink2">
              累计已实现盈亏
            </h3>
            {curve && curve.length > 1 ? (
              <EquityCurve points={curve} />
            ) : (
              <p className="text-xs text-mut">
                {curve === null ? "加载中…" : "数据不足"}
              </p>
            )}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium tracking-wide text-ink2">
                已平仓仓位
                <span className="ml-2 font-mono text-mut">
                  {total.toLocaleString()} 条
                </span>
              </h3>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索市场…"
                className="w-48 rounded border border-line bg-panel2 px-2 py-1 text-xs placeholder-mut focus:border-accent focus:outline-none"
              />
            </div>
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] text-mut">
                <tr>
                  <th className="py-2 font-normal">市场</th>
                  <th className="py-2 font-normal">方向</th>
                  <th className="py-2 text-right font-normal">均价</th>
                  <th className="py-2 text-right font-normal">盈亏</th>
                  <th className="py-2 text-right font-normal">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {(detail?.positions ?? []).map((p, i) => (
                  <tr key={i}>
                    <td className="max-w-72 truncate py-2 pr-3">
                      {p.slug ? (
                        <a
                          href={`https://polymarket.com/event/${p.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ink2 hover:text-accent hover:underline"
                        >
                          {p.title ?? "-"}
                        </a>
                      ) : (
                        <span className="text-ink2">{p.title ?? "-"}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-mut">{p.outcome ?? "-"}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-mut">
                      {p.avg_price !== null ? p.avg_price.toFixed(3) : "-"}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      <Pnl value={p.realized_pnl} />
                    </td>
                    <td className="py-2 text-right font-mono text-mut">
                      {fmtTime(p.timestamp)}
                    </td>
                  </tr>
                ))}
                {detail && detail.positions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-mut">
                      无匹配仓位
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {total > pageSize && (
              <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-mut">
                <button
                  onClick={() => setOffset(Math.max(0, offset - pageSize))}
                  disabled={offset === 0}
                  className="rounded border border-line px-2 py-1 hover:border-mut hover:text-ink2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← 上一页
                </button>
                <span className="tabular-nums">
                  {offset + 1}–{Math.min(offset + pageSize, total)} / {total}
                </span>
                <button
                  onClick={() => setOffset(offset + pageSize)}
                  disabled={offset + pageSize >= total}
                  className="rounded border border-line px-2 py-1 hover:border-mut hover:text-ink2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  下一页 →
                </button>
              </div>
            )}
          </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
