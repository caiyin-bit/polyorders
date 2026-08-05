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

/** 校验 Telegram Login Widget 回调参数(官方 HMAC 方案),1 天内有效 */
export async function verifyTelegramAuth(
  params: URLSearchParams,
  botToken: string,
): Promise<TelegramUser | null> {
  const hash = params.get("hash");
  if (!hash) return null;
  const dataCheckString = [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = await crypto.subtle.digest("SHA-256", enc.encode(botToken));
  if ((await hmacHex(secretKey, dataCheckString)) !== hash) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > 86_400) return null;
  const id = Number(params.get("id"));
  if (!Number.isInteger(id)) return null;
  return {
    id,
    first_name: params.get("first_name") ?? undefined,
    username: params.get("username") ?? undefined,
  };
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

export async function verifySession(
  token: string,
): Promise<{ id: number; name: string } | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if ((await hmacHex(authSecret(), payload)) !== sig) return null;
  try {
    const data = JSON.parse(fromB64url(payload)) as {
      id: number;
      name: string;
      exp: number;
    };
    if (data.exp < Date.now() / 1000) return null;
    return { id: data.id, name: data.name };
  } catch {
    return null;
  }
}
