// 我方权益快照,由 crond 每小时触发。权益曲线的数据源。
// 失败只打日志:交易钱包未配置的环境(如本地开发)不该被小时级报错刷屏。
import { getPool, query } from "../src/db";
import { assertEnv } from "../src/env";
import { portfolioSnapshot } from "../src/portfolio";

assertEnv("worker");

try {
  const p = await portfolioSnapshot();
  await query(
    `INSERT INTO equity_snapshots (ts, balance_usd, positions_value, unrealized_pnl, realized_pnl)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (ts) DO NOTHING`,
    [Date.now(), p.balanceUsd, p.positionsValue, p.unrealizedPnl, p.realizedPnl],
  );
  console.log(
    `equity-snapshot: equity=$${p.equity.toFixed(2)} cash=$${p.balanceUsd.toFixed(2)}`,
  );
} catch (err) {
  console.error(`equity-snapshot: 跳过 ${String(err)}`);
}
await getPool().end();
