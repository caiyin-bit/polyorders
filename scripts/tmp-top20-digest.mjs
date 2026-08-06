// 一次性脚本:拉 Top20 钱包详情,聚合最新动向(用完可删)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = JSON.parse(
  readFileSync(`${homedir()}/.config/polyorders/config.json`, "utf8"),
);
const H = { authorization: `Bearer ${cfg.apiKey}` };
const api = async (p) => (await fetch(cfg.origin + p, { headers: H })).json();

const lb = await api("/api/agent/leaderboard");
const top = lb.addresses.filter((a) => a.rank <= lb.topN);
const wallets = await Promise.all(
  top.map((a) => api(`/api/agent/wallet/${a.address}`)),
);

const now = Date.now() / 1000;
const DAY = 86400;
const perWallet = [];
const marketAgg = new Map(); // 近3天热点市场:去重钱包数 + 分方向金额

for (let i = 0; i < top.length; i++) {
  const { username, rank } = top[i];
  const w = wallets[i];
  const t7 = w.recentTrades.filter((t) => now - t.timestamp < 7 * DAY);
  const t3 = w.recentTrades.filter((t) => now - t.timestamp < 3 * DAY);
  for (const t of t3) {
    const key = t.title ?? t.condition_id;
    const m = marketAgg.get(key) ?? { wallets: new Set(), buyUsd: 0, sellUsd: 0, outcomes: {} };
    m.wallets.add(w.address);
    const usd = Number(t.usdc_size) || 0;
    if (t.side === "BUY") m.buyUsd += usd;
    else m.sellUsd += usd;
    const ok = `${t.side} ${t.outcome}`;
    m.outcomes[ok] = (m.outcomes[ok] ?? 0) + usd;
    marketAgg.set(key, m);
  }
  const posVal = w.openPositions.reduce((s, p) => s + (Number(p.current_value) || 0), 0);
  const posPnl = w.openPositions.reduce((s, p) => s + (Number(p.cash_pnl) || 0), 0);
  perWallet.push({
    rank,
    username,
    address: w.address.slice(0, 10),
    lastTradeAgoH: w.recentTrades[0] ? Math.round((now - w.recentTrades[0].timestamp) / 3600) : null,
    trades7d: t7.length,
    buyUsd7d: Math.round(t7.filter((t) => t.side === "BUY").reduce((s, t) => s + Number(t.usdc_size || 0), 0)),
    sellUsd7d: Math.round(t7.filter((t) => t.side === "SELL").reduce((s, t) => s + Number(t.usdc_size || 0), 0)),
    openCount: w.openPositions.length,
    openValueUsd: Math.round(posVal),
    openPnlUsd: Math.round(posPnl),
    topOpen: w.openPositions.slice(0, 3).map((p) => `${p.title}(${p.outcome} $${Math.round(p.current_value)})`),
    bigTrades3d: t3
      .sort((a, b) => b.usdc_size - a.usdc_size)
      .slice(0, 3)
      .map((t) => `${t.side} ${t.outcome} $${Math.round(t.usdc_size)} @${t.price} ${t.title}`),
  });
}

const hot = [...marketAgg.entries()]
  .map(([title, m]) => ({
    title,
    wallets: m.wallets.size,
    buyUsd: Math.round(m.buyUsd),
    sellUsd: Math.round(m.sellUsd),
    flows: Object.fromEntries(Object.entries(m.outcomes).map(([k, v]) => [k, Math.round(v)])),
  }))
  .sort((a, b) => b.wallets - a.wallets || b.buyUsd + b.sellUsd - a.buyUsd - a.sellUsd)
  .slice(0, 15);

console.log(JSON.stringify({ perWallet, hotMarkets3d: hot }, null, 2));
