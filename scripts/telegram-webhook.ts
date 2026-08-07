// 注册/查看/注销 Telegram webhook。审批按钮的回调靠它送达。
//
// 用法:
//   pnpm telegram:webhook            查看当前状态
//   pnpm telegram:webhook set        注册(需 PUBLIC_ORIGIN 与 TELEGRAM_WEBHOOK_SECRET)
//   pnpm telegram:webhook delete     注销
//
// webhook 是 Telegram 主动连我们(经 Cloudflare),方向与出站相反,
// 因此不受 VPS 到 api.telegram.org 那段间断超时的影响。
import { assertEnv } from "../src/env";

assertEnv("worker");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN 未配置");

const api = async (method: string, body?: unknown) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  return res.json();
};

const action = process.argv[2] ?? "info";

if (action === "set") {
  const origin = process.env.PUBLIC_ORIGIN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!origin) throw new Error("PUBLIC_ORIGIN 未配置(如 https://polyorders.bluesignals.cc)");
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET 未配置(openssl rand -hex 16)");

  const url = `${origin.replace(/\/$/, "")}/api/telegram/webhook`;
  console.log(await api("setWebhook", {
    url,
    secret_token: secret,
    // 只要按钮回调,不要普通消息——少收无关更新,也少一类要处理的输入
    allowed_updates: ["callback_query"],
    drop_pending_updates: true,
  }));
  console.log(`已注册: ${url}`);
} else if (action === "delete") {
  console.log(await api("deleteWebhook", { drop_pending_updates: true }));
} else {
  const info = (await api("getWebhookInfo")) as { result?: unknown };
  console.log(JSON.stringify(info.result, null, 2));
}
