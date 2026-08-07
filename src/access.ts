import { query } from "./db";
import { sendAlert } from "./telegram";
import { upsertUser } from "./users";

// 门禁码申请。判定逻辑全做成纯函数,便于测试——这条链路上任何一处放松
// 都等于给系统开了一道无人看守的门。

/** 去掉易混字符(0/O、1/l/I),口头转述与手抄都不容易出错 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 8;
export const CODE_TTL_MS = 30 * 60_000;
export const MAX_ATTEMPTS = 5;
/** 被拒后的冷却期,防止反复申请把管理员的 Telegram 刷屏 */
export const REJECT_COOLDOWN_MS = 60 * 60_000;

export type AccessStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "used"
  | "expired";

export type AccessRequest = {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  status: AccessStatus;
  code_hash: string | null;
  code_expires_at: number | null;
  attempts: number;
  requested_at: number;
  decided_at: number | null;
};

export function generateCode(): string {
  const buf = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code.trim().toUpperCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 能否发起新申请;可以返回 null,否则返回中文原因。
 * 传入该用户最近一条申请(没有则 undefined)。
 */
export function canRequest(
  last: Pick<AccessRequest, "status" | "decided_at" | "code_expires_at"> | undefined,
  now: number,
): string | null {
  if (!last) return null;
  if (last.status === "pending") return "你已有一条待审申请,请等待管理员处理";
  if (last.status === "used") return "该账号已获授权,请直接登录";
  if (last.status === "approved" && (last.code_expires_at ?? 0) > now) {
    return "已批准,请输入管理员给你的门禁码";
  }
  if (last.status === "rejected") {
    const wait = (last.decided_at ?? 0) + REJECT_COOLDOWN_MS - now;
    if (wait > 0) {
      return `申请已被拒绝,请 ${Math.ceil(wait / 60_000)} 分钟后再试`;
    }
  }
  return null;
}

/**
 * 门禁码能否校验;可以返回 null,否则返回中文原因。
 *
 * 注意顺序:先判状态与时效,再判次数。这样即便有人拿到过期码狂试,
 * 也不会把 attempts 耗尽而影响后续正常流程。
 */
export function canVerify(
  req: Pick<AccessRequest, "status" | "code_expires_at" | "attempts"> | undefined,
  now: number,
): string | null {
  if (!req) return "没有找到你的申请记录,请先提交申请";
  if (req.status === "used") return "该门禁码已被使用";
  if (req.status === "rejected") return "申请已被拒绝";
  if (req.status !== "approved") return "申请尚未通过审批";
  if ((req.code_expires_at ?? 0) <= now) return "门禁码已过期,请重新申请";
  if (req.attempts >= MAX_ATTEMPTS) return "输错次数过多,请重新申请";
  return null;
}

/** 解析审批按钮的 callback_data */
export function parseCallback(
  data: string | undefined,
): { action: "approve" | "reject"; id: number } | null {
  const m = /^(approve|reject):(\d+)$/.exec(data ?? "");
  if (!m) return null;
  return { action: m[1] as "approve" | "reject", id: Number(m[2]) };
}

// ── 数据库操作 ──────────────────────────────────────────

export async function lastRequestOf(
  telegramId: number,
): Promise<AccessRequest | undefined> {
  const { rows } = await query<AccessRequest>(
    `SELECT * FROM access_requests WHERE telegram_id = $1
     ORDER BY requested_at DESC LIMIT 1`,
    [telegramId],
  );
  return rows[0];
}

export async function createRequest(user: {
  id: number;
  name: string;
}): Promise<AccessRequest> {
  const { rows } = await query<AccessRequest>(
    `INSERT INTO access_requests (telegram_id, username, requested_at)
     VALUES ($1,$2,$3) RETURNING *`,
    [user.id, user.name, Date.now()],
  );
  return rows[0];
}

/**
 * 通知管理员。带审批按钮,点一下即可决定——比解析文字回复可靠,
 * 也不会因为回错一条消息而误批。
 *
 * 返回是否送达:实测 VPS 到 api.telegram.org 有约 17% 的间断超时,
 * 送不到时必须如实告诉申请人,不能让人干等一条永远不会到的消息。
 */
export async function notifyAdmin(req: AccessRequest): Promise<boolean> {
  return sendAlert(
    `🔐 访问申请\n${req.username ?? req.telegram_id}(ID ${req.telegram_id})\n` +
      `批准后我会把门禁码发给你,由你转交对方。`,
    {
      inline_keyboard: [
        [
          { text: "✅ 批准", callback_data: `approve:${req.id}` },
          { text: "❌ 拒绝", callback_data: `reject:${req.id}` },
        ],
      ],
    },
  );
}

/** 批准并生成门禁码;返回明文码,仅此一次可见 */
export async function approve(id: number, by: number): Promise<string | null> {
  const code = generateCode();
  const { rowCount } = await query(
    `UPDATE access_requests
     SET status = 'approved', code_hash = $2, code_expires_at = $3,
         attempts = 0, decided_at = $4, decided_by = $5
     WHERE id = $1 AND status IN ('pending', 'approved')`,
    [id, await hashCode(code), Date.now() + CODE_TTL_MS, Date.now(), by],
  );
  return rowCount ? code : null;
}

export async function reject(id: number, by: number): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE access_requests
     SET status = 'rejected', code_hash = NULL, decided_at = $2, decided_by = $3
     WHERE id = $1 AND status = 'pending'`,
    [id, Date.now(), by],
  );
  return Boolean(rowCount);
}

/** 校验门禁码;成功则建号并返回 true */
export async function redeem(
  telegramId: number,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const req = await lastRequestOf(telegramId);
  const blocked = canVerify(req, Date.now());
  if (blocked) return { ok: false, error: blocked };

  if (req!.code_hash !== (await hashCode(code))) {
    await query(
      "UPDATE access_requests SET attempts = attempts + 1 WHERE id = $1",
      [req!.id],
    );
    const left = MAX_ATTEMPTS - req!.attempts - 1;
    return {
      ok: false,
      error: left > 0 ? `门禁码不正确,还可尝试 ${left} 次` : "输错次数过多,请重新申请",
    };
  }

  await upsertUser({
    id: telegramId,
    role: "viewer",
    invitedBy: req!.telegram_id,
  });
  await query(
    "UPDATE access_requests SET status = 'used', used_at = $2 WHERE id = $1",
    [req!.id, Date.now()],
  );
  return { ok: true };
}
