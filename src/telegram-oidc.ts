// Telegram 官方 OIDC:客户端 SDK(telegram-login.js)弹窗授权后返回
// RS256 签名的 id_token,此处用 Telegram 公开的 JWKS 验签(参考 crypto-blue 实现)。
// 仅在 Node 路由中使用,不进 Edge middleware。
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { telegramBotId, type TelegramUser } from "./auth";

const ISSUER = "https://oauth.telegram.org";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

function extractUser(claims: JWTPayload): TelegramUser | null {
  const rawId = claims.id ?? claims.sub;
  if (rawId == null) return null;
  const id = Number(rawId);
  if (!Number.isInteger(id)) return null;
  return {
    id,
    first_name:
      (typeof claims.name === "string" && claims.name) ||
      (typeof claims.given_name === "string" && claims.given_name) ||
      undefined,
    username:
      typeof claims.preferred_username === "string"
        ? claims.preferred_username
        : undefined,
  };
}

/** 验证 id_token(签名、issuer、aud=bot 数字 ID),失败返回 null */
export async function verifyTelegramIdToken(
  idToken: string,
): Promise<TelegramUser | null> {
  try {
    const { payload } = await jwtVerify(idToken, JWKS, { issuer: ISSUER });
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.some((a) => String(a) === telegramBotId())) return null;
    return extractUser(payload);
  } catch {
    return null;
  }
}
