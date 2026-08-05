import { NextResponse } from "next/server";
import {
  createSession,
  DISPLAY_COOKIE,
  isAllowed,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifyTelegramAuth,
} from "@/src/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.redirect(new URL("/login?error=config", req.url));
  }

  const user = await verifyTelegramAuth(url.searchParams, botToken);
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=invalid", req.url));
  }
  if (!isAllowed(user.id)) {
    return NextResponse.redirect(new URL("/login?error=denied", req.url));
  }

  const res = NextResponse.redirect(new URL("/", req.url));
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE, await createSession(user), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  // 仅供页头展示用户名,不参与鉴权
  res.cookies.set(DISPLAY_COOKIE, user.username ?? user.first_name ?? String(user.id), {
    httpOnly: false,
    secure,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
