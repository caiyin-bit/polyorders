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
// 第一页固定展示最终入选的 Top N 行,后续页从第 N + 1 条开始按 pageSize 分页。
// 行数直接取 config.topN,避免与 src/config.ts 的 TOP_N 各存一份而失配。

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

// 会话类型的中文名与说明(说明用于悬停提示)
const SESSION_KINDS: Record<string, { label: string; hint: string }> = {
  full: {
    label: "完整更新",
    hint: "重新扫描排行榜全部地址:候选 → 初筛 → 拉取仓位 → 评分排名 → 更新动向",
  },
  live: {
    label: "动向更新",
    hint: "只更新最终入选地址的当前持仓与最新成交",
  },
  // 单步记录(分组功能上线前的历史数据)
  candidates: { label: "拉取候选", hint: "从排行榜抓取候选地址池" },
  prefilter: { label: "初筛地址", hint: "按交易市场数与盈亏过滤候选地址" },
  positions: { label: "拉取仓位", hint: "抓取通过初筛地址的已平仓仓位" },
  score: { label: "计算评分", hint: "按胜率 × ln(仓位数) 重新排名" },
};

function sessionKind(kind: string): { label: string; hint: string } {
  return (
    SESSION_KINDS[kind] ?? {
      label: kind
        .split("+")
        .map((k) => SESSION_KINDS[k]?.label ?? k)
        .join(" + "),
      hint: "部分步骤",
    }
  );
}

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
          数据更新
          <span
            title={running ? "正在更新" : "空闲"}
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
              <span title={sessionKind(status.nextRun.kind).hint}>
                （{sessionKind(status.nextRun.kind).label}）
              </span>
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
                  <span
                    className="shrink-0 text-ink2"
                    title={sessionKind(s.kind).hint}
                  >
                    {sessionKind(s.kind).label}
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

/* ---------- 我的持仓面板 ---------- */

type PortfolioPosition = {
  conditionId: string;
  outcome?: string;
  size?: number;
  avgPrice?: number;
  curPrice?: number;
  initialValue?: number;
  currentValue?: number;
  cashPnl?: number;
  percentPnl?: number;
  realizedPnl?: number;
  redeemable?: boolean;
  negativeRisk?: boolean;
  endDate?: string;
  slug?: string;
  eventSlug?: string;
  title?: string;
};

type Portfolio = {
  configured: boolean;
  address?: string;
  signer?: string;
  walletType?: string;
  balanceUsd?: number;
  positionsValue?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  equity?: number;
  positions?: PortfolioPosition[];
  trading?: {
    mode: "live" | "dry-run";
    maxUsdPerOrder: number;
    maxUsdPerDay: number;
    spentTodayUsd: number;
    remainingTodayUsd: number;
  };
  error?: string;
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-line bg-panel2 px-2 py-1.5">
      <div className="text-[10px] text-mut">{label}</div>
      <div className="font-mono tabular-nums text-[13px]">{value}</div>
    </div>
  );
}

/** 持仓自动刷新间隔。看的是"我现在值多少钱",秒级精度没有意义 */
const PORTFOLIO_POLL_MS = 30_000;

