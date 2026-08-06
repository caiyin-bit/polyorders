"use client";

import { fmtUsd } from "@/app/lib/format";
import { type TradeLine } from "@/app/lib/types";
import { fmtClock } from "@/app/panels/pipeline";

/* ---------- 行内最新动向 ---------- */

export function FeedLines({
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
            {/* 标题增长到上限即止:不封顶的话宽屏下会把右侧明细一路推到边缘,
                中间留出大片空白。上限内仍用 flex-1 撑开,好让各行明细列对齐 */}
            {t.event_slug ? (
              <a
                href={`https://polymarket.com/event/${t.event_slug}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={t.title ?? undefined}
                className="min-w-0 max-w-[30rem] flex-1 truncate text-ink2 hover:text-accent hover:underline"
              >
                {t.title ?? "-"}
              </a>
            ) : (
              <span
                title={t.title ?? undefined}
                className="min-w-0 max-w-[30rem] flex-1 truncate text-ink2"
              >
                {t.title ?? "-"}
              </span>
            )}
            {/* 以下四列定宽,保证跨行对齐——金额和价格靠右对齐才好上下比对 */}
            <span
              className={`w-16 shrink-0 text-right tabular-nums ${
                buy ? "text-up-ink" : "text-down-ink"
              }`}
            >
              {fmtUsd(t.usdc_size)}
            </span>
            <span className="w-14 shrink-0 text-right tabular-nums">
              @{t.price !== null ? t.price.toFixed(2) : "-"}
            </span>
            <span
              className="w-36 shrink-0 truncate"
              title={t.outcome ?? undefined}
            >
              {t.outcome ?? ""}
            </span>
            <span className="w-24 shrink-0 tabular-nums" suppressHydrationWarning>
              {fmtClock(t.timestamp * 1000)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
