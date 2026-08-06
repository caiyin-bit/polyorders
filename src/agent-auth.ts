// Agent 凭据:生成、哈希、校验。
// 沿用 src/auth.ts 的做法只用 Web Crypto,不引入额外依赖。
import { query } from "./db";

const KEY_PREFIX = "po_ag_";
/** 前缀 + 8 位,仅供界面识别,不参与鉴权 */
const DISPLAY_PREFIX_LEN = KEY_PREFIX.length + 8;

export type Agent = {
  id: number;
  name: string;
  model: string | null;
  scopes: string[];
  owner_id: number | null;
};

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomBase64url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}

export async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/** 生成 API key 明文;调用方负责存 hash 并只返回一次明文 */
export function generateKey(): { key: string; prefix: string } {
  const key = KEY_PREFIX + randomBase64url(32);
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LEN) };
}

export function generateClaimToken(): string {
  return randomBase64url(24);
}

/**
 * 请求来源 origin。线上经 Caddy 反代,req.url 是容器内的 localhost:3000,
 * 必须优先取转发头,否则给 agent 的 URL 会指向内网地址。
 */
export function requestOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** 带 HTTP 状态码的错误,路由里直接转成响应 */
export class AgentAuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 校验 Authorization: Bearer <key>。
 *
 * 未认领(owner_id IS NULL)与已撤销都视为无效——匿名注册拿到的 key
 * 在人类认领之前不具备任何权限。
 */
export async function requireAgent(req: Request): Promise<Agent> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) {
    throw new AgentAuthError(401, "缺少 Authorization: Bearer <apiKey>");
  }

  const { rows } = await query<Agent & { revoked_at: number | null }>(
    `SELECT id, name, model, scopes, owner_id, revoked_at
     FROM agents WHERE key_hash = $1`,
    [await hashKey(key)],
  );
  const agent = rows[0];
  if (!agent) throw new AgentAuthError(401, "apiKey 无效");
  if (agent.revoked_at !== null) throw new AgentAuthError(403, "该 agent 已被撤销");
  if (agent.owner_id === null) {
    throw new AgentAuthError(
      403,
      "该 agent 尚未被认领:请把注册时返回的 claimUrl 交给你的人类主人,由其打开并完成认领",
    );
  }

  // 不阻塞响应;失败不影响鉴权结果
  void query("UPDATE agents SET last_seen_at = $1 WHERE id = $2", [
    Date.now(),
    agent.id,
  ]).catch(() => {});

  return agent;
}

export function requireScope(agent: Agent, scope: string): void {
  if (!agent.scopes.includes(scope)) {
    throw new AgentAuthError(
      403,
      `缺少 ${scope} 权限:请让你的人类主人在仪表盘的「Agent 接入」面板中授予`,
    );
  }
}

/** 把 AgentAuthError 转成响应,其余错误交给调用方 */
export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof AgentAuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
