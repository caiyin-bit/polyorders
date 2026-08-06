import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/src/auth";

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (session) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

// 除登录页、认证回调、站点图标、Next 静态资源外全部需要登录
// (图标需在登录页也能加载)
export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|icon.svg|apple-icon|favicon.ico).*)",
  ],
};
