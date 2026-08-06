"use client";

import { type FetchStatus } from "@/app/lib/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/* ---------- 抓取管线面板 ---------- */

const STEP_LABELS: Record<string, string> = {
  candidates: "① 候选",
  prefilter: "② 初筛",
  positions: "③ 仓位",
  score: "④ 评分",
  live: "⑤ 动向",
};

export function fmtClock(ms: number): string {
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

export function PipelinePanel() {
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
