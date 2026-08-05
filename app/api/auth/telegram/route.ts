import { NextResponse } from "next/server";
import {
  createSession,
  DISPLAY_COOKIE,
  isAllowed,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/src/auth";
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
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }
  if (!isAllowed(user.id)) {
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
