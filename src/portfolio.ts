import type { AssetType } from "@polymarket/client";
import { fetchBalanceAllowance } from "@polymarket/client/actions";
import { DATA_API } from "./config";
import { fetchJson } from "./http";
import { getTradeClient } from "./trade/client";
import { spentToday, tradeLimits } from "./trade/risk";

// 我方交易钱包的资产视图。数据直接问 Polymarket,不走抓取管线——
// 管线只覆盖榜单与关注池地址,且 5 分钟起步,自己的仓位要看实时的。
// 人类面板 /api/portfolio 与 agent 端点 /api/agent/portfolio 共用本模块。

const COLLATERAL = "COLLATERAL" as AssetType;

export type PortfolioPosition = {
  conditionId: string;
  /** token id,前端按它订阅实时盘口 */
  asset?: string;
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

/** SDK 的 WalletType 枚举:0 EOA / 1 POLY_PROXY / 2 GNOSIS_SAFE / 3 DEPOSIT_WALLET */
const WALLET_TYPE_LABEL: Record<number, string> = {
  0: "EOA",
  1: "Poly Proxy",
  2: "Gnosis Safe",
  3: "Deposit Wallet",
};

export type Portfolio = {
  address: string;
  /** 签名者 EOA,与资金主体不是同一个地址 */
  signer: string;
  walletType: string;
  balanceUsd: number;
  positionsValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  /** 现金 + 持仓现值,一眼看出这个钱包现在值多少 */
  equity: number;
  positions: PortfolioPosition[];
  /** 风控上下文:让人和 agent 都知道还能下多少 */
  trading: {
    mode: "live" | "dry-run";
    maxUsdPerOrder: number;
    maxUsdPerDay: number;
    spentTodayUsd: number;
    remainingTodayUsd: number;
  };
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

  const [positions, realized, spent] = await Promise.all([
    fetchJson<PortfolioPosition[]>(`${DATA_API}/positions?user=${address}&limit=100`),
    realizedPnl(address),
    spentToday(),
  ]);

  const limits = tradeLimits();
  const positionsValue = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0);
  return {
    address,
    signer: client.account.signer,
    walletType:
      WALLET_TYPE_LABEL[client.account.walletType as number] ??
      String(client.account.walletType),
    balanceUsd,
    positionsValue,
    unrealizedPnl: positions.reduce((s, p) => s + (p.cashPnl ?? 0), 0),
    realizedPnl: realized,
    equity: balanceUsd + positionsValue,
    positions: positions
      .slice()
      .sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)),
    trading: {
      mode: limits.enabled ? "live" : "dry-run",
      maxUsdPerOrder: limits.maxUsd,
      maxUsdPerDay: limits.dailyMaxUsd,
      spentTodayUsd: spent,
      remainingTodayUsd: Math.max(0, limits.dailyMaxUsd - spent),
    },
  };
}
