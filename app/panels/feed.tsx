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
