// 限价单的有效期(GTD)。
//
// SDK 的硬性要求是到期时间至少 3 分钟以后,并提示调用方自行为网络延迟与
// 时钟偏移留余量。这里把下限提到 5 分钟:多出的 2 分钟就是那个余量,
// 免得刚好卡在边界上被交易所拒单。

/** 到期时间下限(分钟)。SDK 硬下限 3 分钟,多留 2 分钟给延迟与时钟偏移 */
export const MIN_EXPIRY_MINUTES = 5;
/** 上限一年:再长的挂单没有实际意义,多半是把秒当成了分钟 */
export const MAX_EXPIRY_MINUTES = 365 * 24 * 60;

const UNITS: Record<string, number> = { m: 1, h: 60, d: 1440 };

/**
 * 解析有效期写法:数字按分钟,也接受 "30m" / "2h" / "1d" 后缀。
 * 返回分钟数;不合法返回中文原因。给 agent 用后缀写法比纯数字更不容易搞错单位。
 */
export function parseDuration(
  input: string | number | undefined | null,
): { minutes: number } | { error: string } {
  if (input === undefined || input === null || input === "") {
    return { minutes: 0 }; // 0 表示不设有效期,即 GTC
  }
  let minutes: number;
  if (typeof input === "number") {
    minutes = input;
  } else {
    const m = /^(\d+(?:\.\d+)?)\s*([mhd])?$/i.exec(input.trim());
    if (!m) return { error: `无法解析有效期「${input}」,可用写法:90、30m、2h、1d` };
    minutes = Number(m[1]) * (UNITS[(m[2] ?? "m").toLowerCase()] ?? 1);
  }
  if (!Number.isFinite(minutes) || minutes < 0) {
    return { error: "有效期必须是正数" };
  }
  if (minutes === 0) return { minutes: 0 };
  if (minutes < MIN_EXPIRY_MINUTES) {
    return { error: `有效期至少 ${MIN_EXPIRY_MINUTES} 分钟(交易所要求 3 分钟,另留余量)` };
  }
  if (minutes > MAX_EXPIRY_MINUTES) {
    return { error: `有效期最长 ${MAX_EXPIRY_MINUTES} 分钟(一年)` };
  }
  return { minutes };
}

/** 到期时刻的 Unix 秒;minutes 为 0 表示不设有效期(GTC),返回 undefined */
export function expirationTs(minutes: number, nowMs: number): number | undefined {
  if (!minutes) return undefined;
  return Math.floor(nowMs / 1000) + Math.round(minutes * 60);
}

/** 订单类型:限价 + 有效期为 GTD,限价无有效期为 GTC,市价为 FAK */
export function orderTypeOf(opts: {
  limitPrice?: number | null;
  expiryMinutes?: number;
}): "GTD" | "GTC" | "FAK" {
  if (!opts.limitPrice) return "FAK";
  return opts.expiryMinutes ? "GTD" : "GTC";
}