function fmtPnlPct(x: number | null | undefined) {
  if (x == null) return "-";
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

/**
 * 持仓详情弹窗。数据由面板传入,面板每 30 秒轮询一次,所以弹窗开着也会跟着更新。
 * 订单自己拉,因为面板本身用不到。
 */
function PortfolioModal({
  data,
  onClose,
}: {
  data: Portfolio;
  onClose: () => void;
}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/trade")
      .then((r) => r.json())
      .then((d: { orders: OrderRow[] }) => setOrders(d.orders ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const positions = data.positions ?? [];
  const t = data.trading;
  const cost = positions.reduce((s, p) => s + (p.initialValue ?? 0), 0);

  const stats = [
    { label: "总权益", value: fmtUsd(data.equity ?? 0) },
    { label: "可用现金", value: fmtUsd(data.balanceUsd ?? 0) },
    { label: "持仓市值", value: fmtUsd(data.positionsValue ?? 0) },
    { label: "持仓成本", value: fmtUsd(cost) },
    { label: "未实现盈亏", value: <Pnl value={data.unrealizedPnl ?? 0} /> },
    { label: "已实现盈亏", value: <Pnl value={data.realizedPnl ?? 0} /> },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[92vh] w-[94vw] max-w-[1400px] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-line px-6 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">我的持仓</h2>
              {data.walletType && (
                <span className="rounded bg-panel2 px-1.5 py-0.5 text-[10px] text-mut">
                  {data.walletType}
                </span>
              )}
              {t && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    t.mode === "live" ? "bg-up/15 text-up-ink" : "bg-panel2 text-mut"
                  }`}
                  title={
                    t.mode === "live"
                      ? "TRADING_ENABLED=true,订单会真实提交"
                      : "订单只签名不提交"
                  }
                >
                  {t.mode === "live" ? "实盘" : "演练"}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-mut">
              <span className="select-all break-all">{data.address}</span>
              <button
                onClick={() => {
                  if (!data.address) return;
                  navigator.clipboard?.writeText(data.address).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  });
                }}
                className="shrink-0 rounded border border-line px-1.5 py-0.5 hover:border-mut hover:text-ink2"
              >
                {copied ? "✓" : "复制"}
              </button>
              <a
                href={`https://polymarket.com/profile/${data.address}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded border border-line px-1.5 py-0.5 hover:border-mut hover:text-ink2"
              >
                Polymarket ↗
              </a>
              {data.signer && (
                <span title="签名者 EOA,与资金主体不是同一个地址">
                  签名者 {shortAddr(data.signer)}
                </span>
              )}
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

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
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

          {t && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-line bg-panel2 px-3 py-2 text-[11px] text-mut">
              <span>
                单笔上限{" "}
                <span className="font-mono text-ink2">{fmtUsd(t.maxUsdPerOrder)}</span>
              </span>
              <span>
                日累计{" "}
                <span className="font-mono text-ink2">
                  {fmtUsd(t.spentTodayUsd)} / {fmtUsd(t.maxUsdPerDay)}
                </span>
              </span>
              <span>
                今日可用{" "}
                <span className="font-mono text-ink2">
                  {fmtUsd(t.remainingTodayUsd)}
                </span>
              </span>
              <span className="text-[10px]">按北京时间自然日计</span>
            </div>
          )}

          <h3 className="mb-2 mt-5 text-xs font-medium tracking-wide text-ink2">
            当前持仓
            <span className="ml-2 font-mono font-normal text-mut">
              {positions.length} 个
            </span>
          </h3>
          {positions.length === 0 ? (
            <p className="text-[11px] text-mut">当前没有未平仓仓位。</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] text-mut">
                <tr className="border-b border-line">
                  <th className="py-2 font-normal">市场</th>
                  <th className="py-2 font-normal">方向</th>
                  <th className="py-2 text-right font-normal">份额</th>
                  <th className="py-2 text-right font-normal">均价</th>
                  <th className="py-2 text-right font-normal">现价</th>
                  <th className="py-2 text-right font-normal">成本</th>
                  <th className="py-2 text-right font-normal">现值</th>
                  <th className="py-2 text-right font-normal">盈亏</th>
                  <th className="py-2 text-right font-normal">盈亏%</th>
                  <th className="py-2 font-normal">到期</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr
                    key={`${p.conditionId}-${p.outcome}`}
                    className="border-b border-line/50"
                  >
                    <td className="max-w-[380px] py-2">
                      <div className="flex items-center gap-1.5">
                        {p.slug ? (
                          <a
                            href={`https://polymarket.com/event/${p.eventSlug ?? p.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate hover:underline"
                            title={p.title}
                          >
                            {p.title ?? p.conditionId}
                          </a>
                        ) : (
                          <span className="truncate" title={p.title}>
                            {p.title ?? p.conditionId}
                          </span>
                        )}
                        {p.negativeRisk && (
                          <span
                            className="shrink-0 rounded bg-panel2 px-1 text-[9px] text-mut"
                            title="neg-risk 市场(多候选人盘)"
                          >
                            NR
                          </span>
                        )}
                        {p.redeemable && (
                          <span
                            className="shrink-0 rounded bg-up/15 px-1 text-[9px] text-up-ink"
                            title="市场已结算,可赎回"
                          >
                            可赎回
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2">{p.outcome}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {(p.size ?? 0).toFixed(2)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {(p.avgPrice ?? 0).toFixed(4)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {p.curPrice != null ? p.curPrice.toFixed(4) : "-"}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-mut">
                      {fmtUsd(p.initialValue ?? 0)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {fmtUsd(p.currentValue ?? 0)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      <Pnl value={p.cashPnl ?? null} />
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      <span
                        className={
                          (p.percentPnl ?? 0) >= 0 ? "text-up-ink" : "text-down-ink"
                        }
                      >
                        {fmtPnlPct(p.percentPnl)}
                      </span>
                    </td>
                    <td className="py-2 text-mut">{p.endDate ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mb-2 mt-6 text-xs font-medium tracking-wide text-ink2">
            下单记录
            <span className="ml-2 font-mono font-normal text-mut">
              最近 {orders.length} 笔
            </span>
          </h3>
          {orders.length === 0 ? (
            <p className="text-[11px] text-mut">还没有下过单。</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] text-mut">
                <tr className="border-b border-line">
                  <th className="py-2 font-normal">时间</th>
                  <th className="py-2 font-normal">状态</th>
                  <th className="py-2 font-normal">方向</th>
                  <th className="py-2 font-normal">市场</th>
                  <th className="py-2 text-right font-normal">金额</th>
                  <th className="py-2 text-right font-normal">成交份额</th>
                  <th className="py-2 font-normal">CLOB</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const s = ORDER_STATUS[o.status] ?? {
                    label: o.status,
                    cls: "bg-panel2 text-mut",
                  };
                  return (
                    <tr key={o.id} className="border-b border-line/50">
                      <td className="whitespace-nowrap py-2 font-mono text-[11px] text-mut">
                        {new Date(o.created_at).toLocaleString("zh-CN", {
                          hour12: false,
                        })}
                      </td>
                      <td className="py-2">
                        <span className={`rounded px-1 py-px text-[10px] ${s.cls}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="py-2">
                        <span
                          className={
                            o.side === "BUY" ? "text-up-ink" : "text-down-ink"
                          }
                        >
                          {o.side === "BUY" ? "买" : "卖"}
                        </span>{" "}
                        <span className="text-ink2">{o.outcome?.toUpperCase()}</span>
                      </td>
                      <td className="max-w-[320px] py-2">
                        <div
                          className="truncate"
                          title={o.error ?? o.title ?? o.condition_id}
                        >
                          {o.title ?? o.market_slug ?? o.condition_id}
                        </div>
                        {o.error && (
                          <div
                            className="truncate text-[10px] text-down-ink"
                            title={o.error}
                          >
                            {o.error}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {o.amount_usd != null ? fmtUsd(o.amount_usd) : "-"}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {o.size_matched != null ? o.size_matched.toFixed(2) : "-"}
                      </td>
                      <td className="py-2 text-[11px] text-mut">
                        {o.clob_status ?? "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function PortfolioPanel() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  // silent:自动刷新不闪按钮状态,否则每 30 秒跳一次"刷新中"很吵
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/portfolio");
      setData((await res.json()) as Portfolio);
      setUpdatedAt(Date.now());
    } catch {
      /* 面板不可用不影响主看板 */
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 标签页在后台时不轮询——没人看,白打 Polymarket 的接口;
    // 切回前台立刻补一次,免得盯着一屏过期数字等下一个周期
    const tick = () => {
      if (!document.hidden) load(true);
    };
    const timer = setInterval(tick, PORTFOLIO_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  const positions = data?.positions ?? [];
  const canOpen = data?.configured === true;

  return (
    <>
    <section
      onClick={canOpen ? () => setOpen(true) : undefined}
      className={`rounded-lg border border-line bg-panel p-4 ${
        canOpen ? "cursor-pointer transition-colors hover:border-mut" : ""
      }`}
      title={canOpen ? "点击查看持仓详情" : undefined}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink2">
          我的持仓
          {data?.address && (
            <span
              className="ml-2 font-mono text-[10px] text-mut"
              title={`交易钱包 ${data.address}`}
            >
              {shortAddr(data.address)}
            </span>
          )}
        </h2>
        <span className="flex items-center gap-2 text-[10px] text-mut">
          {updatedAt && (
            <span title={`每 ${PORTFOLIO_POLL_MS / 1000} 秒自动刷新`}>
              {new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation(); // 否则点刷新会连带展开详情弹窗
              load();
            }}
            disabled={loading}
            className="hover:text-ink2 disabled:opacity-50"
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        </span>
      </div>

      {!data ? (
        <p className="text-[11px] text-mut">读取中…</p>
      ) : !data.configured ? (
        <p className="text-[11px] leading-4 text-mut">
          交易钱包不可用:检查 <code>POLYMARKET_PRIVATE_KEY</code> 与{" "}
          <code>POLYMARKET_RELAYER_KEY</code>。
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="总权益" value={fmtUsd(data.equity ?? 0)} />
            <Stat label="可用现金" value={fmtUsd(data.balanceUsd ?? 0)} />
            <Stat label="未实现盈亏" value={<Pnl value={data.unrealizedPnl ?? 0} />} />
            <Stat label="已实现盈亏" value={<Pnl value={data.realizedPnl ?? 0} />} />
          </div>

          {data.error ? (
            <p className="mt-2 text-[11px] text-down-ink">{data.error}</p>
          ) : positions.length === 0 ? (
            <p className="mt-3 text-[11px] leading-4 text-mut">
              当前没有未平仓仓位。下单后会在这里显示实时现值与盈亏。
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
              {positions.map((p) => (
                <li key={`${p.conditionId}-${p.outcome}`} className="text-[11px] leading-4">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-panel2 px-1 py-px text-[10px] text-ink2">
                      {p.outcome}
                    </span>
                    <span className="font-mono tabular-nums text-mut">
                      {(p.size ?? 0).toFixed(2)} 份 @ {(p.avgPrice ?? 0).toFixed(3)}
                      {p.curPrice != null && ` → ${p.curPrice.toFixed(3)}`}
                    </span>
                    <span className="ml-auto font-mono tabular-nums">
                      {fmtUsd(p.currentValue ?? 0)}
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono tabular-nums">
                      <Pnl value={p.cashPnl ?? null} />
                    </span>
                  </div>
                  <div className="truncate text-mut" title={p.title ?? p.conditionId}>
                    {p.title ?? p.conditionId}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
    {open && data?.configured && (
      <PortfolioModal data={data} onClose={() => setOpen(false)} />
    )}
    </>
  );
}

/* ---------- 手动下单面板 ---------- */

type TradeLimits = { enabled: boolean; maxUsd: number; dailyMaxUsd: number };

type OrderRow = {
  id: number;
  condition_id: string;
  market_slug: string | null;
  title: string | null;
  outcome: string | null;
  side: string;
  order_type: string;
  price: number | null;
  size: number | null;
  amount_usd: number | null;
  status: string;
  dry_run: boolean;
  clob_status: string | null;
  size_matched: number | null;
  error: string | null;
  created_at: number;
};

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  dry_run: { label: "演练", cls: "bg-panel2 text-mut" },
  submitted: { label: "已提交", cls: "bg-up/15 text-up-ink" },
  rejected: { label: "被拒", cls: "bg-down/15 text-down-ink" },
  blocked: { label: "风控拦截", cls: "bg-down/15 text-down-ink" },
  failed: { label: "失败", cls: "bg-down/15 text-down-ink" },
};

function TradePanel() {
  const [market, setMarket] = useState("");
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [limits, setLimits] = useState<TradeLimits | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trade");
      const data = (await res.json()) as {
        orders: OrderRow[];
        limits: TradeLimits;
      };
      setOrders(data.orders);
      setLimits(data.limits);
    } catch {
      /* 面板不可用不影响主看板 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          market,
          outcome,
          side,
          amountUsd: side === "BUY" ? Number(amount) : undefined,
          shares: side === "SELL" ? Number(shares) : undefined,
          limitPrice: limitPrice ? Number(limitPrice) : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) setError(data.error ?? "下单失败");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded border border-line bg-panel2 px-2 py-1 text-xs placeholder-mut focus:border-accent focus:outline-none";
  const tabCls = (on: boolean) =>
    `flex-1 rounded px-2 py-1 text-[11px] ${on ? "bg-accent text-white" : "bg-panel2 text-mut"}`;

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink2">手动下单</h2>
        {limits && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              limits.enabled ? "bg-down/15 text-down-ink" : "bg-panel2 text-mut"
            }`}
            title={
              limits.enabled
                ? "TRADING_ENABLED=true,订单会真实提交"
                : "订单只签名不提交,记录在案供核对"
            }
          >
            {limits.enabled ? "实盘" : "DRY-RUN"}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <input
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          placeholder="市场 slug / 链接 / conditionId"
          className={inputCls}
        />
        <div className="flex gap-1">
          <button className={tabCls(outcome === "yes")} onClick={() => setOutcome("yes")}>
            YES
          </button>
          <button className={tabCls(outcome === "no")} onClick={() => setOutcome("no")}>
            NO
          </button>
          <button className={tabCls(side === "BUY")} onClick={() => setSide("BUY")}>
            买入
          </button>
          <button className={tabCls(side === "SELL")} onClick={() => setSide("SELL")}>
            卖出
          </button>
        </div>
        {side === "BUY" ? (
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={`买入金额 $${limits ? `(单笔上限 ${limits.maxUsd})` : ""}`}
            className={inputCls}
          />
        ) : (
          <input
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            inputMode="decimal"
            placeholder="卖出份额"
            className={inputCls}
          />
        )}
        <input
          value={limitPrice}
          onChange={(e) => setLimitPrice(e.target.value)}
          inputMode="decimal"
          placeholder="限价(留空为市价单)"
          className={inputCls}
        />
        <button
          onClick={submit}
          disabled={busy || !market}
          className="w-full rounded bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {busy ? "提交中…" : limits?.enabled ? "确认下单" : "演练下单"}
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-down-ink">{error}</p>}

      {orders.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {orders.slice(0, 6).map((o) => {
            const s = ORDER_STATUS[o.status] ?? {
              label: o.status,
              cls: "bg-panel2 text-mut",
            };
            return (
              <li key={o.id} className="text-[11px] leading-4">
                <div className="flex items-center gap-1.5">
                  <span className={`rounded px-1 py-px text-[10px] ${s.cls}`}>
                    {s.label}
                  </span>
                  <span className={o.side === "BUY" ? "text-up-ink" : "text-down-ink"}>
                    {o.side === "BUY" ? "买" : "卖"}
                  </span>
                  <span className="text-ink2">{o.outcome?.toUpperCase()}</span>
                  <span className="ml-auto font-mono tabular-nums text-mut">
                    {o.size_matched != null && (
                      <span className="mr-1.5 text-ink2" title="已成交份额">
                        成交 {o.size_matched.toFixed(2)}
                      </span>
                    )}
                    {o.amount_usd != null ? fmtUsd(o.amount_usd) : `${o.size ?? ""}`}
                  </span>
                </div>
                <div className="truncate text-mut" title={o.error ?? o.title ?? ""}>
                  {o.error ?? o.title ?? o.market_slug ?? o.condition_id}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ---------- 实时关注池 ---------- */

type WatchRow = {
  address: string;
  added_at: number;
  username: string | null;
  rank: number | null;
  fetched_at: number | null;
  last_trade_ts: number | null;
};

type WatcherState = {
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

function WatchStar({
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

function WatchPanel({
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

/* ---------- Agent 接入面板 ---------- */

type AgentRow = {
  id: number;
  name: string;
  model: string | null;
  description: string | null;
  key_prefix: string;
  scopes: string[];
  last_seen_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

function AgentOnboardModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  // 用当前站点 origin,本地开发与线上各自指向自己
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const prompt = `这是我想让你接入的交易终端。阅读 ${origin}/SKILL.md 并按照说明接入 polyorders。如果过程中遇到安全风险,请与我逐一确认。`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时用户可手动选中复制 */
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative w-[94vw] max-w-lg rounded-lg border border-line bg-panel p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-mut hover:text-ink"
          aria-label="关闭"
        >
          ✕
        </button>

        <h2 className="text-center text-lg font-semibold">把你的 Agent 接入进来</h2>
        <p className="mt-2 text-center text-xs text-mut">
          注册由 Agent 自主完成,你只需转交指令并在最后确认
        </p>

        <div className="mt-5 rounded border border-line bg-panel2 p-3">
          <p className="mb-2 text-[11px] text-mut">把这段发给你的 Agent:</p>
          <div className="flex items-start gap-2">
            <p className="flex-1 rounded border border-line bg-panel p-2 text-xs leading-5">
              {prompt}
            </p>
            <button
              onClick={copy}
              className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs text-white"
            >
              {copied ? "已复制" : "复制"}
            </button>
          </div>

          <ol className="mt-4 space-y-2 border-t border-line pt-3 text-xs">
            <li className="flex gap-2">
              <span className="font-mono text-mut">1.</span>
              把以上指令发给你的 Agent
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-mut">2.</span>
              Agent 返回你的专属认领链接
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-mut">3.</span>
              打开链接,确认认领
            </li>
          </ol>
        </div>

        <p className="mt-4 text-[11px] leading-4 text-mut">
          认领前 Agent 拿不到任何权限;下单需要认领后另行授予,且同样受
          dry-run 开关与限额约束。
        </p>
      </div>
    </div>
  );
}

function AgentPanel() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = (await res.json()) as { agents: AgentRow[] };
      setAgents(data.agents);
    } catch {
      /* 面板不可用不影响主看板 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: number, body: Record<string, unknown>) {
    await fetch("/api/agents", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    await load();
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink2">Agent 接入</h2>
        <button
          onClick={() => setShowModal(true)}
          className="rounded bg-accent px-2 py-1 text-[11px] text-white"
        >
          接入新 Agent
        </button>
      </div>

      {agents.length === 0 ? (
        <p className="text-[11px] leading-4 text-mut">
          还没有已认领的 Agent。点右上角生成接入指令。
        </p>
      ) : (
        <ul className="space-y-2">
          {agents.map((a) => {
            const canTrade = a.scopes.includes("trade");
            const revoked = a.revoked_at !== null;
            return (
              <li
                key={a.id}
                className="rounded border border-line bg-panel2 p-2 text-[11px]"
              >
                <div className="space-y-0.5">
                  <span
                    className={`block whitespace-nowrap font-medium ${
                      revoked ? "text-mut line-through" : ""
                    }`}
                  >
                    {a.name}
                  </span>
                  {a.model && <span className="block text-mut">{a.model}</span>}
                  <span className="block font-mono text-mut">{a.key_prefix}…</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-mut">
                  <span>
                    活跃 {a.last_seen_at ? fmtTime(a.last_seen_at) : "从未"}
                  </span>
                  <label className="ml-auto flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={canTrade}
                      onChange={() =>
                        patch(a.id, {
                          scopes: canTrade ? ["read"] : ["read", "trade"],
                        })
                      }
                    />
                    下单权限
                  </label>
                  <button
                    onClick={() => patch(a.id, { revoked: !revoked })}
                    className="text-down-ink hover:underline"
                  >
                    {revoked ? "恢复" : "撤销"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showModal && <AgentOnboardModal onClose={() => setShowModal(false)} />}
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
                            isTop ? "font-semibold text-up-ink" : "text-mut"
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
