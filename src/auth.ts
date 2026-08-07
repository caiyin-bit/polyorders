// 认证工具:仅用 Web Crypto,兼容 Edge middleware 与 Node 路由
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function fromB64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

async function hmacHex(key: ArrayBuffer | Uint8Array, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data)));
}

export type TelegramUser = {
  id: number;
  first_name?: string;
  username?: string;
};

/** Bot 数字 ID(即 token 冒号前的部分,也是 id_token 的 aud),非敏感 */
export function telegramBotId(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN 未配置");
  return token.split(":")[0];
}

export function isAllowed(id: number): boolean {
  const ids = (process.env.TELEGRAM_ALLOWED_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(String(id));
}

export const SESSION_COOKIE = "po_session";
export const DISPLAY_COOKIE = "po_user";
export const SESSION_MAX_AGE = 7 * 86_400;

// 待审凭证:Telegram 验签已过、身份为真,但没有任何权限。
// 它与正式会话用同一套签名,因此必须靠 typ 区分——否则把 po_pending 的值
// 塞进 po_session 就能直接进看板。
export const PENDING_COOKIE = "po_pending";
export const PENDING_MAX_AGE = 30 * 60;
const PENDING_TYP = "pending";

function authSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!secret) throw new Error("AUTH_SECRET 未配置");
  return enc.encode(secret);
}

export async function createSession(user: TelegramUser): Promise<string> {
  const payload = b64url(
    JSON.stringify({
      id: user.id,
      name: user.username ?? user.first_name ?? String(user.id),
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    }),
  );
  return `${payload}.${await hmacHex(authSecret(), payload)}`;
}

/** 待审凭证:只证明「这个 Telegram 身份是真的」,不代表任何权限 */
export async function createPendingToken(user: TelegramUser): Promise<string> {
  const payload = b64url(
    JSON.stringify({
      id: user.id,
      name: user.username ?? user.first_name ?? String(user.id),
      typ: PENDING_TYP,
      exp: Math.floor(Date.now() / 1000) + PENDING_MAX_AGE,
    }),
  );
  return `${payload}.${await hmacHex(authSecret(), payload)}`;
}

type TokenPayload = { id: number; name: string; exp: number; typ?: string };

async function readToken(token: string): Promise<TokenPayload | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if ((await hmacHex(authSecret(), payload)) !== sig) return null;
  try {
    const data = JSON.parse(fromB64url(payload)) as TokenPayload;
    if (data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export async function verifySession(
  token: string,
): Promise<{ id: number; name: string } | null> {
  const data = await readToken(token);
  // 待审凭证一律不能当正式会话用;历史 token 没有 typ,视为正式会话
  if (!data || data.typ === PENDING_TYP) return null;
  return { id: data.id, name: data.name };
}

export async function verifyPendingToken(
  token: string,
): Promise<{ id: number; name: string } | null> {
  const data = await readToken(token);
  if (!data || data.typ !== PENDING_TYP) return null;
  return { id: data.id, name: data.name };
}
