import { AGENT_CLAIM_TTL_MS, AGENT_UNCLAIMED_LIMIT } from "@/src/config";
import { query } from "@/src/db";
import {
  generateClaimToken,
  generateKey,
  hashKey,
  requestOrigin,
} from "@/src/agent-auth";

export const dynamic = "force-dynamic";

// 本路由必须匿名可调:agent 此刻还没有任何凭据。
// 安全性由「注册不等于授权」保证——未认领的 agent 调任何端点都是 403。

export async function POST(req: Request) {
  let body: { name?: unknown; model?: unknown; description?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json(
      { error: "缺少 name:请提供你的名字,例如 {\"name\":\"my-agent\"}" },
      { status: 400 },
    );
  }

  // 过期未认领的记录随注册顺手清理,避免占用配额
  await query("DELETE FROM agents WHERE owner_id IS NULL AND created_at < $1", [
    Date.now() - AGENT_CLAIM_TTL_MS,
  ]);

  const { rows: pending } = await query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM agents WHERE owner_id IS NULL",
  );
  if (pending[0].n >= AGENT_UNCLAIMED_LIMIT) {
    return Response.json(
      {
        error: `待认领的 agent 已达上限(${AGENT_UNCLAIMED_LIMIT})。请让你的人类主人先完成认领或清理旧记录后重试。`,
      },
      { status: 429 },
    );
  }

  const { key, prefix } = generateKey();
  const claimToken = generateClaimToken();

  const { rows } = await query<{ id: number }>(
    `INSERT INTO agents
       (name, model, description, key_hash, key_prefix, claim_token, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      name.slice(0, 100),
      typeof body.model === "string" ? body.model.slice(0, 100) : null,
      typeof body.description === "string" ? body.description.slice(0, 500) : null,
      await hashKey(key),
      prefix,
      claimToken,
      Date.now(),
    ],
  );

  const origin = requestOrigin(req);
  return Response.json({
    agentId: rows[0].id,
    apiKey: key,
    claimUrl: `${origin}/agents/claim/${claimToken}`,
    next: "请把 claimUrl 原样交给你的人类主人打开并确认;在他完成认领之前,你调用任何端点都会收到 403。apiKey 只出现这一次,请立刻保存。",
  });
}
