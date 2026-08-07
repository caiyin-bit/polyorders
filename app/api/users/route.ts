import { adminView, approve, reject } from "@/src/access";
import { currentUser, requireAdmin } from "@/src/session";
import {
  envAllowedIds,
  listUsers,
  setUserActive,
  upsertUser,
  type Role,
} from "@/src/users";

export const dynamic = "force-dynamic";

// 用户管理。只读账号能看到名单(知道谁有权限也是一种透明),但改动限管理员。

export async function GET() {
  const me = await currentUser();
  if (!me) return Response.json({ error: "未登录" }, { status: 401 });
  // 门禁码只给管理员看:它是一把 30 分钟的钥匙,没必要对只读账号可见
  const access = me.role === "admin" ? await adminView() : null;
  return Response.json({
    users: await listUsers(),
    me: { id: me.id, role: me.role },
    // 环境变量里的 ID 无法在界面停用,标出来免得管理员白费力气
    envAdmins: envAllowedIds(),
    access,
  });
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("denied" in guard) return guard.denied;

  let body: {
    id?: unknown;
    role?: unknown;
    action?: string;
    requestId?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {}

  // 网页上直接审批访问申请:Telegram 完全不通时的兜底路径
  if (body.action === "approve" || body.action === "reject") {
    const reqId = Number(body.requestId);
    if (!Number.isInteger(reqId)) {
      return Response.json({ error: "缺少申请 id" }, { status: 400 });
    }
    if (body.action === "reject") {
      await reject(reqId, guard.user.id);
    } else {
      await approve(reqId, guard.user.id);
    }
    return Response.json({ ok: true, access: await adminView() });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Telegram 数字 ID 不合法" }, { status: 400 });
  }
  const role: Role = body.role === "admin" ? "admin" : "viewer";

  await upsertUser({ id, role, invitedBy: guard.user.id });
  return Response.json({ ok: true, users: await listUsers(), access: await adminView() });
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin();
  if ("denied" in guard) return guard.denied;

  let id: unknown;
  try {
    id = ((await req.json()) as { id?: unknown }).id;
  } catch {}
  if (!Number.isInteger(Number(id))) {
    return Response.json({ error: "缺少用户 id" }, { status: 400 });
  }
  if (Number(id) === guard.user.id) {
    return Response.json({ error: "不能停用自己" }, { status: 400 });
  }

  await setUserActive(Number(id), false);
  return Response.json({ ok: true, users: await listUsers() });
}
