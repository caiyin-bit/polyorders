"use client";

import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fmtPct, fmtTime, fmtUsd, shortAddr } from "./lib/format";

export type LeaderRow = {
  address: string;
  username: string | null;
  total_positions: number;
  winning_positions: number;
  win_rate: number;
  total_realized_pnl: number | null;
  avg_pnl: number | null;
  score: number;
  rank: number;
  spark: number[];
};

export type RunRow = {
  step: string;
  started_at: number;
  finished_at: number | null;
  addresses_ok: number | null;
  addresses_failed: number | null;
  error: string | null;
};

export type TradeLine = {
  side: string;
  price: number | null;
  usdc_size: number | null;
  outcome: string | null;
  title: string | null;
  event_slug: string | null;
  timestamp: number;
};

export type FeedTrade = TradeLine & { address: string };

export type Funnel = {
  candidates: number;
  prefilterPass: number;
  positionsFetched: number;
  closedPositions: number;
  qualified: number;
};

type Config = {
  topN: number;
  leaderboardPages: number;
  timePeriod: string;
  minTraded: number;
  minPositions: number;
  maxPositions: number;
};

type FetchSession = {
  group: string;
  kind: string;
  started_at: number;
  finished_at: number | null;
  ok: boolean;
  steps: RunRow[];
};

type FetchStatus = {
  running: boolean;
  canRun?: boolean;
  current: { step: string; started_at: number } | null;
  polymarket?: { ok: boolean; latencyMs: number | null };
  nextRun?: { at: number; kind: "live" | "full" };
  sessions?: FetchSession[];
  counts: {
    candidates: number;
    prefiltered: number;
    passed: number;
    positionsFetched: number;
    scored: number;
  } | null;
  targets: { candidates: number } | null;
};

type SortKey =
  | "rank"
  | "win_rate"
  | "total_positions"
  | "total_realized_pnl"
  | "avg_pnl"
  | "score";

const PAGE_SIZES = [15, 50, 100];
// 第一页固定展示 Top N 行，后续页从第 FIRST_PAGE_SIZE + 1 条开始按 pageSize 分页
const FIRST_PAGE_SIZE = 11;

function pageList(cur: number, count: number): number[] {
  const set = new Set([0, count - 1, cur - 1, cur, cur + 1]);
  return [...set].filter((p) => p >= 0 && p < count).sort((a, b) => a - b);
}

