"use client";

import { shortAddr } from "@/app/lib/format";
import { fmtClock } from "@/app/panels/pipeline";
import { useEffect, useState } from "react";

/* ---------- LLM 用量侧栏 + 明细蒙板 ---------- */

type UsageData = {
  dailyMaxUsd: number;
  todayUsd: number;
  models: Array<{ id: string; provider: string; roles: string[] }>;
  rows: Array<{
    date: string;
    caller: string;
    model: string;
    calls: number;
    errors: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    avgLatencyMs: number | null;
  }>;
  recent: Array<{
    id: number;
    caller: string;
    refId: string | null;
    model: string;
    provider: string;
    status: string;
    error: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    costUsd: number | null;
    latencyMs: number | null;
    startedAt: number;
  }>;
};

const PROVIDER_LABEL: Record<string, string> = {
  deepseek: "直连",
  openrouter: "OpenRouter",
  siliconflow: "硅基流动",
};

/** 费用跨度大($0.000002 到几美元),分档展示才都可读 */
function usd(v: number | null): string {
  if (v === null) return "-";
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function tok(n: number | null): string {
  if (n === null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function aggregateByModel(data: UsageData) {
  const agg = new Map<
    string,
    { calls: number; errors: number; inTok: number; outTok: number; costUsd: number }
  >();
  for (const r of data.rows) {
    const a =
      agg.get(r.model) ??
      { calls: 0, errors: 0, inTok: 0, outTok: 0, costUsd: 0 };
    a.calls += r.calls;
    a.errors += r.errors;
    a.inTok += r.promptTokens;
    a.outTok += r.completionTokens;
    a.costUsd += r.costUsd;
    agg.set(r.model, a);
  }
  return agg;
}

function LlmDetailModal({
  data,
  onClose,
}: {
  data: UsageData;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 同钱包弹窗:蒙板存续期间锁背景滚动,防止滚动穿透
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const agg = aggregateByModel(data);
  const models = [...data.models].sort(
    (a, b) => (agg.get(b.id)?.costUsd ?? 0) - (agg.get(a.id)?.costUsd ?? 0),
  );
  const total = [...agg.values()].reduce(
    (a, m) => ({ calls: a.calls + m.calls, costUsd: a.costUsd + m.costUsd }),
    { calls: 0, costUsd: 0 },
  );
  const th = "py-1.5 pr-3 font-normal text-[11px] text-mut";
  const td = "py-1.5 pr-3 font-mono tabular-nums";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[92vh] w-[94vw] max-w-[1100px] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">LLM 调用明细</h2>
            <p className="mt-0.5 font-mono text-[11px] text-mut">
              今日 {usd(data.todayUsd)} / 预算 {usd(data.dailyMaxUsd)} · 近 14
              天 {total.calls} 次调用 · 合计 {usd(total.costUsd)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded border border-line px-2 py-1 text-sm text-ink2 hover:border-mut hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-ink2">
            模型汇总
            <span className="ml-2 font-mono font-normal text-mut">近 14 天</span>
          </h3>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>模型</th>
                <th className={th}>通道</th>
                <th className={th}>角色</th>
                <th className={`${th} text-right`}>调用</th>
                <th className={`${th} text-right`}>失败</th>
                <th className={`${th} text-right`}>输入 tok</th>
                <th className={`${th} text-right`}>输出 tok</th>
                <th className={`${th} text-right`}>费用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {models.map((m) => {
                const a = agg.get(m.id);
                return (
                  <tr key={m.id} className={a ? "" : "opacity-50"}>
                    <td className={td}>{m.id}</td>
                    <td className="py-1.5 pr-3 text-mut">
                      {PROVIDER_LABEL[m.provider] ?? m.provider}
                    </td>
                    <td className="py-1.5 pr-3 text-mut">
                      {m.roles.join("·") || "-"}
                    </td>
                    <td className={`${td} text-right`}>{a?.calls ?? 0}</td>
                    <td className={`${td} text-right ${a?.errors ? "text-down-ink" : ""}`}>
                      {a?.errors ?? 0}
                    </td>
                    <td className={`${td} text-right`}>{tok(a?.inTok ?? 0)}</td>
                    <td className={`${td} text-right`}>{tok(a?.outTok ?? 0)}</td>
                    <td className={`${td} text-right`}>{usd(a?.costUsd ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="mb-2 mt-6 text-xs font-medium tracking-wide text-ink2">
            按日明细
            <span className="ml-2 font-mono font-normal text-mut">
              日 × 消费方 × 模型
            </span>
          </h3>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>日期</th>
                <th className={th}>消费方</th>
                <th className={th}>模型</th>
                <th className={`${th} text-right`}>调用</th>
                <th className={`${th} text-right`}>失败</th>
                <th className={`${th} text-right`}>tok(入/出)</th>
                <th className={`${th} text-right`}>均延迟</th>
                <th className={`${th} text-right`}>费用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td className={td}>{r.date}</td>
                  <td className="py-1.5 pr-3 text-mut">{r.caller}</td>
                  <td className={td}>{r.model}</td>
                  <td className={`${td} text-right`}>{r.calls}</td>
                  <td className={`${td} text-right ${r.errors ? "text-down-ink" : ""}`}>
                    {r.errors}
                  </td>
                  <td className={`${td} text-right`}>
                    {tok(r.promptTokens)}/{tok(r.completionTokens)}
                  </td>
                  <td className={`${td} text-right`}>
                    {r.avgLatencyMs === null ? "-" : `${(r.avgLatencyMs / 1000).toFixed(1)}s`}
                  </td>
                  <td className={`${td} text-right`}>{usd(r.costUsd)}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-3 text-mut">
                    近 14 天无调用
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <h3 className="mb-2 mt-6 text-xs font-medium tracking-wide text-ink2">
            最近调用
            <span className="ml-2 font-mono font-normal text-mut">
              账本最新 {data.recent.length} 条
            </span>
          </h3>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>时间</th>
                <th className={th}>消费方</th>
                <th className={th}>模型</th>
                <th className={th}>关联对象</th>
                <th className={`${th} text-right`}>tok(入/出)</th>
                <th className={`${th} text-right`}>延迟</th>
                <th className={`${th} text-right`}>费用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.recent.map((c) => (
                <tr key={c.id} title={c.error ?? undefined}>
                  <td className={td} suppressHydrationWarning>
                    {fmtClock(c.startedAt)}
                  </td>
                  <td className="py-1.5 pr-3 text-mut">{c.caller}</td>
                  <td className={td}>
                    {c.model}
                    {c.status !== "ok" && (
                      <span className="ml-1 text-down-ink">✕</span>
                    )}
                  </td>
                  <td className={`${td} text-mut`}>
                    {c.refId
                      ? /^0x[0-9a-f]{40}$/i.test(c.refId)
                        ? shortAddr(c.refId)
                        : c.refId
                      : "-"}
                  </td>
                  <td className={`${td} text-right`}>
                    {tok(c.promptTokens)}/{tok(c.completionTokens)}
                  </td>
                  <td className={`${td} text-right`}>
                    {c.latencyMs === null ? "-" : `${(c.latencyMs / 1000).toFixed(1)}s`}
                  </td>
                  <td className={`${td} text-right`}>{usd(c.costUsd)}</td>
                </tr>
              ))}
              {data.recent.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-mut">
                    账本为空
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-mut">
            失败调用的行悬停可见错误信息;费用按注册表单价即时核算,仅作预算与审计参考
          </p>
        </div>
      </div>
    </div>
  );
}

export function LlmPanel() {
  const [data, setData] = useState<UsageData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/llm/usage")
        .then((r) => r.json())
        .then((d: UsageData) => {
          if (!cancelled) setData(d);
        })
        .catch(() => {
          /* 用量面板不可用不影响主看板 */
        });
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!data) return null;

  const agg = aggregateByModel(data);
  const models = [...data.models].sort(
    (a, b) => (agg.get(b.id)?.costUsd ?? 0) - (agg.get(a.id)?.costUsd ?? 0),
  );
  const budgetPct = Math.min(
    100,
    (data.todayUsd / Math.max(1e-9, data.dailyMaxUsd)) * 100,
  );

  return (
    <>
      <section
        onClick={() => setOpen(true)}
        title="点击查看调用与费用明细"
        className="cursor-pointer rounded-lg border border-line bg-panel p-4 transition-colors hover:border-mut"
      >
        <h2 className="mb-3 flex items-baseline justify-between text-xs font-medium tracking-wide text-ink2">
          LLM 用量
          <span className="font-normal text-mut">明细 →</span>
        </h2>

        <div title="按北京时间自然日累计,超限后所有调用直接拒绝">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-ink2">今日花费 / 日预算</span>
            <span className="font-mono tabular-nums">
              {usd(data.todayUsd)}
              <span className="text-mut"> / {usd(data.dailyMaxUsd)}</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-sm bg-panel2">
            <div
              // 预算条是「消耗告警」语义:越满越危险,越满越红
              className={`h-full rounded-sm ${budgetPct >= 80 ? "bg-down" : "bg-accent"}`}
              style={{ width: `${Math.max(budgetPct > 0 ? 2 : 0, budgetPct)}%` }}
            />
          </div>
        </div>

        <ul className="mt-3 space-y-1.5">
          {models.map((m) => {
            const a = agg.get(m.id);
            const idle = !a || a.calls === 0;
            return (
              <li
                key={m.id}
                className={`flex items-baseline gap-1.5 text-[11px] ${idle ? "opacity-50" : ""}`}
              >
                <span className="truncate font-mono text-ink2">{m.id}</span>
                <span className="shrink-0 rounded bg-panel2 px-1 text-[10px] text-mut">
                  {PROVIDER_LABEL[m.provider] ?? m.provider}
                </span>
                {m.roles.map((role) => (
                  <span
                    key={role}
                    className="shrink-0 rounded bg-accent/10 px-1 text-[10px] text-accent"
                  >
                    {role}
                  </span>
                ))}
                <span className="ml-auto shrink-0 font-mono tabular-nums text-mut">
                  {idle ? (
                    "未使用"
                  ) : (
                    <>
                      {a.calls} 次
                      {a.errors > 0 && (
                        <span className="text-down-ink">({a.errors} 败)</span>
                      )}{" "}
                      · {usd(a.costUsd)}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[11px] leading-4 text-mut">
          调用与费用为近 14 天累计,来自 llm_calls 账本,每分钟刷新
        </p>
      </section>

      {open && <LlmDetailModal data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
