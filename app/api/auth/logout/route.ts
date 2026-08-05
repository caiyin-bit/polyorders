import { NextResponse } from "next/server";
import { DISPLAY_COOKIE, SESSION_COOKIE } from "@/src/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(DISPLAY_COOKIE);
  return res;
}
