import { query } from "../db";
import { sendAlert } from "../telegram";
import { getTradeClient } from "./client";

// 挂单管理:查询未成交挂单、撤单。
//
// 之前只能挂单不能撤单——限价单发出去就收不回来,只能去官网手动处理。
// 这是安全缺口而不只是功能缺失,所以优先于限时、post-only 等其它增强。

export type OpenOrderView = {
  clobOrderId: string;
  /** 库内订单 id;官网手动挂的单在库里没有记录,为 null */
  orderId: number | null;
  conditionId: string;
  tokenId: string;
  title: string | null;
  outcome: string | null;
  side: string;
  price: number;
  size: number;
  sizeMatched: number;
  /** 还剩多少份额没成交 */
  sizeRemaining: number;
  orderType: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
};

/**
 * CLOB 上当前挂着的未成交订单。
 *
 * 数据以 CLOB 为准而非库内记录:官网或别处手动挂的单库里没有,
 * 但它们同样占用资金、同样需要能看见和撤掉。
 */
export async function openOrders(): Promise<OpenOrderView[]> {
  const client = await getTradeClient();
  const items = [];
  for await (const page of client.listOpenOrders()) {
    items.push(...page.items);
  }
  if (items.length === 0) return [];

  // 关联库内记录,补上标题与我方订单号
  const { rows } = await query<{
    id: number;
    clob_order_id: string;
    title: string | null;
    outcome: string | null;
  }>(
    `SELECT id, clob_order_id, title, outcome FROM orders
     WHERE clob_order_id = ANY($1)`,
    [items.map((o) => o.id)],
  );
  const mine = new Map(rows.map((r) => [r.clob_order_id, r]));

  return items.map((o) => {
    const local = mine.get(o.id);
    const size = Number(o.originalSize);
    const matched = Number(o.sizeMatched);
    return {
      clobOrderId: o.id,
      orderId: local?.id ?? null,
      conditionId: o.conditionId,
      tokenId: o.tokenId,
      title: local?.title ?? null,
      outcome: local?.outcome ?? o.outcome,
      side: o.side,
      price: Number(o.price),
      size,
      sizeMatched: matched,
      sizeRemaining: Math.max(0, size - matched),
      orderType: o.orderType,
      status: o.status,
      createdAt: o.createdAt,
      expiresAt: o.expiresAt ?? null,
    };
  });
}

export type CancelResult = {
  ok: boolean;
  clobOrderId: string;
  error?: string;
};

/**
 * 解读交易所的撤单回执。
 *
 * 关键在最后一条:既不在 canceled 里、也没给拒绝原因时,必须当失败处理。
 * 默认成功会让「以为撤了其实没撤」的单继续挂在盘上,是最危险的静默失败。
 */
export function interpretCancel(
  res: { canceled?: string[]; notCanceled?: Record<string, string> },
  clobOrderId: string,
): CancelResult {
  const refused = res.notCanceled?.[clobOrderId];
  if (refused) return { ok: false, clobOrderId, error: refused };
  if (!res.canceled?.includes(clobOrderId)) {
    return { ok: false, clobOrderId, error: "交易所未确认撤单" };
  }
  return { ok: true, clobOrderId };
}

/** 撤单前的可撤性判定;可撤返回 null,否则返回中文原因 */
export function cancelEligibility(
  id: number,
  row: { clob_order_id: string | null; status: string; dry_run: boolean } | undefined,
): string | null {
  if (!row) return `订单 ${id} 不存在`;
  if (row.dry_run || !row.clob_order_id) return "该订单未提交到交易所,无需撤销";
  if (row.status !== "submitted") {
    return `订单当前状态为 ${row.status},不可撤销`;
  }
  return null;
}

/**
 * 按 CLOB 订单号撤单,并把库内记录标记为已撤销。
 *
 * 允许撤销库里没有记录的单(官网手动挂的),因为看得见就该撤得掉;
 * 这类单撤销后自然没有库记录可更新。
 */
export async function cancelByClobId(
  clobOrderId: string,
  by?: { agentId?: number },
): Promise<CancelResult> {
  const client = await getTradeClient();
  let res;
  try {
    res = await client.cancelOrder({ orderId: clobOrderId });
  } catch (err) {
    return { ok: false, clobOrderId, error: String(err) };
  }

  // SDK 用品牌类型 OrderId 做名义类型,普通字符串索引不了;
  // 运行时就是字符串,断言成普通形状即可(同 wallet-doctor 对 AssetType 的处理)
  const verdict = interpretCancel(
    res as unknown as { canceled?: string[]; notCanceled?: Record<string, string> },
    clobOrderId,
  );
  if (!verdict.ok) return verdict;

  const { rows } = await query<{ id: number; title: string | null }>(
    `UPDATE orders SET status = 'canceled', clob_status = 'CANCELED',
            clob_checked_at = $2
     WHERE clob_order_id = $1 RETURNING id, title`,
    [clobOrderId, Date.now()],
  );

  const local = rows[0];
  const who = by?.agentId ? ` [agent#${by.agentId}]` : "";
  void sendAlert(
    `🗑 已撤单${local ? ` #${local.id}` : ""}${who}\n${local?.title ?? clobOrderId}`,
  );
  return { ok: true, clobOrderId };
}

/** 按库内订单 id 撤单;找不到或不是可撤状态时返回原因 */
export async function cancelByOrderId(
  id: number,
  by?: { agentId?: number },
): Promise<CancelResult> {
  const { rows } = await query<{
    clob_order_id: string | null;
    status: string;
    dry_run: boolean;
  }>("SELECT clob_order_id, status, dry_run FROM orders WHERE id = $1", [id]);

  const row = rows[0];
  const blocked = cancelEligibility(id, row);
  if (blocked) {
    return { ok: false, clobOrderId: row?.clob_order_id ?? "", error: blocked };
  }
  return cancelByClobId(row.clob_order_id!, by);
}