/* ---------- 小组件 ---------- */

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1e-9, ...values.map(Math.abs));
  return (
    <div className="flex h-7 items-stretch gap-px">
      {values.map((v, i) => {
        const pct = Math.max(10, (Math.abs(v) / max) * 100);
        return (
          <div key={i} className="flex w-[3px] flex-col" title={fmtUsd(v)}>
            <div className="flex flex-1 items-end">
              {v >= 0 && (
                <div
                  className="w-full rounded-t-[1px] bg-up"
                  style={{ height: `${pct}%` }}
                />
              )}
            </div>
            <div className="flex flex-1 items-start">
              {v < 0 && (
                <div
                  className="w-full rounded-b-[1px] bg-down"
                  style={{ height: `${pct}%` }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Pnl({ value }: { value: number | null }) {
  if (value === null) return <span className="text-mut">-</span>;
  return (
    <span className={value >= 0 ? "text-up-ink" : "text-down-ink"}>
      {fmtUsd(value)}
    </span>
  );
}

/* ---------- 漏斗侧栏 ---------- */

const FUNNEL_COLORS = [1, 2, 3, 4, 5].map((i) => `var(--funnel-${i})`);

function FunnelPanel({ funnel, config }: { funnel: Funnel; config: Config }) {
  const stages = [
    {
      label: "候选地址池",
      value: funnel.candidates,
      hint: `月度 PNL 排行榜,${config.leaderboardPages} 页,按 proxyWallet 去重`,
    },
    {
      label: "初筛通过",
      value: funnel.prefilterPass,
      hint: `交易市场数 ≥ ${config.minTraded} 且排行榜盈亏 > 0`,
    },
    {
      label: "已拉取仓位",
      value: funnel.positionsFetched,
      hint: `共 ${funnel.closedPositions.toLocaleString()} 条已平仓仓位`,
    },
    {
      label: "入围评分",
      value: funnel.qualified,
      hint: `仓位数 ${config.minPositions}–${config.maxPositions},剔除做市机器人`,
    },
    {
      label: "最终入选",
      value: Math.min(config.topN, funnel.qualified),
      hint: `score = 胜率 × ln(仓位数),取前 ${config.topN}`,
    },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="mb-3 text-xs font-medium tracking-wide text-ink2">
        筛选漏斗
      </h2>
      <div className="space-y-3">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1].value : s.value;
          const keep = prev > 0 ? Math.round((s.value / prev) * 100) : 100;
          return (
            <div key={s.label} title={s.hint}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink2">{s.label}</span>
                <span className="font-mono tabular-nums">
                  {s.value.toLocaleString()}
                  {i > 0 && <span className="ml-1.5 text-mut">{keep}%</span>}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-sm bg-panel2">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${Math.max(4, Math.sqrt(s.value / max) * 100)}%`,
                    background: FUNNEL_COLORS[i],
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-4 text-mut">
        悬停查看各层筛选规则;条宽按 √n 缩放
      </p>
    </section>
  );
}

/* ---------- 抓取管线面板 ---------- */

const STEP_LABELS: Record<string, string> = {
  candidates: "① 候选",
  prefilter: "② 初筛",
  positions: "③ 仓位",
  score: "④ 评分",
  live: "⑤ 动向",
};

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 北京时间 HH:mm(调度规则本身按北京时间定义,不随浏览器时区显示)
function fmtClockBJ(ms: number): string {
  const d = new Date(ms + 8 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

const SESSION_KIND_LABELS: Record<string, string> = {
  full: "全量",
  live: "动向",
};

function PipelinePanel() {
  const router = useRouter();
  const [status, setStatus] = useState<FetchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const running = status?.running ?? false;
  const canRun = status?.canRun;

  const poll = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/fetch");
      const data = (await res.json()) as FetchStatus;
      setStatus(data);
      return data.running;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    poll();
  }, [poll]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const still = await poll();
      if (!still) router.refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [running, poll, router]);

  // 空闲时慢轮询:感知 scheduler 定时任务(跨容器)的启动
  useEffect(() => {
    if (running) return;
    const timer = setInterval(poll, 30_000);
    return () => clearInterval(timer);
  }, [running, poll]);

  async function start() {
    setError(null);
    try {
      const res = await fetch("/api/fetch", { method: "POST" });
      if (res.ok) {
        await poll();
        return;
      }
      if (res.status === 409) {
        setError("已有抓取进程在运行");
        return;
      }
      // 501:线上环境无常驻进程,抓取由 GitHub Actions 定时执行
      const body = (await res.json().catch(() => null)) as {
        reason?: string;
      } | null;
      setError(body?.reason ?? `启动失败(HTTP ${res.status})`);
    } catch {
      setError("启动失败");
    }
  }

  const c = status?.counts;
  const currentStep = status?.current?.step ?? null;
  const STEP_ORDER = ["candidates", "prefilter", "positions", "score", "live"];
  const currentIdx = currentStep ? STEP_ORDER.indexOf(currentStep) : -1;

  const liveSteps = c
    ? [
        {
          key: "candidates",
          done: c.candidates as number | null,
          total: status?.targets?.candidates ?? null,
        },
        { key: "prefilter", done: c.prefiltered, total: c.candidates || null },
        { key: "positions", done: c.positionsFetched, total: c.passed || null },
        { key: "score", done: c.scored, total: null },
        // live(Top N 持仓/成交)无总量计数,进行中为不确定态
        { key: "live", done: null, total: null },
      ].map((s, i) => {
        const active = i === currentIdx;
        // 当前步骤之后的计数来自上一轮,弱化显示避免误读为本轮已完成
        const upcoming = currentIdx >= 0 && i > currentIdx;
        // score 步骤无确定总量:进行中为不确定态,否则按是否已出结果显示 0/100
        const pct =
          s.total !== null
            ? Math.min(100, Math.round(((s.done ?? 0) / s.total) * 100))
            : active
              ? null
              : (s.done ?? 0) > 0
                ? 100
                : 0;
        return { ...s, active, upcoming, pct };
      })
    : null;

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-medium tracking-wide text-ink2">
          抓取管线
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              running ? "animate-pulse bg-up" : "bg-mut"
            }`}
          />
        </h2>
        <button
          onClick={start}
          disabled={running || canRun === false}
          title={
            canRun === false
              ? "线上环境由 GitHub Actions 定时抓取,如需手动触发请在 GitHub 运行 fetch / live 工作流"
              : undefined
          }
          className="rounded border border-accent/60 px-2.5 py-1 font-mono text-[11px] text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-line disabled:text-mut"
        >
          {running ? "RUNNING" : "RUN"}
        </button>
      </div>
      {error && <p className="mb-2 text-[11px] text-down-ink">{error}</p>}
      {canRun === false && !error && (
        <p className="mb-2 text-[11px] text-mut">
          线上由 GitHub Actions 定时抓取(每日全量 · 每 2 小时动向)
        </p>
      )}
      <div className="mb-3 space-y-1 font-mono text-[11px] text-mut">
        <p className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              !status ? "bg-mut" : status.polymarket?.ok ? "bg-up" : "bg-down"
            }`}
          />
          {!status ? (
            "Polymarket 探测中…"
          ) : status.polymarket?.ok ? (
            <>
              Polymarket 在线
              {status.polymarket.latencyMs !== null && (
                <span className="tabular-nums">
                  {status.polymarket.latencyMs}ms
                </span>
              )}
            </>
          ) : (
            "Polymarket 离线"
          )}
        </p>
        <p>
          下次更新{" "}
          {status?.nextRun ? (
            <>
              <span className="tabular-nums text-ink2">
                {fmtClockBJ(status.nextRun.at)}
              </span>{" "}
              （{status.nextRun.kind === "live" ? "动向" : "全量"}）
            </>
          ) : (
            "…"
          )}
        </p>
      </div>
      {running && liveSteps && (
        <div className="mb-3">
          <div className="grid grid-cols-5 gap-1">
            {liveSteps.map((s) => (
              <div
                key={s.key}
                className={`rounded border px-1.5 py-1.5 ${
                  s.active
                    ? "border-accent/60 bg-accent/10"
                    : "border-line bg-panel2"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-mut">
                    {STEP_LABELS[s.key] ?? s.key}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-mut">
                    {s.pct !== null ? `${s.pct}%` : "…"}
                  </span>
                </div>
                <div className="mt-0.5 text-center font-mono text-[11px] tabular-nums">
                  {s.done !== null ? s.done : "…"}
                  {s.total !== null && (
                    <span className="text-mut">/{s.total}</span>
                  )}
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-sm bg-line/60">
                  <div
                    className={`h-full rounded-sm ${
                      s.pct === null
                        ? "animate-pulse bg-accent"
                        : s.active
                          ? "bg-accent"
                          : s.upcoming
                            ? "bg-mut/40"
                            : "bg-up"
                    }`}
                    style={{ width: `${s.pct ?? 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {status?.current && (
            <p className="mt-1.5 font-mono text-[10px] text-mut">
              {STEP_LABELS[status.current.step] ?? status.current.step} 已运行{" "}
              {fmtElapsed(Date.now() - status.current.started_at)}
            </p>
          )}
        </div>
      )}
      {!status ? (
        <p className="py-2 font-mono text-[11px] text-mut">加载中…</p>
      ) : (status.sessions ?? []).length === 0 ? (
        <p className="py-2 font-mono text-[11px] text-mut">
          暂无记录,点击 RUN 或运行 pnpm fetch
        </p>
      ) : (
        <ul className="divide-y divide-line/60 font-mono text-[11px]">
          {status.sessions!.map((s) => {
            const open = expanded === s.group;
            return (
              <li key={s.group}>
                <button
                  onClick={() => setExpanded(open ? null : s.group)}
                  className="flex w-full items-center gap-2 py-1.5 text-left"
                >
                  <span className="w-3 shrink-0 text-mut">
                    {open ? "▾" : "▸"}
                  </span>
                  {s.finished_at === null ? (
                    <span className="shrink-0 animate-pulse text-accent">…</span>
                  ) : (
                    <span
                      className={`shrink-0 ${s.ok ? "text-up-ink" : "text-down-ink"}`}
                    >
                      {s.ok ? "✓" : "✕"}
                    </span>
                  )}
                  <span className="shrink-0 text-ink2">
                    {SESSION_KIND_LABELS[s.kind] ?? s.kind}
                  </span>
                  <span className="text-mut" suppressHydrationWarning>
                    {fmtClock(s.started_at)}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-mut">
                    {s.finished_at
                      ? fmtElapsed(s.finished_at - s.started_at)
                      : "进行中"}
                  </span>
                </button>
                {open && (
                  <table className="mb-2 w-full text-left">
                    <thead className="text-mut">
                      <tr>
                        <th className="py-1 pl-5 font-normal">步骤</th>
                        <th className="py-1 font-normal">开始</th>
                        <th className="py-1 text-right font-normal">耗时</th>
                        <th className="py-1 text-right font-normal">
                          OK/失败
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {s.steps.map((r, i) => (
                        <tr key={i} title={r.error ?? undefined}>
                          <td className="py-1 pl-5">
                            <span
                              className={r.error ? "text-down-ink" : "text-ink2"}
                            >
                              {STEP_LABELS[r.step] ?? r.step}
                              {r.error && " ✕"}
                            </span>
                          </td>
                          {/* 本地时区渲染,服务端(容器 UTC)与浏览器可能不同,以客户端为准 */}
                          <td className="py-1 text-mut" suppressHydrationWarning>
                            {fmtClock(r.started_at)}
                          </td>
                          <td className="py-1 text-right tabular-nums text-mut">
                            {r.finished_at
                              ? `${((r.finished_at - r.started_at) / 1000).toFixed(0)}s`
                              : "…"}
                          </td>
                          <td className="py-1 text-right tabular-nums text-mut">
                            {r.addresses_ok ?? "-"}/{r.addresses_failed ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ---------- 行内最新动向 ---------- */

function FeedLines({
  trades,
  roomy = false,
}: {
  trades: TradeLine[];
  roomy?: boolean;
}) {
  return (
    <ul
      className={`${roomy ? "space-y-2" : "space-y-1"} border-l-2 border-line pl-3`}
    >
      {trades.map((t, i) => {
        const buy = t.side === "BUY";
        return (
          <li
            key={i}
            className={`flex items-center gap-2 font-mono text-mut ${
              roomy ? "py-0.5 text-xs" : "text-[11px]"
            }`}
          >
            <span
              className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold ${
                buy ? "bg-up/15 text-up-ink" : "bg-down/15 text-down-ink"
              }`}
            >
              {buy ? "买" : "卖"}
            </span>
            {t.event_slug ? (
              <a
                href={`https://polymarket.com/event/${t.event_slug}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 truncate text-ink2 hover:text-accent hover:underline"
              >
                {t.title ?? "-"}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate text-ink2">
                {t.title ?? "-"}
              </span>
            )}
            <span
              className={`shrink-0 tabular-nums ${
                buy ? "text-up-ink" : "text-down-ink"
              }`}
            >
              {fmtUsd(t.usdc_size)}
            </span>
            <span className="shrink-0 tabular-nums">
              @{t.price !== null ? t.price.toFixed(2) : "-"}
            </span>
            <span className="min-w-0 max-w-40 truncate">{t.outcome ?? ""}</span>
            <span className="ml-auto shrink-0" suppressHydrationWarning>
              {fmtClock(t.timestamp * 1000)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

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

function WalletModal({
  address,
  onClose,
}: {
  address: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<WalletDetail | null>(null);
  const [curve, setCurve] = useState<Array<[number, number]> | null>(null);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [copied, setCopied] = useState(false);

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
          <button
            onClick={onClose}
            aria-label="关闭"
            className="ml-3 rounded border border-line px-2 py-1 text-sm text-ink2 hover:border-mut hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5 lg:overflow-hidden">
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

          <div className="mt-5 grid grid-cols-1 gap-8 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
            <section className="min-h-0 lg:overflow-y-auto lg:pr-2">
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

            <section className="min-h-0 lg:overflow-y-auto lg:pr-2">
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

  const pageCount = Math.max(
    1,
    1 + Math.ceil(Math.max(0, filtered.length - FIRST_PAGE_SIZE) / pageSize)
  );
  const curPage = Math.min(page, pageCount - 1);
  const pageStart =
    curPage === 0 ? 0 : FIRST_PAGE_SIZE + (curPage - 1) * pageSize;
  const pageEnd = Math.min(
    curPage === 0 ? FIRST_PAGE_SIZE : pageStart + pageSize,
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
            前 {config.topN} 名为最终入选(绿色标记)
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
            暂无评分数据,先运行抓取管线(RUN 或 pnpm fetch)
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
                            isTop ? "font-semibold text-up-ink" : "text-mut"
                          }`}
                        >
                          {r.rank}
                        </span>
                      </td>
                      <td className="max-w-52 py-1.5 pr-3">
                        <div className="flex items-baseline gap-2">
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
                            className="h-full rounded-sm bg-up"
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
        <WalletModal address={selected} onClose={() => openWallet(null)} />
      )}
    </div>
  );
}
