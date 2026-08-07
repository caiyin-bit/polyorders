import { cookies } from "next/headers";
import {
  canRequest,
  createRequest,
  lastRequestOf,
  notifyAdmin,
  redeem,
} from "@/src/access";
import {
  createSession,
  DISPLAY_COOKIE,
  PENDING_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifyPendingToken,
} from "@/src/auth";

export const dynamic = "force-dynamic";

// 门禁码流程的两个动作:提交申请、校验门禁码。
// 均以「待审凭证」为身份依据——它证明 Telegram 验签过了,但不带任何权限。

async function pendingUser() {
  const token = (await cookies()).get(PENDING_COOKIE)?.value;
  return token ? verifyPendingToken(token) : null;
}

/** 当前申请状态,供页面决定显示哪一步 */
export async function GET() {
  const me = await pendingUser();
  if (!me) return Response.json({ error: "凭证已过期,请重新登录" }, { status: 401 });
  const last = await lastRequestOf(me.id);
  return Response.json({
    me,
    status: last?.status ?? null,
    // 只有已批准且未过期时才该显示输码框
    awaitingCode:
      last?.status === "approved" && (last.code_expires_at ?? 0) > Date.now(),
  });
}

export async function POST(req: Request) {
  const me = await pendingUser();
  if (!me) return Response.json({ error: "凭证已过期,请重新登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    code?: string;
  };

  // ── 提交申请 ──
  if (body.action === "request") {
    const blocked = canRequest(await lastRequestOf(me.id), Date.now());
    if (blocked) return Response.json({ error: blocked }, { status: 409 });

    // 先落库再通知:即便消息没送到,管理员仍能在界面上看到这条待审申请
    const created = await createRequest(me);
    const delivered = await notifyAdmin(created);
    return Response.json({
      ok: true,
      delivered,
      message: delivered
        ? "申请已发送给管理员,请等待对方把门禁码给你"
        : "申请已记录,但通知未能送达管理员,请另行联系对方",
    });
  }

  // ── 校验门禁码 ──
  if (body.action === "verify") {
    const code = String(body.code ?? "").trim();
    if (!code) return Response.json({ error: "请输入门禁码" }, { status: 400 });

    const result = await redeem(me.id, code);
    if (!result.ok) return Response.json({ error: result.error }, { status: 403 });

    // 通过:换发正式会话,并清掉待审凭证
    const res = Response.json({ ok: true });
    const secure = process.env.NODE_ENV === "production";
    res.headers.append(
      "set-cookie",
      `${SESSION_COOKIE}=${await createSession({ id: me.id, username: me.name })}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`,
    );
    res.headers.append(
      "set-cookie",
      `${DISPLAY_COOKIE}=${encodeURIComponent(me.name)}; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`,
    );
    res.headers.append("set-cookie", `${PENDING_COOKIE}=; Path=/; Max-Age=0`);
    return res;
  }

  return Response.json({ error: "未知操作" }, { status: 400 });
}
