// Telegram 告警发送。原本 rtds.ts 与 run-fetch.sh 各写了一份,这里统一。
//
// 一律不抛错:告警是旁路,推送失败不该影响主流程(尤其不能让一笔已经成交的
// 订单因为通知发不出去而走进错误分支)。

const TIMEOUT_MS = 10_000;

/** 未配置 bot 或接收者时静默跳过,返回 false */
export async function sendAlert(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return true;
  } catch (err) {
    console.error(`Telegram 推送失败: ${String(err)}`);
    return false;
  }
}
