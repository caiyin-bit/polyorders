import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./auth";
import { roleOf, type Role } from "./users";

// 路由内的登录态与角色。middleware 只负责「有没有登录」(它跑在 Edge,
// 访问不了数据库);「能不能改」一律在这里按库内角色判定。

export type Session = { id: number; name: string; role: Role };

export async function currentUser(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await verifySession(token);
  if (!s) return null;
  // 角色不从 cookie 读:cookie 签发时的角色可能已被改动,
  // 降权必须立即生效而不是等下次登录
  return { ...s, role: await roleOf(s.id) };
}

/** 写操作守卫。返回 Response 表示已被拒绝,调用方直接 return 它 */
export async function requireAdmin(): Promise<
  { user: Session } | { denied: Response }
> {
  const user = await currentUser();
  if (!user) {
    return { denied: Response.json({ error: "未登录" }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return {
      denied: Response.json(
        { error: "只读账号无权执行该操作,请联系管理员提升权限" },
        { status: 403 },
      ),
    };
  }
  return { user };
}
