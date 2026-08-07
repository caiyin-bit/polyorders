import { NextResponse } from "next/server";
import { DISPLAY_COOKIE, SESSION_COOKIE, PENDING_COOKIE } from "@/src/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  // 用相对 Location 而不是 new URL("/login", req.url):线上经 Caddy 反代,
  // req.url 是容器内的 http://localhost:3000,拼出来的绝对地址会把用户
  // 送到本机。相对路径由浏览器按当前站点解析,不存在取错 origin 的可能。
  const res = new NextResponse(null, {
    status: 303,
    headers: { location: "/login" },
  });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(DISPLAY_COOKIE);
  // 待审凭证一并清掉,否则退出后再登录会撞上上一轮的申请状态
  res.cookies.delete(PENDING_COOKIE);
  return res;
}
