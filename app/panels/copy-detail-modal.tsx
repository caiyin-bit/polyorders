"use client";

import { fmtAgo, fmtPct, shortAddr } from "@/app/lib/format";
import { useEffect, useState } from "react";

/* ---------- 影子成绩明细蒙板:聚合行点开后的逐笔模拟跟单生命周期 ---------- */

export type CopyDetailFilter = {
  days: number;
  segment: "all" | "executable";
  /** 从「按持有期」进入:限定到已有该观测价的样本,与聚合行 n 一致 */
  horizon?: string;
  /** 从「分来源钱包」进入:限定钱包 */
  address?: string;
  username?: string | null;
};

type CopyRow = {
  signal_id: number;
  decided_at: number;
  sim_price: number;
  sim_usd: number | null;
  order_id: number | null;
  address: string;
  username: string | null;
  title: string | null;
  outcome: string | null;
  side: string;
  event_slug: string | null;
  signal_price: number | null;
  signal_usd: number | null;
  source: string;
  detect_lag_ms: number;
  marks: Record<string, number | null> | null;
};

const HORIZONS = ["5m", "1h", "24h", "res"] as const;

const HORIZON_ZH: Record<string, string> = {
  "5m": "+5 分钟",
  "1h": "+1 小时",
  "24h": "+24 小时",
  res: "结算",
};

const SOURCE_ZH: Record<string, string> = {
  rtds: "实时",
  watch: "轮询",
  live: "抓取",
};

/** 同 watch-modal 的收益上色;明细蒙板独立成文件,不值得为 10 行组件抽共享层 */
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

/** 单个观测点单元格:键不存在=待观测;显式 null=市场下线取不到价;有价=收益 */
function MarkCell({ row, horizon }: { row: CopyRow; horizon: string }) {
  const marks = row.marks ?? {};
  if (!(horizon in marks)) {
    return <span className="text-mut/50">待观测</span>;
  }
  const p = marks[horizon];
  if (p === null) {
    return (
      <span className="text-mut/50" title="市场已下线,该观测点取不到历史价">
        无价
      </span>
    );
  }
  return (
    <span title={`观测价 ${p.toFixed(3)}`}>
      <Ret value={(p - row.sim_price) / row.sim_price} />
    </span>
  );
}

