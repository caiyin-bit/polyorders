"use client";

import { useEffect, useState } from "react";

/* ---------- LLM 用量侧栏:接入了哪些模型、各花了多少钱 ---------- */

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
    costUsd: number;
  }>;
};

const PROVIDER_LABEL: Record<string, string> = {
  deepseek: "直连",
  openrouter: "OpenRouter",
  siliconflow: "硅基流动",
};

/** 费用跨度大($0.000002 到几美元),分档展示才都可读 */
function usd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function LlmPanel() {
  const [data, setData] = useState<UsageData | null>(null);

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

  const agg = new Map<string, { calls: number; errors: number; costUsd: number }>();
  for (const r of data.rows) {
    const a = agg.get(r.model) ?? { calls: 0, errors: 0, costUsd: 0 };
    a.calls += r.calls;
    a.errors += r.errors;
    a.costUsd += r.costUsd;
    agg.set(r.model, a);
  }
  // 有花费的排前面(按费用降序),闲置的沉底
  const models = [...data.models].sort(
    (a, b) => (agg.get(b.id)?.costUsd ?? 0) - (agg.get(a.id)?.costUsd ?? 0),
  );
  const budgetPct = Math.min(
    100,
    (data.todayUsd / Math.max(1e-9, data.dailyMaxUsd)) * 100,
  );

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="mb-3 text-xs font-medium tracking-wide text-ink2">
        LLM 用量
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
            // 预算条是「消耗告警」语义:货真价实的越多越危险,越满越红
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
  );
}
