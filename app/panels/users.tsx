"use client";

import { fmtAgo } from "@/app/lib/format";
import { useCallback, useEffect, useState } from "react";

/* ---------- 用户与权限面板 ---------- */

type UserRow = {
  id: number;
  username: string | null;
  first_name: string | null;
  role: "admin" | "viewer";
  active: boolean;
  created_at: number;
  last_login_at: number | null;
};

type AccessReq = {
  id: number;
  telegram_id: number;
  username: string | null;
  code: string | null;
  code_expires_at: number | null;
};
type AccessView = { pending: AccessReq[]; active: AccessReq[] };

export function UsersPanel() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [me, setMe] = useState<{ id: number; role: string } | null>(null);
  const [envAdmins, setEnvAdmins] = useState<string[]>([]);
  const [access, setAccess] = useState<AccessView | null>(null);
  const [newId, setNewId] = useState("");
  const [newRole, setNewRole] = useState<"viewer" | "admin">("viewer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      const data = (await res.json()) as {
        users: UserRow[];
        me: { id: number; role: string };
        envAdmins: string[];
        access: AccessView | null;
      };
      setUsers(data.users ?? []);
      setMe(data.me ?? null);
      setEnvAdmins(data.envAdmins ?? []);
      setAccess(data.access ?? null);
    } catch {
      /* 面板不可用不影响主看板 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function mutate(method: "POST" | "DELETE", body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        users?: UserRow[];
        access?: AccessView;
      };
      if (!res.ok) setError(data.error ?? "操作失败");
      else {
        if (data.users) setUsers(data.users);
        if (data.access) setAccess(data.access);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = me?.role === "admin";

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink2">
          用户与权限
          <span className="ml-2 font-mono text-[10px] text-mut">
            {users.filter((u) => u.active).length} 人
          </span>
        </h2>
        {me && (
          <span className="text-[10px] text-mut">
            当前:{me.role === "admin" ? "管理员" : "只读"}
          </span>
        )}
      </div>

      {users.length === 0 ? (
        <p className="text-[11px] leading-4 text-mut">暂无记录。</p>
      ) : (
        <ul className="space-y-1.5">
          {users.map((u) => {
            // 环境变量里的管理员不能在界面停用——那是防锁死的兜底通道
            const fromEnv = envAdmins.includes(String(u.id));
            const isMe = u.id === me?.id;
            return (
              <li
                key={u.id}
                className={`rounded border border-line bg-panel2 px-2 py-1.5 text-[11px] ${
                  u.active ? "" : "opacity-50"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate">
                    {u.username ? `@${u.username}` : (u.first_name ?? u.id)}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1 text-[10px] ${
                      u.role === "admin"
                        ? "bg-accent/15 text-accent"
                        : "bg-panel text-mut"
                    }`}
                  >
                    {u.role === "admin" ? "管理员" : "只读"}
                  </span>
                  {fromEnv && (
                    <span
                      className="shrink-0 rounded bg-panel px-1 text-[10px] text-mut"
                      title="来自环境变量白名单,界面无法停用(防锁死的兜底通道)"
                    >
                      内置
                    </span>
                  )}
                  {isMe && <span className="shrink-0 text-[10px] text-mut">你</span>}
                  {isAdmin && !fromEnv && !isMe && (
                    <span className="ml-auto flex shrink-0 gap-2">
                      {/* 只提供降权,不提供提权:管理员只应有一个人,
                          列表里一次误点就多一个能下单的账号 */}
                      {u.role === "admin" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            mutate("POST", { id: u.id, role: "viewer" })
                          }
                          className="text-mut hover:text-ink2 hover:underline disabled:opacity-40"
                        >
                          降为只读
                        </button>
                      )}
                      {u.active && (
                        <button
                          disabled={busy}
                          onClick={() => mutate("DELETE", { id: u.id })}
                          className="text-bad-ink hover:underline disabled:opacity-40"
                        >
                          停用
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-baseline gap-2 text-[10px] text-mut">
                  <span className="font-mono">{u.id}</span>
                  <span className="ml-auto">
                    {u.last_login_at
                      ? `登录 ${fmtAgo(u.last_login_at)}`
                      : "从未登录"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 访问申请。门禁码在这里明文可见——它是不依赖 Telegram 的兜底通道,
          Telegram 那两条(按钮弹窗、独立消息)都是出站调用,会间断超时 */}
      {isAdmin && (access?.pending.length || access?.active.length) ? (
        <div className="mt-3 space-y-1.5 border-t border-line pt-3">
          <h3 className="text-[11px] text-ink2">访问申请</h3>
          {access?.pending.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-1.5 rounded border border-line bg-panel2 px-2 py-1.5 text-[11px]"
            >
              <span className="min-w-0 truncate">
                {r.username ?? r.telegram_id}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-mut">
                {r.telegram_id}
              </span>
              <span className="ml-auto flex shrink-0 gap-2">
                <button
                  disabled={busy}
                  onClick={() =>
                    mutate("POST", { action: "approve", requestId: r.id })
                  }
                  className="text-accent hover:underline disabled:opacity-40"
                >
                  批准
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    mutate("POST", { action: "reject", requestId: r.id })
                  }
                  className="text-bad-ink hover:underline disabled:opacity-40"
                >
                  拒绝
                </button>
              </span>
            </div>
          ))}
          {access?.active.map((r) => (
            <div
              key={r.id}
              className="rounded border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11px]"
            >
              <div className="flex items-baseline gap-1.5">
                <span className="min-w-0 truncate text-mut">
                  {r.username ?? r.telegram_id} 的门禁码
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-mut">
                  {Math.max(
                    0,
                    Math.round(((r.code_expires_at ?? 0) - Date.now()) / 60_000),
                  )}{" "}
                  分钟后过期
                </span>
              </div>
              <div
                className="mt-0.5 cursor-pointer select-all font-mono text-base tracking-[0.2em] text-accent"
                title="点击选中后复制,转交给申请人"
              >
                {r.code}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {isAdmin && (
        <div className="mt-3 space-y-1.5 border-t border-line pt-3">
          <p className="text-[10px] leading-4 text-mut">
            加入后对方即可用 Telegram 登录。只读账号能看全部数据,但不能下单、
            撤单、改关注池或管理用户。
          </p>
          <div className="flex gap-1">
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              inputMode="numeric"
              placeholder="Telegram 数字 ID"
              className="min-w-0 flex-1 rounded border border-line bg-panel2 px-2 py-1 text-xs placeholder-mut focus:border-accent focus:outline-none"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "viewer" | "admin")}
              className="shrink-0 rounded border border-line bg-panel2 px-1 text-[11px]"
            >
              <option value="viewer">只读</option>
              <option value="admin">管理员</option>
            </select>
            <button
              disabled={busy || !newId.trim()}
              onClick={async () => {
                await mutate("POST", { id: Number(newId), role: newRole });
                setNewId("");
              }}
              className="shrink-0 rounded bg-accent px-2 py-1 text-[11px] text-white disabled:opacity-40"
            >
              添加
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-bad-ink">{error}</p>}
    </section>
  );
}
