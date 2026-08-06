"use client";

import { Pnl } from "@/app/components/bits";
import { fmtUsd, shortAddr } from "@/app/lib/format";
import { type LivePrice, useLivePrices } from "@/app/lib/live-prices";
import { ORDER_STATUS, type OrderRow } from "@/app/panels/trade";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ---------- 我的持仓面板 ---------- */

type PortfolioPosition = {
  conditionId: string;
  asset?: string;
  outcome?: string;
  size?: number;
  avgPrice?: number;
  curPrice?: number;
  initialValue?: number;
  currentValue?: number;
  cashPnl?: number;
  percentPnl?: number;
  realizedPnl?: number;
  redeemable?: boolean;
  negativeRisk?: boolean;
  endDate?: string;
  slug?: string;
  eventSlug?: string;
  title?: string;
};

type Portfolio = {
  configured: boolean;
  address?: string;
  signer?: string;
  walletType?: string;
  balanceUsd?: number;
  positionsValue?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  equity?: number;
  positions?: PortfolioPosition[];
  trading?: {
    mode: "live" | "dry-run";
    maxUsdPerOrder: number;
    maxUsdPerDay: number;
    spentTodayUsd: number;
    remainingTodayUsd: number;
  };
  error?: string;
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-line bg-panel2 px-2 py-1.5">
      <div className="text-[10px] text-mut">{label}</div>
      <div className="font-mono tabular-nums text-[13px]">{value}</div>
    </div>
  );
}

/** 持仓自动刷新间隔。看的是"我现在值多少钱",秒级精度没有意义 */
const PORTFOLIO_POLL_MS = 30_000;

function fmtPnlPct(x: number | null | undefined) {
  if (x == null) return "-";
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

/**
 * 用实时盘口中间价覆盖快照价格,并重算现值、盈亏与总权益。
 *
 * 分工:30 秒轮询的快照负责结构与正确性(有哪些仓位、现金、已实现盈亏),
 * WebSocket 只改价格及其派生值。断线时自然退回快照值,不需要额外处理。
 */
function withLivePrices(
  data: Portfolio,
  prices: Record<string, LivePrice>,
): Portfolio {
  if (!data.positions?.length) return data;

  let touched = false;
  const positions = data.positions.map((p) => {
    const live = p.asset ? prices[p.asset] : undefined;
    if (!live) return p;
    touched = true;
    const currentValue = (p.size ?? 0) * live.mid;
    const cost = p.initialValue ?? 0;
    const cashPnl = currentValue - cost;
    return {
      ...p,
      curPrice: live.mid,
      currentValue,
      cashPnl,
      percentPnl: cost > 0 ? (cashPnl / cost) * 100 : p.percentPnl,
    };
  });
  if (!touched) return data;

  const positionsValue = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0);
  return {
    ...data,
    positions,
    positionsValue,
    unrealizedPnl: positions.reduce((s, p) => s + (p.cashPnl ?? 0), 0),
    equity: (data.balanceUsd ?? 0) + positionsValue,
  };
}

/**
 * 持仓详情弹窗。数据由面板传入,面板每 30 秒轮询一次,所以弹窗开着也会跟着更新。
 * 订单自己拉,因为面板本身用不到。
 */
