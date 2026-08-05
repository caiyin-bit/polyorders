import type { Metadata } from "next";
import TelegramWidget from "./telegram-widget";

export const metadata: Metadata = { title: "登录 · polyorders" };

const ERRORS: Record<string, string> = {
  denied: "该 Telegram 账号不在白名单内,请联系管理员",
  invalid: "登录校验失败,请重试",
  config: "服务端未配置登录参数",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const bot = process.env.TELEGRAM_BOT_USERNAME ?? "";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col items-center">
        <h1 className="font-mono text-5xl font-bold tracking-tight">
          POLY<span className="text-accent">ORDERS</span>
        </h1>
        <p className="mt-3 text-sm text-mut">Polymarket 高胜率地址筛选终端</p>

        <div className="mt-14 flex w-full flex-col items-center">
          {bot ? (
            <TelegramWidget bot={bot} />
          ) : (
            <p className="text-sm text-down-ink">{ERRORS.config}</p>
          )}
          {error && ERRORS[error] && (
            <p className="mt-5 rounded border border-down/40 bg-down/10 px-3 py-1.5 text-xs text-down-ink">
              {ERRORS[error]}
            </p>
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
