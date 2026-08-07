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
  // 记住原路径,登录后跳回。Agent 认领链接是从 agent 那里拿到的,
  // 用户多半在未登录状态下直接点开,不跳回就断在首页了。
  if (req.nextUrl.pathname !== "/") {
    url.searchParams.set("next", req.nextUrl.pathname);
  }
  return NextResponse.redirect(url);
}

// 除登录页、认证回调、Agent 接入入口、站点图标、Next 静态资源外全部需要登录。
//
// SKILL.md 与 api/agent/ 必须免登录:agent 此时还没有(register)或不该有
// (SKILL.md)会话 cookie;api/agent/ 的鉴权改由各路由内的 requireAgent 负责,
// 因为 middleware 跑在 Edge,访问不了 Postgres。
//
// 注意 `api/agent/` 的尾斜杠不可省:写成 `api/agent` 会前缀匹配到人类用的
// `/api/agents`(agent 管理接口),把认领与授权也一并放行掉。
// access 与 api/access 靠「待审凭证」自行把关(见 app/api/access/route.ts),
// api/telegram/ 是 Telegram 主动回调,靠 secret 头自证,都不能要求正式会话。
//
// 注意 `api/agent/` 与 `api/telegram/` 的尾斜杠不可省:写成 `api/agent`
// 会前缀匹配到人类用的 `api/agents`,把认领与授权也一并放行掉。
export const config = {
  matcher: [
    "/((?!login|access|api/auth|api/access|api/agent/|api/telegram/|SKILL\\.md|_next/static|_next/image|icon.svg|apple-icon|favicon.ico).*)",
  ],
};
