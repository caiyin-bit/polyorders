import type { AssetType } from "@polymarket/client";
import { fetchBalanceAllowance } from "@polymarket/client/actions";
import { DATA_API } from "@/src/config";
import { fetchJson } from "@/src/http";
import { getTradeClient } from "@/src/trade/client";

export const dynamic = "force-dynamic";

// 我方交易钱包的资产视图。数据直接问 Polymarket,不走抓取管线——
// 管线只覆盖榜单与关注池地址,且 5 分钟起步,自己的仓位要看实时的。

const COLLATERAL = "COLLATERAL" as AssetType;

type ApiOpenPosition = {
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

export async function GET() {
  let address: string;
  let balanceUsd: number;
  try {
    const client = await getTradeClient();
    address = client.account.wallet;
    const ba = await fetchBalanceAllowance(client, { assetType: COLLATERAL });
    balanceUsd = Number(ba.balance) / 1e6;
  } catch (err) {
    // 私钥未配置等情况:面板给出提示而不是整块报错
    return Response.json({ configured: false, error: String(err) });
  }

  try {
    const [positions, realized] = await Promise.all([
      fetchJson<ApiOpenPosition[]>(`${DATA_API}/positions?user=${address}&limit=100`),
      realizedPnl(address),
    ]);

    const positionsValue = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0);
    const unrealizedPnl = positions.reduce((s, p) => s + (p.cashPnl ?? 0), 0);

    return Response.json({
      configured: true,
      address,
      balanceUsd,
      positionsValue,
      unrealizedPnl,
      realizedPnl: realized,
      // 总权益:现金 + 持仓现值,一眼看出这个钱包现在值多少
      equity: balanceUsd + positionsValue,
      positions: positions
        .slice()
        .sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)),
    });
  } catch (err) {
    return Response.json(
      { configured: true, address, balanceUsd, error: String(err) },
      { status: 502 },
    );
  }
}
