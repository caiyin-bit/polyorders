export function shortAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function fmtPct(x: number | null): string {
  if (x === null) return "-";
  return `${(x * 100).toFixed(1)}%`;
}

export function fmtUsd(x: number | null): string {
  if (x === null) return "-";
  const abs = Math.abs(x);
  const s =
    abs >= 1_000_000
      ? `${(x / 1_000_000).toFixed(2)}M`
      : abs >= 1_000
        ? `${(x / 1_000).toFixed(1)}k`
        : x.toFixed(0);
  return `${x < 0 ? "-" : ""}$${s.replace("-", "")}`;
}

export function fmtTime(epochSec: number | null): string {
  if (!epochSec) return "-";
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}
