"use client";

import { fmtUsd } from "@/app/lib/format";

/* ---------- 小组件 ---------- */

export function Spark({ values }: { values: number[] }) {
  const max = Math.max(1e-9, ...values.map(Math.abs));
  return (
    // 尺寸保持定值,不用 flex-1 自适应:那样会牵动表格列宽分配
    <div className="flex h-12 items-stretch gap-0.5">
      {values.map((v, i) => {
        const pct = Math.max(10, (Math.abs(v) / max) * 100);
        return (
          <div key={i} className="flex w-[6px] flex-col" title={fmtUsd(v)}>
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

export function Pnl({ value }: { value: number | null }) {
  if (value === null) return <span className="text-mut">-</span>;
  return (
    <span className={value >= 0 ? "text-up-ink" : "text-down-ink"}>
      {fmtUsd(value)}
    </span>
  );
}
