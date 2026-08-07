// Telegram 告警发送。原本 rtds.ts 与 run-fetch.sh 各写了一份,这里统一。
//
// 一律不抛错:告警是旁路,推送失败不该影响主流程(尤其不能让一笔已经成交的
// 订单因为通知发不出去而走进错误分支)。

const TIMEOUT_MS = 10_000;

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

/**
 * 未配置 bot 或接收者时静默跳过,返回 false。
 *
 * 返回值务必检查:实测 VPS 到 api.telegram.org 有约 17% 的间断超时,
 * 把「没发出去」当成「已发出」会让人干等一条永远不会到的消息。
 */
export async function sendAlert(
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    // HTTP 200 不代表 Telegram 接受了,它会用 ok:false 表达业务错误
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (!res.ok || body?.ok === false) {
      console.error(`Telegram 推送被拒: ${res.status} ${JSON.stringify(body)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Telegram 推送失败: ${String(err)}`);
    return false;
  }
}
