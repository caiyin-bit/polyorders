import { query } from "./db";

// 某个地址的评分、当前持仓与最近成交。
// 人类版 /api/wallet/[address] 与 agent 版 /api/agent/wallet/[address] 共用,
// 免得改一次查询要记得改两处(同 placeOrder 与 portfolioSnapshot 的做法)。
//
// 列取两边的并集:多带几个字段的成本远低于两份 SQL 漂移的成本。

const OPEN_LIMIT = 50;
const TRADES_LIMIT = 50;

export type WalletScore = {
  rank: number | null;
  total_positions: number;
  winning_positions: number;
  win_rate: number;
  total_realized_pnl: number | null;
  avg_pnl: number | null;
};

export type WalletSnapshot = {
  score: WalletScore | null;
  openPositions: unknown[];
  /** 未平仓总数;超过 OPEN_LIMIT 时界面需要提示「仅显示前 N」 */
  openTotal: number;
  recentTrades: unknown[];
};

export async function walletSnapshot(address: string): Promise<WalletSnapshot> {
  const [score, open, openCount, trades] = await Promise.all([
    query<WalletScore>(
      `SELECT rank, total_positions, winning_positions, win_rate,
              total_realized_pnl, avg_pnl
       FROM scores WHERE address = $1`,
      [address],
    ),
    query(
      `SELECT condition_id, outcome, size, avg_price, cur_price,
              current_value, cash_pnl, title, event_slug
       FROM open_positions WHERE address = $1
       ORDER BY current_value DESC NULLS LAST
       LIMIT ${OPEN_LIMIT}`,
      [address],
    ),
    query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM open_positions WHERE address = $1",
      [address],
    ),
    query(
      `SELECT condition_id, side, price, size, usdc_size, outcome,
              title, event_slug, "timestamp"
       FROM trades WHERE address = $1
       ORDER BY "timestamp" DESC
       LIMIT ${TRADES_LIMIT}`,
      [address],
    ),
  ]);

  return {
    score: score.rows[0] ?? null,
    openPositions: open.rows,
    openTotal: openCount.rows[0].n,
    recentTrades: trades.rows,
  };
}
