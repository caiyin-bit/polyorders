import {
  buildAnalysisPrompt,
  ANALYST_SYSTEM,
  type AnalysisClosedRow,
  type AnalysisInput,
  type AnalysisOpenPosition,
  type AnalysisTrade,
} from "@/src/analysis";
import { chat, isLlmConfigured } from "@/src/llm";
import { query } from "@/src/db";
import { walletSnapshot } from "@/src/wallet";

export const dynamic = "force-dynamic";

// 明细行数上限。持仓/成交沿用弹窗的 50;平仓明细取 30 条已够模型看出
// 近期节奏,聚合统计(集中度、盈亏比)覆盖的是全量,不受此限。
const RECENT_CLOSED_LIMIT = 30;
const CURVE_POINTS = 30;

// 用 POST 而非 GET:每次调用都真实消耗 LLM 费用,不该被预取或缓存命中
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  if (!isLlmConfigured()) {
    return Response.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY,分析功能不可用" },
      { status: 503 },
    );
  }
  const { address } = await params;
  const cutoff30d = Math.floor(Date.now() / 1000) - 30 * 86400;

  const [snapshot, candRes, aggRes, winsRes, lossesRes, recentRes, curveRes] =
    await Promise.all([
      walletSnapshot(address),
      query<{ username: string | null }>(
        "SELECT username FROM candidates WHERE address = $1",
        [address],
      ),
      query<{
        total: number;
        sum_pnl: number;
        avg_win: number | null;
        avg_loss: number | null;
        recent_count: number;
        recent_sum: number;
      }>(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(realized_pnl), 0)::float AS sum_pnl,
                (AVG(realized_pnl) FILTER (WHERE realized_pnl > 0))::float AS avg_win,
                (AVG(realized_pnl) FILTER (WHERE realized_pnl < 0))::float AS avg_loss,
                (COUNT(*) FILTER (WHERE "timestamp" >= $2))::int AS recent_count,
                COALESCE(SUM(realized_pnl) FILTER (WHERE "timestamp" >= $2), 0)::float AS recent_sum
         FROM closed_positions WHERE address = $1`,
        [address, cutoff30d],
      ),
      query<AnalysisClosedRow>(
        `SELECT "timestamp", title, outcome, avg_price, realized_pnl
         FROM closed_positions WHERE address = $1 AND realized_pnl > 0
         ORDER BY realized_pnl DESC LIMIT 5`,
        [address],
      ),
      query<AnalysisClosedRow>(
        `SELECT "timestamp", title, outcome, avg_price, realized_pnl
         FROM closed_positions WHERE address = $1 AND realized_pnl < 0
         ORDER BY realized_pnl ASC LIMIT 5`,
        [address],
      ),
      query<AnalysisClosedRow>(
        `SELECT "timestamp", title, outcome, avg_price, realized_pnl
         FROM closed_positions WHERE address = $1
         ORDER BY "timestamp" DESC NULLS LAST LIMIT ${RECENT_CLOSED_LIMIT}`,
        [address],
      ),
      query<{ realized_pnl: number; timestamp: number }>(
        `SELECT realized_pnl, "timestamp" FROM closed_positions
         WHERE address = $1 AND "timestamp" IS NOT NULL
         ORDER BY "timestamp" ASC`,
        [address],
      ),
    ]);

  let acc = 0;
  const series: Array<[number, number]> = curveRes.rows.map((p) => [
    p.timestamp,
    (acc += p.realized_pnl),
  ]);
  const step = Math.max(1, Math.ceil(series.length / CURVE_POINTS));
  const curve = series.filter(
    (_, i) => i % step === 0 || i === series.length - 1,
  );

  const agg = aggRes.rows[0];
  const input: AnalysisInput = {
    address,
    username: candRes.rows[0]?.username ?? null,
    now: new Date().toISOString(),
    score: snapshot.score,
    openTotal: snapshot.openTotal,
    openPositions: snapshot.openPositions as AnalysisOpenPosition[],
    trades: snapshot.recentTrades as AnalysisTrade[],
    closed: {
      total: agg.total,
      sumPnl: agg.sum_pnl,
      avgWin: agg.avg_win,
      avgLoss: agg.avg_loss,
      last30d: { count: agg.recent_count, sum: agg.recent_sum },
      topWins: winsRes.rows,
      topLosses: lossesRes.rows,
      recent: recentRes.rows,
    },
    curve,
  };

  try {
    const r = await chat(
      [
        { role: "system", content: ANALYST_SYSTEM },
        { role: "user", content: buildAnalysisPrompt(input) },
      ],
      // 低温度:同一份数据反复分析应给出基本一致的判断,这是审计不是创作。
      // reasoning 必须显式限档:默认与 medium 档实测思考 7k-8k token,把
      // maxTokens 全部吃掉导致正文为空;low 档(约 700 token 思考、全程 25s)
      // 的报告质量经真实数据核验没有损失。maxTokens 同时约束思考与正文
      {
        temperature: 0.3,
        maxTokens: 8192,
        timeoutMs: 120_000,
        reasoning: "low",
      },
    );
    return Response.json({
      content: r.content,
      model: r.model,
      usage: r.usage,
      generatedAt: Date.now(),
    });
  } catch (err) {
    console.error(`钱包分析失败 ${address}: ${String(err)}`);
    return Response.json(
      { error: "LLM 调用失败,请稍后重试" },
      { status: 502 },
    );
  }
}
