import { NextResponse } from "next/server";
import {
  createPendingToken,
  createSession,
  DISPLAY_COOKIE,
  PENDING_COOKIE,
  PENDING_MAX_AGE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/src/auth";
import { recordLogin } from "@/src/users";
import { verifyTelegramIdToken } from "@/src/telegram-oidc";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let idToken = "";
  try {
    const body = (await req.json()) as { id_token?: string };
    idToken = String(body.id_token ?? "");
  } catch {}
  if (!idToken) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const user = await verifyTelegramIdToken(idToken);
  if (!user) {
    // 具体原因由 verifyTelegramIdToken 打日志;这里只标明走到了哪一步
    console.warn("auth: id_token 验签未通过");
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }
  // 准入改由 recordLogin 判定:环境变量白名单 或 库内 active 用户。
  // 它同时把用户落库并返回角色,登录与用户维护是同一件事的两面。
  try {
    await recordLogin(user);
  } catch {
    // 身份是真的,只是还没权限。发一张待审凭证让他去走门禁码流程,
    // 而不是直接拒之门外——这张凭证不带任何权限,只用于 /access 页面
    console.warn(`auth: 用户 ${user.id} 尚无权限,转入门禁码申请`);
    const res = NextResponse.json({ pending: true }, { status: 403 });
    res.cookies.set(PENDING_COOKIE, await createPendingToken(user), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: PENDING_MAX_AGE,
      path: "/",
    });
    return res;
  }

  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE, await createSession(user), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  // 仅供页头展示用户名,不参与鉴权
  res.cookies.set(
    DISPLAY_COOKIE,
    user.username ?? user.first_name ?? String(user.id),
    {
      httpOnly: false,
      secure,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    },
  );
  return res;
}
