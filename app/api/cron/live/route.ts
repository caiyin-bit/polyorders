import { getPool, query } from "@/src/db";
import { fetchLive } from "@/src/fetch/live";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel Cron 触发的 live 抓取(Top N 持仓快照 + 成交流水)。
 * Vercel 调用时会带 Authorization: Bearer $CRON_SECRET。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const started = Date.now();
  const { rows } = await query<{ id: number }>(
    "INSERT INTO fetch_runs (step, started_at) VALUES ($1, $2) RETURNING id",
    ["live", started],
  );
  const runId = rows[0].id;

  try {
    const result = await fetchLive();
    await query(
      "UPDATE fetch_runs SET finished_at = $1, addresses_ok = $2, addresses_failed = $3 WHERE id = $4",
      [Date.now(), result.ok, result.failed, runId],
    );
    return Response.json({
      ok: result.ok,
      failed: result.failed,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    await query(
      "UPDATE fetch_runs SET finished_at = $1, error = $2 WHERE id = $3",
      [Date.now(), String(err), runId],
    );
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    // serverless 实例可能被复用,连接池交由平台回收,此处不主动 end
    void getPool;
  }
}
