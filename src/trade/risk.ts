import { TRADE_DAILY_MAX_USD_DEFAULT, TRADE_MAX_USD_DEFAULT } from "../config";
import { query } from "../db";

export type TradeLimits = {
  enabled: boolean;
  maxUsd: number;
  dailyMaxUsd: number;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function tradeLimits(): TradeLimits {
  return {
    // 必须显式等于 "true";留空、"1"、"yes" 等一律视为关闭,避免误配置放出真单
    enabled: process.env.TRADING_ENABLED === "true",
    maxUsd: envNumber("TRADE_MAX_USD", TRADE_MAX_USD_DEFAULT),
    dailyMaxUsd: envNumber("TRADE_DAILY_MAX_USD", TRADE_DAILY_MAX_USD_DEFAULT),
  };
}

// 与抓取面板一致按北京时间划分自然日,不依赖进程时区
const BJ_OFFSET_MS = 8 * 3600_000;

function bjDayStart(now: number): number {
  return Math.floor((now + BJ_OFFSET_MS) / 86400_000) * 86400_000 - BJ_OFFSET_MS;
}

/** 当日已真实成交/挂出的美元金额;dry-run 不计入 */
export async function spentToday(): Promise<number> {
  const { rows } = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount_usd), 0)::float8 AS total
     FROM orders
     WHERE NOT dry_run AND status NOT IN ('rejected', 'failed', 'blocked')
       AND created_at >= $1`,
    [bjDayStart(Date.now())],
  );
  return rows[0].total;
}

/**
 * 限额校验。通过返回 null,否则返回中文拒绝原因。
 * dry-run 同样校验,这样核对时能提前发现限额配置不合理。
 */
export async function checkLimits(amountUsd: number): Promise<string | null> {
  const limits = tradeLimits();
  if (!(amountUsd > 0)) return "下单金额必须大于 0";
  if (amountUsd > limits.maxUsd) {
    return `超出单笔上限:$${amountUsd} > $${limits.maxUsd}`;
  }
  const spent = await spentToday();
  if (spent + amountUsd > limits.dailyMaxUsd) {
    return `超出日累计上限:今日已用 $${spent.toFixed(2)},本单 $${amountUsd},上限 $${limits.dailyMaxUsd}`;
  }
  return null;
}