export function CopyDetailModal({
  filter,
  onClose,
}: {
  filter: CopyDetailFilter;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ feeRate: number; copies: CopyRow[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      days: String(filter.days),
      segment: filter.segment,
    });
    if (filter.horizon) params.set("horizon", filter.horizon);
    if (filter.address) params.set("address", filter.address);
    fetch(`/api/watchlist/copies?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as { feeRate: number; copies: CopyRow[] };
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // 背景滚动已被父弹窗锁住;这里不重复锁,ESC 也由父层统一处理(先关明细)

  const scope = filter.address
    ? (filter.username ?? shortAddr(filter.address))
    : `${filter.segment === "executable" ? "可实盘" : "全部"}${
        filter.horizon ? ` · ${HORIZON_ZH[filter.horizon]}` : ""
      }`;

  const copies = data?.copies ?? [];
  const resolved = copies.filter((r) => typeof r.marks?.res === "number");
  const grossAvg =
    resolved.length > 0
      ? resolved.reduce(
          (a, r) => a + ((r.marks!.res as number) - r.sim_price) / r.sim_price,
          0,
        ) / resolved.length
      : null;
  const netAvg =
    data && resolved.length > 0
      ? resolved.reduce(
          (a, r) => a + ((r.marks!.res as number) / r.sim_price / (1 + data.feeRate) - 1),
          0,
        ) / resolved.length
      : null;

  const th = "px-2 py-1.5 font-normal";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[88vh] w-[92vw] max-w-[1200px] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-sm font-medium tracking-wide text-ink2">
              影子成绩明细
              <span className="ml-2 text-xs font-normal text-accent">{scope}</span>
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-mut">
              近 {filter.days} 天 · {copies.length} 笔
              {resolved.length > 0 && (
                <>
                  {" "}
                  · 已结算 {resolved.length} 笔:毛均{" "}
                  {grossAvg !== null ? fmtPct(grossAvg) : "-"} / 费后均{" "}
                  {netAvg !== null ? fmtPct(netAvg) : "-"}
                </>
              )}
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
          {error && <p className="text-[11px] text-bad-ink">{error}</p>}
          {!data && !error && <p className="text-xs text-mut">加载中…</p>}
          {data && copies.length === 0 && (
            <p className="text-[11px] text-mut">该口径下没有模拟跟单。</p>
          )}

          {copies.length > 0 && (
            <div className="overflow-x-auto rounded border border-line">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-line bg-panel2 text-left text-[10px] text-mut">
                    <th className={th}>时间</th>
                    {!filter.address && <th className={th}>钱包</th>}
                    <th className={th}>市场</th>
                    <th className={`${th} text-right`}>信号</th>
                    <th className={`${th} text-right`}>模拟买入</th>
                    {HORIZONS.map((h) => (
                      <th
                        key={h}
                        className={`${th} text-right ${
                          filter.horizon === h ? "text-accent" : ""
                        }`}
                      >
                        {HORIZON_ZH[h]}
                      </th>
                    ))}
                    <th className={`${th} text-right`}>费后(结算)</th>
                  </tr>
                </thead>
                <tbody>
                  {copies.map((r) => {
                    const res = r.marks?.res;
                    return (
                      <tr
                        key={r.signal_id}
                        className="border-b border-line/50 last:border-0"
                      >
                        <td
                          className="whitespace-nowrap px-2 py-1.5 text-mut"
                          title={new Date(r.decided_at).toLocaleString("zh-CN")}
                          suppressHydrationWarning
                        >
                          {fmtAgo(r.decided_at)}
                        </td>
                        {!filter.address && (
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {r.username || (
                              <span className="font-mono">{shortAddr(r.address)}</span>
                            )}
                          </td>
                        )}
                        <td className="max-w-[300px] px-2 py-1.5">
                          <div className="truncate">
                            {r.event_slug ? (
                              <a
                                href={`https://polymarket.com/event/${r.event_slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-accent hover:underline"
                                title={r.title ?? undefined}
                              >
                                {r.title ?? "-"}
                              </a>
                            ) : (
                              (r.title ?? "-")
                            )}
                          </div>
                          <div className="text-[10px] text-mut">
                            买 {r.outcome ?? "-"} · {SOURCE_ZH[r.source] ?? r.source}{" "}
                            {Math.round(r.detect_lag_ms / 1000)}s
                            {r.order_id !== null && (
                              <span className="ml-1 text-accent">
                                实盘单 #{r.order_id}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums text-mut">
                          {r.signal_usd !== null ? `$${Math.round(r.signal_usd)}` : "-"}
                          {r.signal_price !== null && ` @${r.signal_price.toFixed(2)}`}
                        </td>
                        <td
                          className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums"
                          title="模拟成交价 = 裁决瞬间卖一价"
                        >
                          {r.sim_usd !== null ? `$${r.sim_usd}` : "-"} @
                          {r.sim_price.toFixed(2)}
                        </td>
                        {HORIZONS.map((h) => (
                          <td
                            key={h}
                            className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums"
                          >
                            <MarkCell row={r} horizon={h} />
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">
                          {typeof res === "number" && data ? (
                            <Ret value={res / r.sim_price / (1 + data.feeRate) - 1} />
                          ) : (
                            <span className="text-mut/50">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[10px] text-mut">
            观测点为空:「待观测」= 时间未到或打点在途;「无价」= 市场已下线,
            该时点历史价永久缺失,只计入结算口径。
          </p>
        </div>
      </div>
    </div>
  );
}
