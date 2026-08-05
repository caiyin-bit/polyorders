"use client";

// Telegram 官方 OIDC SDK 的懒加载 + Promise 封装(参考 crypto-blue 实现):
// SDK 对 oauth.telegram.org 打开弹窗,回调返回签名 JWT(id_token),
// 由服务端按 JWKS 验签。前置条件:BotFather 已将站点域名设为 bot 的登录域。

const SDK_URL = "https://telegram.org/js/telegram-login.js?4";
const READY_TIMEOUT_MS = 5000;

interface AuthResult {
  id_token?: string;
  error?: string;
}

interface TelegramLoginGlobal {
  auth: (
    opts: { client_id: string | number; lang?: string },
    callback: (result: AuthResult) => void,
  ) => void;
}

export class TelegramAuthCancelled extends Error {
  constructor() {
    super("Telegram login cancelled");
    this.name = "TelegramAuthCancelled";
  }
}

function getTelegramLogin(): TelegramLoginGlobal | undefined {
  return (window as unknown as { Telegram?: { Login?: TelegramLoginGlobal } })
    .Telegram?.Login;
}

let scriptPromise: Promise<TelegramLoginGlobal> | undefined;

function ensureScript(): Promise<TelegramLoginGlobal> {
  const ready = getTelegramLogin();
  if (ready) return Promise.resolve(ready);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TelegramLoginGlobal>((resolve, reject) => {
    const onReady = () => {
      const start = Date.now();
      const tick = () => {
        const tg = getTelegramLogin();
        if (tg) return resolve(tg);
        if (Date.now() - start > READY_TIMEOUT_MS) {
          return reject(new Error("Telegram login SDK did not initialize"));
        }
        setTimeout(tick, 100);
      };
      tick();
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://telegram.org/js/telegram-login.js"]',
    );
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Telegram login SDK failed to load")),
        { once: true },
      );
      if (getTelegramLogin()) onReady();
      return;
    }

    const tag = document.createElement("script");
    tag.src = SDK_URL;
    tag.async = true;
    tag.onload = onReady;
    tag.onerror = () => reject(new Error("Telegram login SDK failed to load"));
    document.head.appendChild(tag);
  }).catch((e: unknown) => {
    scriptPromise = undefined;
    throw e;
  });

  return scriptPromise;
}

/** 打开 Telegram OIDC 弹窗,成功返回 id_token;用户关闭弹窗抛 TelegramAuthCancelled */
export async function requestTelegramIdToken(clientId: string): Promise<string> {
  const tg = await ensureScript();
  return new Promise<string>((resolve, reject) => {
    tg.auth({ client_id: clientId }, (result) => {
      if (result?.error === "popup_closed") return reject(new TelegramAuthCancelled());
      if (!result?.id_token) {
        return reject(
          new Error(
            result?.error
              ? `Telegram login failed: ${result.error}`
              : "Telegram login failed",
          ),
        );
      }
      resolve(result.id_token);
    });
  });
}
