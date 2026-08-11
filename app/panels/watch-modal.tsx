"use client";

import { fmtAgo, fmtPct, shortAddr } from "@/app/lib/format";
import { useEffect, useState } from "react";

/* ---------- 「实时关注」弹窗:关注池信号流 + 跟单引擎运行情况与影子成绩 ---------- */

type SignalRow = {
  id: number;
  address: string;
  username: string | null;
  title: string | null;
  outcome: string | null;
  side: string;
  price: number | null;
  usd: number | null;
  source: string;
  best_ask: number | null;
  event_slug: string | null;
  trade_ts: number;
  detected_at: number;
  detect_lag_ms: number;
  decision: "copy" | "skip" | null;
  skip_reason: string | null;
  sim_price: number | null;
  marks: Record<string, number | null> | null;
};

type Activity = {
  engine: {
    mode: "live" | "shadow";
    strategy: string;
    orderUsd: number;
    dailyMaxUsd: number;
    rules: {
      minPrice: number;
      maxPrice: number;
      minUsd: number;
      maxAskRatio: number;
      cooldownMs: number;
      maxLagMs: number;
    };
    todayCopies: number;
    todaySkips: number;
  };
  signals: SignalRow[];
  stats: {
    days: number;
    feeRate: number;
    byHorizon: Array<{
      strategy: string;
      segment: "all";
      horizon: string;
      n: number;
      avg_return: number | null;
      median_return: number | null;
      net_avg_return: number | null;
      net_ci_low: number | null;
      net_ci_high: number | null;
      win_rate: number | null;
    }>;
    executableByHorizon: Array<{
      strategy: string;
      segment: "executable";
      horizon: string;
      n: number;
      avg_return: number | null;
      median_return: number | null;
      net_avg_return: number | null;
      net_ci_low: number | null;
      net_ci_high: number | null;
      win_rate: number | null;
    }>;
    skipReasons: Array<{ skip_reason: string | null; n: number }>;
    bySourceWallet: Array<{
      address: string;
      username: string | null;
      copies: number;
      avg_return_24h: number | null;
      executable_copies: number;
      resolved: number;
      avg_return_res: number | null;
      net_avg_return_res: number | null;
      resolved_share: number | null;
    }>;
    signalsBySource: Array<{ source: string; n: number }>;
    readiness: {
      ready: boolean;
      checks: Array<{
        key: "days" | "resolved" | "return" | "concentration" | "rtds";
        pass: boolean;
        value: number | boolean | null;
        target: number | boolean;
      }>;
    };
  };
};

const SKIP_ZH: Record<string, string> = {
  "non-buy": "非买入",
  stale: "超延迟窗",
  "price-band": "价格带外",
  "too-small": "金额不足",
  "excluded-market": "排除市场",
  "no-book": "无盘口",
  "price-ran": "价格已跑",
  cooldown: "冷却中",
  "daily-budget": "日预算满",
  "unsupported-outcome": "结果不支持",
};

const SOURCE_ZH: Record<string, string> = {
  rtds: "实时",
  watch: "轮询",
  live: "抓取",
};

const HORIZON_ZH: Record<string, string> = {
  "5m": "+5 分钟",
  "1h": "+1 小时",
  "24h": "+24 小时",
  res: "结算",
};

const READINESS_ZH: Record<string, string> = {
  days: "观测天数",
  resolved: "可执行结算样本",
  return: "费后结算收益",
  concentration: "最大钱包占比",
  rtds: "RTDS 连续健康",
};

function readinessValue(c: Activity["stats"]["readiness"]["checks"][number]): string {
  if (c.key === "days") return `${Number(c.value).toFixed(1)} / ≥${c.target} 天`;
  if (c.key === "resolved") return `${c.value ?? 0} / ≥${c.target}`;
  if (c.key === "return") {
    return c.value === null ? "无数据 / >0%" : `${fmtPct(Number(c.value))} / >0%`;
  }
  if (c.key === "concentration") {
    return c.value === null
      ? "无数据"
      : `${fmtPct(Number(c.value))} / <${fmtPct(Number(c.target))}`;
  }
  return c.value === false
    ? "通道不健康"
    : `${(Number(c.value) / 3_600_000).toFixed(1)} / ≥24 小时`;
}

