export function shortAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function fmtPct(x: number | null): string {
  if (x === null) return "-";
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * 金额格式化,按量级保留约三位有效数字。
 *
 * 10 美元以下保留分位:榜单地址是几十万美元量级,取整没问题,但自有账户只有
 * 几美元——整数化会把 $0.02 的浮盈显示成 $0,看着像没盈亏。
 */
export function fmtUsd(x: number | null): string {
  if (x === null) return "-";
  const abs = Math.abs(x);
  const s =
    abs >= 1_000_000
      ? `${(abs / 1_000_000).toFixed(2)}M`
      : abs >= 1_000
        ? `${(abs / 1_000).toFixed(1)}k`
        : abs >= 10
          ? abs.toFixed(0)
          : abs.toFixed(2);
  return `${x < 0 ? "-" : ""}$${s}`;
}

// 时间格式化分两套,单位不同,用错会显示成公元五万年——务必按列的单位选:
// 库内约定 *_at 列为毫秒(Date.now()),trades/closed_positions.timestamp 为秒。

/** 入参为**秒**(API 原始值);输出 YYYY-MM-DD */
export function fmtTime(epochSec: number | null): string {
  if (!epochSec) return "-";
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

/** 入参为**毫秒**(Date.now());输出「3 分钟前」这类相对时间 */
export function fmtAgo(epochMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (s < 5) return "刚刚";
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  return `${Math.round(s / 86400)} 天前`;
}
