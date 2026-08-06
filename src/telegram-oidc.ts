// Telegram 官方 OIDC:客户端 SDK(telegram-login.js)弹窗授权后返回
// 签名 JWT(id_token),此处用 Telegram 公开的 JWKS 验签(参考 crypto-blue 实现)。
// 仅在 Node 路由中使用,不进 Edge middleware。
import {
  createLocalJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";
import { telegramBotId, type TelegramUser } from "./auth";
import { fetchJson } from "./http";

const ISSUER = "https://oauth.telegram.org";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
// Telegram 的签名密钥极少轮换,缓存久一点;真轮换了靠 kid 未命中触发强制刷新
const CACHE_MS = 6 * 3_600_000;

let cache: { set: JSONWebKeySet; at: number } | null = null;
let inflight: Promise<JSONWebKeySet> | null = null;

function refresh(): Promise<JSONWebKeySet> {
  inflight ??= fetchJson<JSONWebKeySet>(JWKS_URL, 2)
    .then((set) => {
      cache = { set, at: Date.now() };
      return set;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * 取 JWKS。有缓存就立刻返回(哪怕已过期),过期时在后台刷新。
 *
 * 实测从首尔到 oauth.telegram.org 会偶发 ETIMEDOUT(域名有多条 A 记录,
 * 轮到不可达的那条就卡住)。登录路径不该被这种抖动阻塞——密钥轮换的频率
 * 远低于网络抖动,用一份过期密钥也好过让整个登录挂掉。
 */
async function getJwks(force = false): Promise<JSONWebKeySet> {
  if (force || !cache) return refresh();
  if (Date.now() - cache.at >= CACHE_MS) {
    void refresh().catch((err) =>
      console.warn(`telegram-oidc: JWKS 后台刷新失败,继续用缓存: ${String(err)}`),
    );
  }
  return cache.set;
}

function isKeyMiss(err: unknown): boolean {
  return (err as { code?: string })?.code === "ERR_JWKS_NO_MATCHING_KEY";
}

/** aud 可能是字符串或数组;必须包含我们的 bot 数字 ID */
export function audMatches(aud: JWTPayload["aud"], botId: string): boolean {
  if (aud == null) return false;
  return (Array.isArray(aud) ? aud : [aud]).some((a) => String(a) === botId);
}

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
    let payload: JWTPayload;
    try {
      const set = await getJwks();
      ({ payload } = await jwtVerify(idToken, createLocalJWKSet(set), {
        issuer: ISSUER,
      }));
    } catch (err) {
      // kid 不在缓存里,可能刚轮换过密钥:强制刷新后再试一次
      if (!isKeyMiss(err)) throw err;
      console.warn("telegram-oidc: kid 未命中缓存,强制刷新 JWKS 后重试");
      const set = await getJwks(true);
      ({ payload } = await jwtVerify(idToken, createLocalJWKSet(set), {
        issuer: ISSUER,
      }));
    }

    const botId = telegramBotId();
    if (!audMatches(payload.aud, botId)) {
      console.warn(
        `telegram-oidc: aud 不匹配,期望 ${botId},实际 ${JSON.stringify(payload.aud)}`,
      );
      return null;
    }
    const user = extractUser(payload);
    if (!user) console.warn("telegram-oidc: id_token 里没有可用的用户 ID");
    return user;
  } catch (err) {
    // 不再静默吞掉:上一次排查登录失败时,空 catch 让日志里什么线索都没有
    console.error(`telegram-oidc: 验签失败 — ${String(err)}`);
    return null;
  }
}
