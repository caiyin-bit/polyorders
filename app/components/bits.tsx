"use client";

import { fmtUsd } from "@/app/lib/format";

/* ---------- 小组件 ---------- */

/**
 * 近 N 笔成交的迷你柱状图,零线居中、上涨向上、下跌向下。
 *
 * 柱子用 flex-1 而非定宽:列有多宽就铺多宽,窄屏靠 min-w 保底不至于挤成线。
 */
export function Spark({ values }: { values: number[] }) {
  const max = Math.max(1e-9, ...values.map(Math.abs));
  return (
    <div className="flex h-9 w-full items-stretch gap-0.5">
      {values.map((v, i) => {
        // 极小值也留一截可见的墩子,否则那一笔看起来像没发生过
        const pct = Math.max(8, (Math.abs(v) / max) * 100);
        return (
          <div
            key={i}
            className="flex min-w-[2px] flex-1 flex-col"
            title={fmtUsd(v)}
          >
            <div className="flex flex-1 items-end">
              {v >= 0 && (
                <div
                  className="w-full rounded-t-sm bg-up"
                  style={{ height: `${pct}%` }}
                />
              )}
            </div>
            <div className="flex flex-1 items-start">
              {v < 0 && (
                <div
                  className="w-full rounded-b-sm bg-down"
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

export function Pnl({ value }: { value: number | null }) {
  if (value === null) return <span className="text-mut">-</span>;
  return (
    <span className={value >= 0 ? "text-up-ink" : "text-down-ink"}>
      {fmtUsd(value)}
    </span>
  );
}
