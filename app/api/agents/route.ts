import { query } from "@/src/db";

export const dynamic = "force-dynamic";

// 人类侧的 agent 管理接口,受 middleware 保护(路径不在 api/agent/ 命名空间内)

const ALLOWED_SCOPES = ["read", "trade"];

export async function GET() {
  const { rows } = await query(
    `SELECT id, name, model, description, key_prefix, scopes,
            owner_id, claimed_at, last_seen_at, revoked_at, created_at
     FROM agents
     WHERE owner_id IS NOT NULL
     ORDER BY created_at DESC`,
  );
  return Response.json({ agents: rows });
}

export async function PATCH(req: Request) {
  let body: { id?: unknown; scopes?: unknown; revoked?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "缺少 id" }, { status: 400 });
  }

  if (Array.isArray(body.scopes)) {
    const scopes = body.scopes.map(String);
    const bad = scopes.filter((s) => !ALLOWED_SCOPES.includes(s));
    if (bad.length > 0) {
      return Response.json(
        { error: `不支持的权限:${bad.join(", ")}` },
        { status: 400 },
      );
    }
    await query("UPDATE agents SET scopes = $1 WHERE id = $2", [scopes, id]);
  }

  if (typeof body.revoked === "boolean") {
    await query("UPDATE agents SET revoked_at = $1 WHERE id = $2", [
      body.revoked ? Date.now() : null,
      id,
    ]);
  }

  const { rows } = await query(
    `SELECT id, name, model, key_prefix, scopes, last_seen_at, revoked_at
     FROM agents WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    return Response.json({ error: "agent 不存在" }, { status: 404 });
  }
  return Response.json(rows[0]);
}