/** 收益率上色:影子模拟的涨跌与真金同色 */
function Ret({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-mut">-</span>;
  }
  return (
    <span className={value >= 0 ? "text-up-ink" : "text-down-ink"}>
      {value >= 0 ? "+" : ""}
      {(value * 100).toFixed(1)}%
    </span>
  );
}

/** 一条 copy 信号目前最靠后的观测点收益:结算 > 24h > 1h > 5m */
function bestMark(s: SignalRow): { label: string; ret: number } | null {
  if (s.decision !== "copy" || !s.sim_price || !s.marks) return null;
  for (const h of ["res", "24h", "1h", "5m"]) {
    const p = s.marks[h];
    if (p !== null && p !== undefined) {
      return { label: HORIZON_ZH[h], ret: (p - s.sim_price) / s.sim_price };
    }
  }
  return null;
}

function DecisionCell({ s }: { s: SignalRow }) {
  if (s.decision === "copy") {
    return (
      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">
        跟 {s.sim_price !== null ? `@${s.sim_price.toFixed(2)}` : ""}
      </span>
    );
  }
  if (s.decision === "skip") {
    return (
      <span className="text-mut" title={s.skip_reason ?? undefined}>
        跳过·{SKIP_ZH[s.skip_reason ?? ""] ?? s.skip_reason}
      </span>
    );
  }
  // Top20 抓取信号不进裁决;关注池信号理论上必有裁决行
  return <span className="text-mut/60">-</span>;
}