function PortfolioModal({
  data,
  live,
  onClose,
}: {
  data: Portfolio;
  live: boolean;
  onClose: () => void;
}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/trade")
      .then((r) => r.json())
      .then((d: { orders: OrderRow[] }) => setOrders(d.orders ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const positions = data.positions ?? [];
  const t = data.trading;
  const cost = positions.reduce((s, p) => s + (p.initialValue ?? 0), 0);

  const stats = [
    { label: "总权益", value: fmtUsd(data.equity ?? 0) },
    { label: "可用现金", value: fmtUsd(data.balanceUsd ?? 0) },
    { label: "持仓市值", value: fmtUsd(data.positionsValue ?? 0) },
    { label: "持仓成本", value: fmtUsd(cost) },
    { label: "未实现盈亏", value: <Pnl value={data.unrealizedPnl ?? 0} /> },
    { label: "已实现盈亏", value: <Pnl value={data.realizedPnl ?? 0} /> },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[92vh] w-[94vw] max-w-[1400px] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-line px-6 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">我的持仓</h2>
              {data.walletType && (
                <span className="rounded bg-panel2 px-1.5 py-0.5 text-[10px] text-mut">
                  {data.walletType}
                </span>
              )}
              {t && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    t.mode === "live" ? "bg-ok/15 text-ok-ink" : "bg-panel2 text-mut"
                  }`}
                  title={
                    t.mode === "live"
                      ? "TRADING_ENABLED=true,订单会真实提交"
                      : "订单只签名不提交"
                  }
                >
                  {t.mode === "live" ? "实盘" : "演练"}
                </span>
              )}
              <span
                className="flex items-center gap-1 text-[10px] text-mut"
                title={
                  live ? "盘口实时推送" : "实时通道未连接,已降级为 30 秒轮询"
                }
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    live ? "bg-ok" : "bg-mut/50"
                  }`}
                />
                {live ? "实时" : "轮询"}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-mut">
              <span className="select-all break-all">{data.address}</span>
              <button
                onClick={() => {
                  if (!data.address) return;
                  navigator.clipboard?.writeText(data.address).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  });
                }}
                className="shrink-0 rounded border border-line px-1.5 py-0.5 hover:border-mut hover:text-ink2"
              >
                {copied ? "✓" : "复制"}
              </button>
              <a
                href={`https://polymarket.com/profile/${data.address}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded border border-line px-1.5 py-0.5 hover:border-mut hover:text-ink2"
              >
                Polymarket ↗
              </a>
              {data.signer && (
                <span title="签名者 EOA,与资金主体不是同一个地址">
                  签名者 {shortAddr(data.signer)}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="ml-3 rounded border border-line px-2 py-1 text-sm text-ink2 hover:border-mut hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {stats.map((st) => (
              <div
                key={st.label}
                className="rounded border border-line bg-panel2 px-3 py-2.5 text-center"
              >
                <div className="font-mono text-sm font-semibold tabular-nums">
                  {st.value}
                </div>
                <div className="mt-0.5 text-[10px] text-mut">{st.label}</div>
              </div>
            ))}
          </div>

          {t && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-line bg-panel2 px-3 py-2 text-[11px] text-mut">
              <span>
                单笔上限{" "}
                <span className="font-mono text-ink2">{fmtUsd(t.maxUsdPerOrder)}</span>
              </span>
              <span>
                日累计{" "}
                <span className="font-mono text-ink2">
                  {fmtUsd(t.spentTodayUsd)} / {fmtUsd(t.maxUsdPerDay)}
                </span>
              </span>
              <span>
                今日可用{" "}
                <span className="font-mono text-ink2">
                  {fmtUsd(t.remainingTodayUsd)}
                </span>
              </span>
              <span className="text-[10px]">按北京时间自然日计</span>
            </div>
          )}

          <h3 className="mb-2 mt-5 text-xs font-medium tracking-wide text-ink2">
            当前持仓
            <span className="ml-2 font-mono font-normal text-mut">
              {positions.length} 个
            </span>
          </h3>
          {positions.length === 0 ? (
            <p className="text-[11px] text-mut">当前没有未平仓仓位。</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] text-mut">
                <tr className="border-b border-line">
                  <th className="py-2 font-normal">市场</th>
                  <th className="py-2 font-normal">方向</th>
                  <th className="py-2 text-right font-normal">份额</th>
                  <th className="py-2 text-right font-normal">均价</th>
                  <th className="py-2 text-right font-normal">现价</th>
                  <th className="py-2 text-right font-normal">成本</th>
                  <th className="py-2 text-right font-normal">现值</th>
                  <th className="py-2 text-right font-normal">盈亏</th>
                  <th className="py-2 text-right font-normal">盈亏%</th>
                  <th className="py-2 pl-4 font-normal">到期</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr
                    key={`${p.conditionId}-${p.outcome}`}
                    className="border-b border-line/50"
                  >
                    <td className="max-w-[380px] py-2">
                      <div className="flex items-center gap-1.5">
                        {p.slug ? (
                          <a
                            href={`https://polymarket.com/event/${p.eventSlug ?? p.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate hover:underline"
                            title={p.title}
                          >
                            {p.title ?? p.conditionId}
                          </a>
                        ) : (
                          <span className="truncate" title={p.title}>
                            {p.title ?? p.conditionId}
                          </span>
                        )}
                        {p.negativeRisk && (
                          <span
                            className="shrink-0 rounded bg-panel2 px-1 text-[9px] text-mut"
                            title="neg-risk 市场(多候选人盘)"
                          >
                            NR
                          </span>
                        )}
                        {p.redeemable && (
                          <span
                            className="shrink-0 rounded bg-ok/15 px-1 text-[9px] text-ok-ink"
                            title="市场已结算,可赎回"
                          >
                            可赎回
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2">{p.outcome}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {(p.size ?? 0).toFixed(2)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {(p.avgPrice ?? 0).toFixed(4)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {p.curPrice != null ? p.curPrice.toFixed(4) : "-"}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-mut">
                      {fmtUsd(p.initialValue ?? 0)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {fmtUsd(p.currentValue ?? 0)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      <Pnl value={p.cashPnl ?? null} />
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      <span
                        className={
                          (p.percentPnl ?? 0) >= 0 ? "text-up-ink" : "text-down-ink"
                        }
                      >
                        {fmtPnlPct(p.percentPnl)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pl-4 text-mut">
                      {p.endDate ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mb-2 mt-6 text-xs font-medium tracking-wide text-ink2">
            下单记录
            <span className="ml-2 font-mono font-normal text-mut">
              最近 {orders.length} 笔
            </span>
          </h3>
          {orders.length === 0 ? (
            <p className="text-[11px] text-mut">还没有下过单。</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] text-mut">
                <tr className="border-b border-line">
                  <th className="py-2 font-normal">时间</th>
                  <th className="py-2 font-normal">状态</th>
                  <th className="py-2 font-normal">方向</th>
                  <th className="py-2 font-normal">市场</th>
                  <th className="py-2 text-right font-normal">金额</th>
                  <th className="py-2 text-right font-normal">成交份额</th>
                  <th className="py-2 pl-4 font-normal">CLOB</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const s = ORDER_STATUS[o.status] ?? {
                    label: o.status,
                    cls: "bg-panel2 text-mut",
                  };
                  return (
                    <tr key={o.id} className="border-b border-line/50">
                      <td className="whitespace-nowrap py-2 font-mono text-[11px] text-mut">
                        {new Date(o.created_at).toLocaleString("zh-CN", {
                          hour12: false,
                        })}
                      </td>
                      <td className="py-2">
                        <span className={`rounded px-1 py-px text-[10px] ${s.cls}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="py-2">
                        <span
                          className={
                            o.side === "BUY" ? "text-up-ink" : "text-down-ink"
                          }
                        >
                          {o.side === "BUY" ? "买" : "卖"}
                        </span>{" "}
                        <span className="text-ink2">{o.outcome?.toUpperCase()}</span>
                      </td>
                      <td className="max-w-[320px] py-2">
                        <div
                          className="truncate"
                          title={o.error ?? o.title ?? o.condition_id}
                        >
                          {o.title ?? o.market_slug ?? o.condition_id}
                        </div>
                        {o.error && (
                          <div
                            className="truncate text-[10px] text-bad-ink"
                            title={o.error}
                          >
                            {o.error}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {o.amount_usd != null ? fmtUsd(o.amount_usd) : "-"}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {o.size_matched != null ? o.size_matched.toFixed(2) : "-"}
                      </td>
                      <td className="whitespace-nowrap py-2 pl-4 text-[11px] text-mut">
                        {o.clob_status ?? "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export function PortfolioPanel() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  // 价格由 WebSocket 推送,这里的轮询只兜底结构性数据:
  // 新开的仓位、现金余额、已实现盈亏
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      setData((await res.json()) as Portfolio);
      setUpdatedAt(Date.now());
    } catch {
      /* 面板不可用不影响主看板 */
    }
  }, []);

  useEffect(() => {
    load();
    // 标签页在后台时不轮询——没人看,白打 Polymarket 的接口;
    // 切回前台立刻补一次,免得盯着一屏过期数字等下一个周期
    const tick = () => {
      if (!document.hidden) load();
    };
    const timer = setInterval(tick, PORTFOLIO_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  // 订阅持仓 token 的实时盘口;仓位变了会自动重订
  const tokenIds = useMemo(
    () =>
      (data?.positions ?? [])
        .map((p) => p.asset)
        .filter((a): a is string => Boolean(a)),
    [data],
  );
  const { prices, live } = useLivePrices(tokenIds);
  const view = useMemo(
    () => (data ? withLivePrices(data, prices) : null),
    [data, prices],
  );

  const positions = view?.positions ?? [];
  const canOpen = view?.configured === true;

  return (
    <>
    <section
      onClick={canOpen ? () => setOpen(true) : undefined}
      className={`rounded-lg border border-line bg-panel p-4 ${
        canOpen ? "cursor-pointer transition-colors hover:border-mut" : ""
      }`}
      title={canOpen ? "点击查看持仓详情" : undefined}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink2">
          我的持仓
          {view?.address && (
            <span
              className="ml-2 font-mono text-[10px] text-mut"
              title={`交易钱包 ${view.address}`}
            >
              {shortAddr(view.address)}
            </span>
          )}
        </h2>
        <span
          className="flex items-center gap-1 text-[10px] text-mut"
          title={
            live
              ? "盘口实时推送,价格与盈亏逐笔更新"
              : `实时通道未连接,已降级为每 ${PORTFOLIO_POLL_MS / 1000} 秒轮询`
          }
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              live ? "bg-ok" : "bg-mut/50"
            }`}
          />
          {live
            ? "实时"
            : updatedAt
              ? new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })
              : "连接中"}
        </span>
      </div>

      {!view ? (
        <p className="text-[11px] text-mut">读取中…</p>
      ) : !view.configured ? (
        <p className="text-[11px] leading-4 text-mut">
          交易钱包不可用:检查 <code>POLYMARKET_PRIVATE_KEY</code> 与{" "}
          <code>POLYMARKET_RELAYER_KEY</code>。
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="总权益" value={fmtUsd(view.equity ?? 0)} />
            <Stat label="可用现金" value={fmtUsd(view.balanceUsd ?? 0)} />
            <Stat label="未实现盈亏" value={<Pnl value={view.unrealizedPnl ?? 0} />} />
            <Stat label="已实现盈亏" value={<Pnl value={view.realizedPnl ?? 0} />} />
          </div>

          {view.error ? (
            <p className="mt-2 text-[11px] text-bad-ink">{view.error}</p>
          ) : positions.length === 0 ? (
            <p className="mt-3 text-[11px] leading-4 text-mut">
              当前没有未平仓仓位。下单后会在这里显示实时现值与盈亏。
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
              {positions.map((p) => (
                <li key={`${p.conditionId}-${p.outcome}`} className="text-[11px] leading-4">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-panel2 px-1 py-px text-[10px] text-ink2">
                      {p.outcome}
                    </span>
                    <span className="font-mono tabular-nums text-mut">
                      {(p.size ?? 0).toFixed(2)} 份 @ {(p.avgPrice ?? 0).toFixed(3)}
                      {p.curPrice != null && ` → ${p.curPrice.toFixed(3)}`}
                    </span>
                    <span className="ml-auto font-mono tabular-nums">
                      {fmtUsd(p.currentValue ?? 0)}
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono tabular-nums">
                      <Pnl value={p.cashPnl ?? null} />
                    </span>
                  </div>
                  <div className="truncate text-mut" title={p.title ?? p.conditionId}>
                    {p.title ?? p.conditionId}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
    {open && view?.configured && (
      <PortfolioModal data={view} live={live} onClose={() => setOpen(false)} />
    )}
    </>
  );
}
