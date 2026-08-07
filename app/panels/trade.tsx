"use client";

import { fmtUsd } from "@/app/lib/format";
import { useCallback, useEffect, useState } from "react";

/* ---------- 手动下单面板 ---------- */

type TradeLimits = { enabled: boolean; maxUsd: number; dailyMaxUsd: number };

export type OpenOrderRow = {
  clobOrderId: string;
  orderId: number | null;
  title: string | null;
  outcome: string | null;
  side: string;
  price: number;
  size: number;
  sizeMatched: number;
  sizeRemaining: number;
  orderType: string;
  expiresAt: string | null;
};

export type OrderRow = {
  id: number;
  condition_id: string;
  market_slug: string | null;
  title: string | null;
  outcome: string | null;
  side: string;
  order_type: string;
  price: number | null;
  size: number | null;
  amount_usd: number | null;
  status: string;
  dry_run: boolean;
  clob_status: string | null;
  size_matched: number | null;
  error: string | null;
  created_at: number;
};

export const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  dry_run: { label: "演练", cls: "bg-panel2 text-mut" },
  submitted: { label: "已提交", cls: "bg-ok/15 text-ok-ink" },
  rejected: { label: "被拒", cls: "bg-bad/15 text-bad-ink" },
  blocked: { label: "风控拦截", cls: "bg-bad/15 text-bad-ink" },
  failed: { label: "失败", cls: "bg-bad/15 text-bad-ink" },
};

/**
 * 手动下单暂停开关。面板与历史记录保留可见,但输入与提交一律禁用。
 * 只影响本页表单——agent 端点 /api/agent/trade 与 CLI 不受影响。
 * 恢复时改回 false 即可。
 */
const MANUAL_TRADE_DISABLED = true;

