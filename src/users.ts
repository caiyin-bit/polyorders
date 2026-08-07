import { query } from "./db";
import { type TelegramUser } from "./auth";

// 用户与角色。交易主体只有一个钱包,所以 role 约束的是「谁能动这一个账户」,
// 而不是「各自的账户」——不做资金隔离。

export type Role = "admin" | "viewer";

export type UserRow = {
  id: number;
  username: string | null;
  first_name: string | null;
  role: Role;
  active: boolean;
  invited_by: number | null;
  created_at: number;
  last_login_at: number | null;
};

/** 环境变量白名单;它始终有效,是防止把自己锁在门外的兜底 */
export function envAllowedIds(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env.TELEGRAM_ALLOWED_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 登录准入判定(纯函数)。
 *
 * 双通道:环境变量白名单 或 库内 active 用户。前者不可被界面操作删除,
 * 这样即便误把所有管理员停用,仍能从环境变量登录回来。
 */
export function loginDecision(
  id: number,
  envIds: string[],
  user: Pick<UserRow, "active" | "role"> | undefined,
): { allow: boolean; role: Role } {
  const inEnv = envIds.includes(String(id));
  if (user) {
    // 环境变量里的人即便被停用也放行,且始终是管理员——兜底通道不能被锁死
    if (inEnv) return { allow: true, role: "admin" };
    return { allow: user.active, role: user.role };
  }
  // 首次登录:在环境变量里就是管理员,否则不予放行(需管理员先邀请)
  return inEnv ? { allow: true, role: "admin" } : { allow: false, role: "viewer" };
}

/** 登录成功后写入/更新用户;返回其最终角色 */
export async function recordLogin(user: TelegramUser): Promise<Role> {
  const envIds = envAllowedIds();
  const { rows } = await query<Pick<UserRow, "active" | "role">>(
    "SELECT active, role FROM users WHERE id = $1",
    [user.id],
  );
  const decision = loginDecision(user.id, envIds, rows[0]);
  if (!decision.allow) throw new Error("not allowed");

  await query(
    `INSERT INTO users (id, username, first_name, role, active, created_at, last_login_at)
     VALUES ($1,$2,$3,$4,TRUE,$5,$5)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       -- 角色以库内为准,不被登录覆盖;但环境变量白名单的人强制为 admin
       role = CASE WHEN $6 THEN 'admin' ELSE users.role END,
       last_login_at = EXCLUDED.last_login_at`,
    [
      user.id,
      user.username ?? null,
      user.first_name ?? null,
      decision.role,
      Date.now(),
      envIds.includes(String(user.id)),
    ],
  );
  return decision.role;
}

/** 当前角色以库为准,不信 cookie——降权要立即生效 */
export async function roleOf(id: number): Promise<Role> {
  if (envAllowedIds().includes(String(id))) return "admin";
  const { rows } = await query<{ role: Role; active: boolean }>(
    "SELECT role, active FROM users WHERE id = $1",
    [id],
  );
  const u = rows[0];
  return u?.active && u.role === "admin" ? "admin" : "viewer";
}

export async function listUsers(): Promise<UserRow[]> {
  const { rows } = await query<UserRow>(
    `SELECT id, username, first_name, role, active, invited_by,
            created_at, last_login_at
     FROM users ORDER BY created_at`,
  );
  return rows;
}

export async function upsertUser(opts: {
  id: number;
  role: Role;
  invitedBy: number;
}): Promise<void> {
  await query(
    `INSERT INTO users (id, role, active, invited_by, created_at)
     VALUES ($1,$2,TRUE,$3,$4)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = TRUE`,
    [opts.id, opts.role, opts.invitedBy, Date.now()],
  );
}

export async function setUserActive(id: number, active: boolean): Promise<void> {
  await query("UPDATE users SET active = $2 WHERE id = $1", [id, active]);
}
