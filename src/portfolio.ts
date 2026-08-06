import type { AssetType } from "@polymarket/client";
import { fetchBalanceAllowance } from "@polymarket/client/actions";
import { DATA_API } from "./config";
import { fetchJson } from "./http";
import { getTradeClient } from "./trade/client";

// 我方交易钱包的资产视图。数据直接问 Polymarket,不走抓取管线——
// 管线只覆盖榜单与关注池地址,且 5 分钟起步,自己的仓位要看实时的。
// 人类面板 /api/portfolio 与 agent 端点 /api/agent/portfolio 共用本模块。

const COLLATERAL = "COLLATERAL" as AssetType;

export type PortfolioPosition = {
  conditionId: string;
  outcome?: string;
  size?: number;
  avgPrice?: number;
  curPrice?: number;
  currentValue?: number;
  cashPnl?: number;
  percentPnl?: number;
  title?: string;
  eventSlug?: string;
};

export type Portfolio = {
  address: string;
  balanceUsd: number;
  positionsValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  /** 现金 + 持仓现值,一眼看出这个钱包现在值多少 */
  equity: number;
  positions: PortfolioPosition[];
};

const CLOSED_PAGE = 100;
// 自有钱包的已平仓数量远达不到这个量级,取够即止
const CLOSED_MAX = 500;

/** 已实现盈亏:累加全部已平仓仓位 */
async function realizedPnl(address: string): Promise<number> {
  let total = 0;
  for (let offset = 0; offset < CLOSED_MAX; offset += CLOSED_PAGE) {
    const page = await fetchJson<Array<{ realizedPnl?: number }>>(
      `${DATA_API}/closed-positions?user=${address}&limit=${CLOSED_PAGE}&offset=${offset}`,
    );
    for (const p of page) total += p.realizedPnl ?? 0;
    if (page.length < CLOSED_PAGE) break;
  }
  return total;
}

export async function portfolioSnapshot(): Promise<Portfolio> {
  const client = await getTradeClient();
  const address = client.account.wallet;
  const ba = await fetchBalanceAllowance(client, { assetType: COLLATERAL });
  const balanceUsd = Number(ba.balance) / 1e6;

  const [positions, realized] = await Promise.all([
    fetchJson<PortfolioPosition[]>(`${DATA_API}/positions?user=${address}&limit=100`),
    realizedPnl(address),
  ]);

  const positionsValue = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0);
  return {
    address,
    balanceUsd,
    positionsValue,
    unrealizedPnl: positions.reduce((s, p) => s + (p.cashPnl ?? 0), 0),
    realizedPnl: realized,
    equity: balanceUsd + positionsValue,
    positions: positions
      .slice()
      .sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)),
  };
}
