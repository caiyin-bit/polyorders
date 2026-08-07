import { COPY_DAILY_MAX_USD_DEFAULT, COPY_ORDER_USD } from "../config";
import { query } from "../db";
import type { RecordedSignal } from "../signals";
import { sendAlert } from "../telegram";
import { placeOrder } from "../trade/order";
import { bjDayStart, tradeLimits } from "../trade/risk";
import { evaluateSignal, RULES, STRATEGY } from "./rules";

// 跟单引擎。默认 shadow(只记录,一分钱不动);live 需要双开关:
// TRADING_ENABLED=true 且 COPY_TRADING_ENABLED=true,外加引擎自有的日预算。
// 每条信号必留一行 copy_decisions——「为什么没跟」与「跟了会怎样」同样是回测数据。

function copyMode(): "live" | "shadow" {
  return process.env.COPY_TRADING_ENABLED === "true" && tradeLimits().enabled
    ? "live"
    : "shadow";
}

function copyDailyMax(): number {
  const n = Number(process.env.COPY_DAILY_MAX_USD);
  return Number.isFinite(n) && n > 0 ? n : COPY_DAILY_MAX_USD_DEFAULT;
}

async function recordDecision(d: {
  signalId: number;
  decision: "copy" | "skip";
  skipReason?: string;
  simPrice?: number | null;
  simUsd?: number | null;
  orderId?: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO copy_decisions
       (signal_id, strategy, decision, skip_reason, sim_price, sim_usd, order_id, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      d.signalId,
      STRATEGY,
      d.decision,
      d.skipReason ?? null,
      d.simPrice ?? null,
      d.simUsd ?? null,
      d.orderId ?? null,
      Date.now(),
    ],
  );
}

/** 同一 (市场, outcome, 方向) 在冷却窗口内已跟过 */
async function inCooldown(s: RecordedSignal): Promise<boolean> {
  const { rows } = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM copy_decisions d JOIN signals sg ON sg.id = d.signal_id
     WHERE d.decision = 'copy' AND d.decided_at > $1
       AND sg.condition_id = $2
       AND sg.outcome IS NOT DISTINCT FROM $3 AND sg.side = $4`,
    [Date.now() - RULES.cooldownMs, s.conditionId, s.outcome, s.side],
  );
  return rows[0].n > 0;
}

/** live 跟单的当日已用额度(shadow 不占) */
async function copySpentToday(): Promise<number> {
  const { rows } = await query<{ total: number }>(
    `SELECT COALESCE(SUM(COALESCE(spend_usd, amount_usd)), 0)::float8 AS total
     FROM orders
     WHERE source_address IS NOT NULL AND NOT dry_run
       AND status NOT IN ('rejected', 'failed', 'blocked')
       AND created_at >= $1`,
    [bjDayStart(Date.now())],
  );
  return rows[0].total;
}

/**
 * 引擎入口:每记下一条新信号调一次(RTDS 实时路径与 watch 轮询兜底路径)。
 * 一律不抛错——跟单是旁路,任何异常都不能影响调用方主流程。
 */
export async function maybeCopy(
  s: RecordedSignal,
  sourceAddress: string,
): Promise<void> {
  try {
    const verdict = evaluateSignal(s);
    if (!verdict.copy) {
      await recordDecision({ signalId: s.id, decision: "skip", skipReason: verdict.reason });
      return;
    }
    if (await inCooldown(s)) {
      await recordDecision({ signalId: s.id, decision: "skip", skipReason: "cooldown" });
      return;
    }

    if (copyMode() === "shadow") {
      await recordDecision({
        signalId: s.id,
        decision: "copy",
        simPrice: s.bestAsk,
        simUsd: COPY_ORDER_USD,
      });
      return;
    }

    // ── live ──
    if ((await copySpentToday()) + COPY_ORDER_USD > copyDailyMax()) {
      await recordDecision({ signalId: s.id, decision: "skip", skipReason: "daily-budget" });
      return;
    }
    // placeOrder 只认 yes/no;多候选盘(outcome 是队名/人名)只能 shadow,
    // live 路径先跳过——这是 v1 的已知边界,不是遗漏
    const outcome = s.outcome?.toLowerCase();
    if (outcome !== "yes" && outcome !== "no") {
      await recordDecision({ signalId: s.id, decision: "skip", skipReason: "unsupported-outcome" });
      return;
    }
    const order = await placeOrder({
      market: s.conditionId,
      outcome,
      side: "BUY",
      amountUsd: COPY_ORDER_USD,
      sourceAddress,
    });
    await recordDecision({
      signalId: s.id,
      decision: "copy",
      simPrice: s.bestAsk,
      simUsd: COPY_ORDER_USD,
      orderId: order.id,
    });
    void sendAlert(
      `📋 跟单 ${sourceAddress.slice(0, 10)}… → 订单 #${order.id} ${order.status}\n` +
        `BUY ${outcome} $${COPY_ORDER_USD} — ${s.title ?? s.conditionId}`,
    );
  } catch (err) {
    console.error(`copy: 信号 ${s.id} 处理失败: ${String(err)}`);
  }
}
