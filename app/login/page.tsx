import type { Metadata } from "next";
import { telegramBotId } from "@/src/auth";
import LoginButton from "./login-button";

export const metadata: Metadata = { title: "登录 · polyorders" };

export default function LoginPage() {
  let botId = "";
  try {
    botId = telegramBotId();
  } catch {}

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col items-center">
        <h1 className="font-mono text-5xl font-bold tracking-tight">
          POLY<span className="text-accent">ORDERS</span>
        </h1>
        <p className="mt-3 text-sm text-mut">Polymarket 高胜率地址筛选终端</p>

        <div className="mt-14 flex w-full flex-col items-center">
          {botId ? (
            <LoginButton botId={botId} />
          ) : (
            <p className="text-sm text-down-ink">服务端未配置登录参数</p>
          )}
          <p className="mt-6 text-xs text-mut">
            仅限白名单账号访问,无法登录请联系管理员
          </p>
        </div>
      </div>

      <footer className="absolute bottom-6 text-[11px] text-mut/70">
        polyorders · 数据每日自动更新
      </footer>
    </main>
  );
}
