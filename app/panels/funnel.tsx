"use client";

import { type Config, type Funnel } from "@/app/lib/types";

/* ---------- 漏斗侧栏 ---------- */

const FUNNEL_COLORS = [1, 2, 3, 4, 5].map((i) => `var(--funnel-${i})`);

export function FunnelPanel({ funnel, config }: { funnel: Funnel; config: Config }) {
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
