"use client";

import { useState } from "react";
import {
  requestTelegramIdToken,
  TelegramAuthCancelled,
} from "./telegram-login";

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

const ERRORS: Record<string, string> = {
  denied: "该 Telegram 账号不在白名单内,请联系管理员",
  invalid: "登录校验失败,请重试",
  network: "登录失败,请重试",
};

export default function LoginButton({ botId }: { botId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setBusy(true);
    try {
      const idToken = await requestTelegramIdToken(botId);
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: idToken }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      setError(res.status === 403 ? ERRORS.denied : ERRORS.invalid);
      setBusy(false);
    } catch (e) {
      if (!(e instanceof TelegramAuthCancelled)) setError(ERRORS.network);
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-center">
      <button
        onClick={onClick}
        disabled={busy}
        className="flex items-center gap-2.5 rounded-full bg-[#54a9eb] px-8 py-3 text-[15px] font-medium text-white shadow-sm transition-colors hover:bg-[#4498d8] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <TelegramIcon />
        {busy ? "正在跳转 Telegram…" : "使用 Telegram 登录"}
      </button>
      {error && (
        <p className="mt-5 rounded border border-down/40 bg-down/10 px-3 py-1.5 text-xs text-down-ink">
          {error}
        </p>
      )}
    </div>
  );
}
