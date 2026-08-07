import { NextResponse } from "next/server";
import {
  createSession,
  DISPLAY_COOKIE,
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
    console.warn(`auth: 用户 ${user.id} 不在允许名单内`);
    return NextResponse.json({ error: "denied" }, { status: 403 });
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