export function TradePanel() {
  const [market, setMarket] = useState("");
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [expiresIn, setExpiresIn] = useState("");
  const [postOnly, setPostOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [limits, setLimits] = useState<TradeLimits | null>(null);
  const [open, setOpen] = useState<OpenOrderRow[]>([]);
  const [canceling, setCanceling] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trade");
      const data = (await res.json()) as {
        orders: OrderRow[];
        limits: TradeLimits;
        openOrders: OpenOrderRow[];
      };
      setOrders(data.orders);
      setLimits(data.limits);
      setOpen(data.openOrders ?? []);
    } catch {
      /* 面板不可用不影响主看板 */
    }
  }, []);

  async function cancel(id: number) {
    setCanceling(id);
    setError(null);
    try {
      const res = await fetch("/api/trade", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) setError(data.error ?? "撤单失败");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setCanceling(null);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    // 防御性:按钮已禁用,这里再挡一道,免得以后改动只解开按钮却漏了这里
    if (MANUAL_TRADE_DISABLED) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          market,
          outcome,
          side,
          amountUsd: side === "BUY" ? Number(amount) : undefined,
          shares: side === "SELL" ? Number(shares) : undefined,
          limitPrice: limitPrice ? Number(limitPrice) : undefined,
          expiresIn: expiresIn || undefined,
          postOnly: postOnly || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) setError(data.error ?? "下单失败");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded border border-line bg-panel2 px-2 py-1 text-xs placeholder-mut focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-40";
  const tabCls = (on: boolean) =>
    `flex-1 rounded px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-accent text-white" : "bg-panel2 text-mut"}`;

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink2">手动下单</h2>
        {limits && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              limits.enabled ? "bg-bad/15 text-bad-ink" : "bg-panel2 text-mut"
            }`}
            title={
              limits.enabled
                ? "TRADING_ENABLED=true,订单会真实提交"
                : "订单只签名不提交,记录在案供核对"
            }
          >
            {limits.enabled ? "实盘" : "DRY-RUN"}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <input
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          placeholder="市场 slug / 链接 / conditionId"
          className={inputCls}
          disabled={MANUAL_TRADE_DISABLED}
        />
        <div className="flex gap-1">
          <button
            className={tabCls(outcome === "yes")}
            onClick={() => setOutcome("yes")}
            disabled={MANUAL_TRADE_DISABLED}
          >
            YES
          </button>
          <button
            className={tabCls(outcome === "no")}
            onClick={() => setOutcome("no")}
            disabled={MANUAL_TRADE_DISABLED}
          >
            NO
          </button>
          <button
            className={tabCls(side === "BUY")}
            onClick={() => setSide("BUY")}
            disabled={MANUAL_TRADE_DISABLED}
          >
            买入
          </button>
          <button
            className={tabCls(side === "SELL")}
            onClick={() => setSide("SELL")}
            disabled={MANUAL_TRADE_DISABLED}
          >
            卖出
          </button>
        </div>
        {side === "BUY" ? (
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={`买入金额 $${limits ? `(单笔上限 ${limits.maxUsd})` : ""}`}
            className={inputCls}
            disabled={MANUAL_TRADE_DISABLED}
          />
        ) : (
          <input
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            inputMode="decimal"
            placeholder="卖出份额"
            className={inputCls}
            disabled={MANUAL_TRADE_DISABLED}
          />
        )}
        <input
          value={limitPrice}
          onChange={(e) => setLimitPrice(e.target.value)}
          inputMode="decimal"
          placeholder="限价(留空为市价单)"
          className={inputCls}
          disabled={MANUAL_TRADE_DISABLED}
        />
        {/* 有效期只对限价单有意义,市价单是即时成交或撤销 */}
        {limitPrice && (
          <select
            value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)}
            className={inputCls}
            disabled={MANUAL_TRADE_DISABLED}
            title="到期未成交则自动撤销;留空为挂到手动撤销为止"
          >
            <option value="">不过期(GTC,挂到撤销为止)</option>
            <option value="30m">30 分钟后过期</option>
            <option value="2h">2 小时后过期</option>
            <option value="8h">8 小时后过期</option>
            <option value="1d">1 天后过期</option>
            <option value="7d">7 天后过期</option>
          </select>
        )}
        {limitPrice && (
          <label
            className="flex items-center gap-1.5 text-[11px] text-mut"
            title="若这笔单会立即吃掉对手盘,交易所直接拒绝而不是成交。用于确保只赚 maker 手续费"
          >
            <input
              type="checkbox"
              checked={postOnly}
              onChange={(e) => setPostOnly(e.target.checked)}
              disabled={MANUAL_TRADE_DISABLED}
            />
            只做 maker(post-only)
          </label>
        )}
        <button
          onClick={submit}
          disabled={MANUAL_TRADE_DISABLED || busy || !market}
          className="w-full rounded bg-accent px-2 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {MANUAL_TRADE_DISABLED
            ? "已停用"
            : busy
              ? "提交中…"
              : limits?.enabled
                ? "确认下单"
                : "演练下单"}
        </button>
      </div>

      {MANUAL_TRADE_DISABLED && (
        <p className="mt-2 text-[11px] leading-4 text-mut">
          手动下单已暂停,面板与历史记录仅供查看。agent 端点与 CLI 不受影响。
        </p>
      )}

      {/* 挂单区。即便手动下单已停用也保留撤单——停掉的是开仓,不是收手的能力。
          数据以交易所为准,官网手动挂的单同样列在这里 */}
      {open.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h3 className="mb-1.5 text-[11px] text-ink2">
            未成交挂单
            <span className="ml-1.5 font-mono text-mut">{open.length}</span>
          </h3>
          <ul className="space-y-1.5">
            {open.map((o) => (
              <li key={o.clobOrderId} className="text-[11px] leading-4">
                <div className="flex items-center gap-1.5">
                  <span
                    className={o.side === "BUY" ? "text-up-ink" : "text-down-ink"}
                  >
                    {o.side === "BUY" ? "买" : "卖"}
                  </span>
                  <span className="text-ink2">{o.outcome?.toUpperCase()}</span>
                  <span className="font-mono tabular-nums text-mut">
                    {o.sizeRemaining.toFixed(2)}/{o.size.toFixed(2)} @{" "}
                    {o.price.toFixed(3)}
                  </span>
                  <span
                    className="rounded bg-panel2 px-1 text-[10px] text-mut"
                    title={
                      o.expiresAt
                        ? `到期 ${new Date(o.expiresAt).toLocaleString("zh-CN")}`
                        : "挂到撤销为止"
                    }
                  >
                    {o.orderType}
                  </span>
                  <button
                    onClick={() =>
                      o.orderId != null ? cancel(o.orderId) : undefined
                    }
                    disabled={canceling !== null || o.orderId == null}
                    title={
                      o.orderId == null
                        ? "这笔挂单不是本系统下的,请用 CLI 按 CLOB 订单号撤销"
                        : undefined
                    }
                    className="ml-auto shrink-0 text-bad-ink hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    {canceling === o.orderId ? "撤销中…" : "撤单"}
                  </button>
                </div>
                <div
                  className="truncate text-mut"
                  title={o.title ?? o.clobOrderId}
                >
                  {o.title ?? o.clobOrderId}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-bad-ink">{error}</p>}

      {orders.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {orders.slice(0, 6).map((o) => {
            const s = ORDER_STATUS[o.status] ?? {
              label: o.status,
              cls: "bg-panel2 text-mut",
            };
            return (
              <li key={o.id} className="text-[11px] leading-4">
                <div className="flex items-center gap-1.5">
                  <span className={`rounded px-1 py-px text-[10px] ${s.cls}`}>
                    {s.label}
                  </span>
                  <span className={o.side === "BUY" ? "text-up-ink" : "text-down-ink"}>
                    {o.side === "BUY" ? "买" : "卖"}
                  </span>
                  <span className="text-ink2">{o.outcome?.toUpperCase()}</span>
                  <span className="ml-auto font-mono tabular-nums text-mut">
                    {o.size_matched != null && (
                      <span className="mr-1.5 text-ink2" title="已成交份额">
                        成交 {o.size_matched.toFixed(2)}
                      </span>
                    )}
                    {o.amount_usd != null ? fmtUsd(o.amount_usd) : `${o.size ?? ""}`}
                  </span>
                </div>
                <div className="truncate text-mut" title={o.error ?? o.title ?? ""}>
                  {o.error ?? o.title ?? o.market_slug ?? o.condition_id}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
