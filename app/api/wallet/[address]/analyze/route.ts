import {
  createAnalysisTask,
  executeAnalysisTask,
  isStaleRunning,
  latestAnalysis,
  type AnalysisRow,
} from "@/src/analysis-service";
import { isLlmConfigured } from "@/src/llm";

export const dynamic = "force-dynamic";

function toApi(r: AnalysisRow) {
  const stale = isStaleRunning(r.status, r.started_at);
  return {
    status: stale ? "error" : r.status,
    content: r.content,
    model: r.model,
    rating: r.rating,
    ratingReason: r.rating_reason,
    usage: {
      promptTokens: r.prompt_tokens ?? 0,
      completionTokens: r.completion_tokens ?? 0,
    },
    error: stale ? "分析中断(服务可能重启过),请重新分析" : r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

/** 弹窗打开时恢复状态:最新一条分析,可能是 running/done/error */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const row = await latestAnalysis(address);
  return Response.json({ analysis: row ? toApi(row) : null });
}

/** 发起分析:登记任务立即返回,前端轮询 GET 取结果。POST 语义:每次都花钱 */
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
  const id = await createAnalysisTask(address);
  if (id !== null) void executeAnalysisTask(id, address);
  const row = await latestAnalysis(address);
  return Response.json({ analysis: row ? toApi(row) : null });
}