export function WatchModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 打开即拉,存续期间 10 秒一刷——和实时通道的节奏对齐
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/watchlist/activity");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as Activity;
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      }
    }
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 弹窗存续期间锁住背景滚动(同 wallet-modal)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const e = data?.engine;
  const st = data?.stats;
  const live = e?.mode === "live";
  const tiles = e
    ? [
        {
          label: "引擎模式",
          value: live ? "实盘" : "影子",
          cls: live ? "text-bad-ink" : "text-accent",
          title: live
            ? "TRADING_ENABLED 与 COPY_TRADING_ENABLED 双开,信号会真实下单"
            : "只裁决与模拟,一分钱不动;开实盘需双开关",
        },
        { label: "今日裁决", value: `${e.todayCopies} 跟 / ${e.todaySkips} 跳` },
        { label: "单笔模拟", value: `$${e.orderUsd}` },
        { label: "日预算(实盘)", value: `$${e.dailyMaxUsd}` },
        { label: "策略", value: e.strategy },
        {
          label: `${st?.days ?? 30} 天信号`,
          value: (st?.signalsBySource ?? [])
            .map((r) => `${SOURCE_ZH[r.source] ?? r.source} ${r.n}`)
            .join(" · "),
        },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[92vh] w-[94vw] max-w-[1300px] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-sm font-medium tracking-wide text-ink2">
            实时关注
            <span className="ml-2 text-xs font-normal text-mut">
              信号流 · 跟单引擎 · 影子成绩
            </span>
          </h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded border border-line px-2 py-1 text-sm text-ink2 hover:border-mut hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          {error && <p className="mb-3 text-[11px] text-bad-ink">{error}</p>}
          {!data && !error && <p className="text-xs text-mut">加载中…</p>}

          {data && e && st && (
            <>
              {/* ── 1. 关注池最新信号 ── */}
              <h3 className="mb-2 text-xs font-medium tracking-wide text-ink2">
                最新信号
                <span className="ml-2 font-normal text-mut">
                  关注池成交 → 引擎逐条裁决
                </span>
              </h3>
              {data.signals.length === 0 ? (
                <p className="text-[11px] text-mut">
                  尚无信号:关注池地址一有成交就会出现在这里。
                </p>
              ) : (
                <div className="overflow-x-auto rounded border border-line">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-line bg-panel2 text-left text-[10px] text-mut">
                        <th className="px-2 py-1.5 font-normal">时间</th>
                        <th className="px-2 py-1.5 font-normal">钱包</th>
                        <th className="px-2 py-1.5 font-normal">动作</th>
                        <th className="px-2 py-1.5 font-normal">市场</th>
                        <th className="px-2 py-1.5 text-right font-normal">价格</th>
                        <th className="px-2 py-1.5 text-right font-normal">金额</th>
                        <th className="px-2 py-1.5 font-normal">通道</th>
                        <th className="px-2 py-1.5 font-normal">裁决</th>
                        <th className="px-2 py-1.5 text-right font-normal">模拟收益</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.signals.map((s) => {
                        const mark = bestMark(s);
                        return (
                          <tr key={s.id} className="border-b border-line/50 last:border-0">
                            <td
                              className="whitespace-nowrap px-2 py-1.5 text-mut"
                              title={new Date(s.detected_at).toLocaleString("zh-CN")}
                              suppressHydrationWarning
                            >
                              {fmtAgo(s.detected_at)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5">
                              {s.username || (
                                <span className="font-mono">{shortAddr(s.address)}</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5">
                              <span
                                className={
                                  s.side === "BUY" ? "text-up-ink" : "text-down-ink"
                                }
                              >
                                {s.side === "BUY" ? "买" : "卖"}
                              </span>
                              {s.outcome && (
                                <span className="ml-1 text-ink2">{s.outcome}</span>
                              )}
                            </td>
                            <td className="max-w-[320px] truncate px-2 py-1.5">
                              {s.event_slug ? (
                                <a
                                  href={`https://polymarket.com/event/${s.event_slug}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:text-accent hover:underline"
                                  title={s.title ?? undefined}
                                >
                                  {s.title ?? "-"}
                                </a>
                              ) : (
                                (s.title ?? "-")
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                              {s.price !== null ? s.price.toFixed(2) : "-"}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                              {s.usd !== null ? `$${Math.round(s.usd)}` : "-"}
                            </td>
                            <td
                              className="whitespace-nowrap px-2 py-1.5 text-mut"
                              title={`检测延迟 ${Math.round(s.detect_lag_ms / 1000)} 秒`}
                            >
                              {SOURCE_ZH[s.source] ?? s.source}
                              <span className="ml-1 font-mono text-[10px]">
                                {Math.round(s.detect_lag_ms / 1000)}s
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5">
                              <DecisionCell s={s} />
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">
                              {mark ? (
                                <span title={`${mark.label}观测`}>
                                  <Ret value={mark.ret} />
                                  <span className="ml-1 text-[10px] text-mut">
                                    {mark.label}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-mut/60">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── 2. 跟单引擎运行情况 ── */}
              <h3 className="mb-2 mt-6 text-xs font-medium tracking-wide text-ink2">
                跟单引擎
              </h3>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                {tiles.map((t) => (
                  <div
                    key={t.label}
                    className="rounded border border-line bg-panel2 px-3 py-2.5 text-center"
                    title={t.title}
                  >
                    <div
                      className={`font-mono text-sm font-semibold tabular-nums ${t.cls ?? ""}`}
                    >
                      {t.value || "-"}
                    </div>
                    <div className="mt-0.5 text-[10px] text-mut">{t.label}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-mut">
                策略 {e.strategy}:只跟买入 · ${e.rules.minUsd} 起 · 价格带{" "}
                {e.rules.minPrice}–{e.rules.maxPrice} · 卖一涨幅 ≤
                {Math.round((e.rules.maxAskRatio - 1) * 100)}% · 检测延迟 ≤
                {Math.round(e.rules.maxLagMs / 60_000)} 分钟 · 同市场冷却{" "}
                {Math.round(e.rules.cooldownMs / 3_600_000)} 小时
              </p>

              <div
                className={`mt-4 rounded border px-3 py-3 ${
                  st.readiness.ready
                    ? "border-ok/40 bg-ok/5"
                    : "border-accent/30 bg-accent/5"
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-medium text-ink2">
                  实盘准备度
                  <span
                    className={st.readiness.ready ? "text-ok-ink" : "text-accent"}
                  >
                    {st.readiness.ready ? "已达标" : "继续影子"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  {st.readiness.checks.map((c) => (
                    <span
                      key={c.key}
                      className={`rounded border px-1.5 py-0.5 ${
                        c.pass
                          ? "border-ok/30 bg-ok/10 text-ok-ink"
                          : "border-line bg-panel2 text-mut"
                      }`}
                    >
                      {c.pass ? "✓" : "○"} {READINESS_ZH[c.key]} {readinessValue(c)}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] text-mut">
                  这里只给出开闸证据,不会自动开启实盘;真正下单仍需双环境开关。
                </p>
              </div>

              {/* ── 影子成绩 ── */}
              <h3 className="mb-2 mt-6 text-xs font-medium tracking-wide text-ink2">
                影子成绩
                <span className="ml-2 font-normal text-mut">
                  近 {st.days} 天 · 卖一价模拟买入 · 费后按 {fmtPct(st.feeRate)} 保守费用
                </span>
              </h3>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded border border-line">
                  <div className="border-b border-line bg-panel2 px-3 py-1.5 text-[10px] text-mut">
                    按持有期
                  </div>
                  <table className="w-full text-[11px]">
                    <tbody>
                      {st.byHorizon.length === 0 && st.executableByHorizon.length === 0 && (
                        <tr>
                          <td className="px-3 py-2 text-mut">尚无已观测的模拟跟单</td>
                        </tr>
                      )}
                      {[...st.executableByHorizon, ...st.byHorizon].map((h) => (
                        <tr
                          key={`${h.strategy}-${h.segment}-${h.horizon}`}
                          className="border-b border-line/50 last:border-0"
                        >
                          <td className="px-3 py-1.5">
                            <span
                              className={
                                h.segment === "executable" ? "text-accent" : "text-mut"
                              }
                            >
                              {h.segment === "executable" ? "可实盘" : "全部"}
                            </span>
                            <span className="ml-1.5">
                              {HORIZON_ZH[h.horizon] ?? h.horizon}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-mut">
                            n={h.n}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            毛 <Ret value={h.avg_return} />
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-mut">
                            费后 <Ret value={h.net_avg_return} />
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-mut">
                            <div>
                              中位 <Ret value={h.median_return} /> · 胜率{" "}
                              {h.win_rate !== null ? fmtPct(h.win_rate) : "-"}
                            </div>
                            <div className="text-[9px]">
                              大样本95%区间{" "}
                              {h.net_ci_low !== null && h.net_ci_high !== null
                                ? `${fmtPct(h.net_ci_low)}–${fmtPct(h.net_ci_high)}`
                                : "样本不足"}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded border border-line">
                  <div className="border-b border-line bg-panel2 px-3 py-1.5 text-[10px] text-mut">
                    分来源钱包(可实盘 yes/no · 结算)
                  </div>
                  <table className="w-full text-[11px]">
                    <tbody>
                      {st.bySourceWallet.every((w) => w.executable_copies === 0) && (
                        <tr>
                          <td className="px-3 py-2 text-mut">尚无模拟跟单</td>
                        </tr>
                      )}
                      {st.bySourceWallet
                        .filter((w) => w.executable_copies > 0)
                        .sort(
                          (a, b) => (b.resolved_share ?? 0) - (a.resolved_share ?? 0),
                        )
                        .map((w) => (
                        <tr key={w.address} className="border-b border-line/50 last:border-0">
                          <td className="px-3 py-1.5">
                            {w.username || (
                              <span className="font-mono">{shortAddr(w.address)}</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-mut">
                            {w.executable_copies} 跟 / {w.resolved} 结 ·{" "}
                            {w.resolved_share === null ? "-" : fmtPct(w.resolved_share)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            毛 <Ret value={w.avg_return_res} />
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            费后 <Ret value={w.net_avg_return_res} />
                          </td>
                        </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {st.skipReasons.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="text-mut">跳过分布:</span>
                  {st.skipReasons.map((r) => (
                    <span
                      key={r.skip_reason ?? "-"}
                      className="rounded border border-line bg-panel2 px-1.5 py-0.5 text-mut"
                    >
                      {SKIP_ZH[r.skip_reason ?? ""] ?? r.skip_reason}{" "}
                      <span className="font-mono text-ink2">{r.n}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
