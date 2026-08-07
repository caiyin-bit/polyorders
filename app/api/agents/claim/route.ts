import { requireAdmin } from "@/src/session";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/src/auth";
import { AGENT_CLAIM_TTL_MS } from "@/src/config";
import { query } from "@/src/db";

export const dynamic = "force-dynamic";

// 本路由受 middleware 保护(路径不在 api/agent/ 命名空间内),
// 但仍需自行读取会话以取得认领者的 Telegram ID。

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("denied" in guard) return guard.denied;
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = cookie ? await verifySession(cookie) : null;
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let token = "";
  try {
    token = String(((await req.json()) as { token?: unknown }).token ?? "");
  } catch {}
  if (!token) return Response.json({ error: "缺少 token" }, { status: 400 });

  // 条件里带上「未认领」与「未过期」,保证 token 一次性且有时效
  const { rows } = await query<{ id: number; name: string }>(
    `UPDATE agents
     SET owner_id = $1, claimed_at = $2, claim_token = NULL
     WHERE claim_token = $3 AND owner_id IS NULL AND created_at > $4
     RETURNING id, name`,
    [session.id, Date.now(), token, Date.now() - AGENT_CLAIM_TTL_MS],
  );
  if (rows.length === 0) {
    return Response.json(
      { error: "认领链接无效、已被使用或已过期" },
      { status: 404 },
    );
  }

  return Response.json({ ok: true, agent: rows[0] });
}
