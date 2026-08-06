import { query } from "../db";
import { getTradeClient } from "./client";

// 轮询已提交订单的 CLOB 状态,回填 orders 表。
// 只关心非终态的实盘单;dry-run 从未提交,无状态可查。

type PendingOrder = { id: number; clob_order_id: string };

/** CLOB 终态:状态不再变化,停止轮询 */
function isTerminal(status: string, sizeMatched: number, originalSize: number): boolean {
  const s = status.toUpperCase();
  return (
    s === "MATCHED" ||
    s === "CANCELED" ||
    (originalSize > 0 && sizeMatched >= originalSize)
  );
}

export async function pollOrderStatuses(): Promise<{
  checked: number;
  settled: number;
}> {
  const { rows } = await query<PendingOrder>(
    `SELECT id, clob_order_id FROM orders
     WHERE NOT dry_run AND status = 'submitted' AND clob_order_id IS NOT NULL
       AND (clob_status IS NULL
            OR upper(clob_status) NOT IN ('MATCHED', 'CANCELED', 'NOT_FOUND'))
     ORDER BY id`,
  );
  if (rows.length === 0) return { checked: 0, settled: 0 };

  // 有待查订单才建客户端:每次进程启动派生 L2 凭据需要一次私钥签名,空轮免掉
  const client = await getTradeClient();
  let settled = 0;

  for (const row of rows) {
    let status: string;
    let matched: number | null = null;
    try {
      const order = await client.fetchOrder({ orderId: row.clob_order_id });
      status = order.status;
      matched = Number(order.sizeMatched);
      if (isTerminal(order.status, matched, Number(order.originalSize))) {
        settled++;
      }
    } catch (err) {
      const msg = String(err);
      // 仅明确的 404 视为订单已从 CLOB 移除(成交结算或过期清理),标记终态;
      // 网络等其它错误跳过本轮,下次重试,避免误标
      if (!/404|not found/i.test(msg)) {
        console.error(`poll: order ${row.id} 查询失败,跳过: ${msg}`);
        continue;
      }
      status = "NOT_FOUND";
      settled++;
    }
    await query(
      `UPDATE orders
       SET clob_status = $1, size_matched = COALESCE($2, size_matched), clob_checked_at = $3
       WHERE id = $4`,
      [status, matched, Date.now(), row.id],
    );
    console.log(
      `poll: order ${row.id} → ${status}${matched !== null ? ` matched=${matched}` : ""}`,
    );
  }
  return { checked: rows.length, settled };
}
