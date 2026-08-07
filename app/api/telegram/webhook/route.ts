import { approve, parseCallback, reject } from "@/src/access";
import { envAllowedIds, roleOf } from "@/src/users";

export const dynamic = "force-dynamic";

// Telegram 审批按钮的回调入口。这个端点完全公开(Telegram 主动来调),
// 因此三重校验缺一不可:
//   1. secret_token 头 —— setWebhook 时约定,不匹配直接丢弃
//   2. 点按钮的人必须是管理员 —— 否则任何人给 bot 发消息都能批准自己
//   3. 申请必须处于可决状态 —— 防重放
//
// 注意:一律返回 200。Telegram 对非 2xx 会不断重投,而这里的失败大多是
// 「不该处理的消息」,重投没有意义。

type Callback = {
  id: string;
  from?: { id?: number };
  data?: string;
  message?: { chat?: { id?: number } };
};

async function answer(callbackId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(`webhook: 回执失败 ${String(err)}`);
  }
}

async function isAdmin(id: number | undefined): Promise<boolean> {
  if (!id) return false;
  if (envAllowedIds().includes(String(id))) return true;
  return (await roleOf(id)) === "admin";
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (
    !secret ||
    req.headers.get("x-telegram-bot-api-secret-token") !== secret
  ) {
    console.warn("webhook: secret 校验未通过,已丢弃");
    return Response.json({ ok: true });
  }

  const update = (await req.json().catch(() => ({}))) as {
    callback_query?: Callback;
  };
  const cb = update.callback_query;
  if (!cb) return Response.json({ ok: true }); // 非按钮消息,忽略

  const parsed = parseCallback(cb.data);
  if (!parsed) {
    await answer(cb.id, "无法识别的操作");
    return Response.json({ ok: true });
  }

  if (!(await isAdmin(cb.from?.id))) {
    console.warn(`webhook: 非管理员 ${cb.from?.id} 尝试审批`);
    await answer(cb.id, "你没有审批权限");
    return Response.json({ ok: true });
  }

  if (parsed.action === "reject") {
    const done = await reject(parsed.id, cb.from!.id!);
    await answer(cb.id, done ? "已拒绝该申请" : "该申请已被处理过");
    return Response.json({ ok: true });
  }

  const code = await approve(parsed.id, cb.from!.id!);
  if (!code) {
    await answer(cb.id, "该申请已被处理过");
    return Response.json({ ok: true });
  }
  // 门禁码只在这一刻可见(库里只存哈希),所以用 alert 弹窗给管理员,
  // 便于复制转交;30 分钟内有效
  await answer(cb.id, `已批准。门禁码:${code}\n30 分钟内有效,请转交对方。`);
  return Response.json({ ok: true });
}
