"use client";

import { useCallback, useEffect, useState } from "react";

type State = {
  me?: { id: number; name: string };
  status: string | null;
  awaitingCode: boolean;
};

export default function AccessForm() {
  const [state, setState] = useState<State | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/access");
      if (res.status === 401) {
        setError("登录凭证已过期,请回到登录页重新用 Telegram 登录");
        return;
      }
      setState((await res.json()) as State);
    } catch {
      setError("网络异常,请稍后重试");
    }
  }, []);

  // 待审期间轮询:管理员在 Telegram 上批准后,这一页要自己切换到输码框,
  // 否则申请人对着「等待审批」干等,不知道该刷新
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function act(action: "request" | "verify") {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, code }),
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        ok?: boolean;
      };
      if (!res.ok) setError(data.error ?? "操作失败");
      else if (action === "verify" && data.ok) {
        // 已换发正式会话,整页跳转让服务端重新按新身份渲染
        window.location.href = "/";
        return;
      } else {
        setMsg(data.message ?? "已提交");
        await load();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const awaiting = state?.awaitingCode || state?.status === "approved";

  return (
    <div className="mt-8 rounded-lg border border-line bg-panel p-5">
      <h2 className="text-sm font-medium">需要访问授权</h2>
      <p className="mt-2 text-xs leading-5 text-mut">
        {state?.me ? (
          <>
            已通过 Telegram 验证为{" "}
            <span className="font-mono text-ink2">{state.me.name}</span>,
            但这个账号还没有访问权限。
          </>
        ) : (
          "正在读取状态…"
        )}
      </p>

      {awaiting ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs leading-5 text-ink2">
            申请已通过。请输入管理员给你的门禁码:
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="8 位门禁码"
            maxLength={8}
            autoCapitalize="characters"
            className="w-full rounded border border-line bg-panel2 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] placeholder-mut placeholder:tracking-normal placeholder:text-sm focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => act("verify")}
            disabled={busy || code.length < 4}
            className="w-full rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            {busy ? "校验中…" : "进入"}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <button
            onClick={() => act("request")}
            disabled={busy || state?.status === "pending"}
            className="w-full rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            {state?.status === "pending"
              ? "已提交,等待管理员审批"
              : busy
                ? "提交中…"
                : "申请访问"}
          </button>
          <p className="mt-3 text-[11px] leading-4 text-mut">
            提交后管理员会在 Telegram 上收到通知。通过后他会拿到一组门禁码,
            由他转交给你,你在此输入即可以只读身份查看数据。
          </p>
        </div>
      )}

      {msg && <p className="mt-3 text-[11px] leading-4 text-ok-ink">{msg}</p>}
      {error && <p className="mt-3 text-[11px] leading-4 text-bad-ink">{error}</p>}

      <a
        href="/login"
        className="mt-4 block text-center text-[11px] text-mut hover:text-ink2"
      >
        返回登录页
      </a>
    </div>
  );
}
