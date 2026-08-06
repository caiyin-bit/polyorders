"use client";

import { fmtTime } from "@/app/lib/format";
import { useCallback, useEffect, useState } from "react";

/* ---------- Agent 接入面板 ---------- */

type AgentRow = {
  id: number;
  name: string;
  model: string | null;
  description: string | null;
  key_prefix: string;
  scopes: string[];
  last_seen_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

function AgentOnboardModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  // 用当前站点 origin,本地开发与线上各自指向自己
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const prompt = `这是我想让你接入的交易终端。阅读 ${origin}/SKILL.md 并按照说明接入 polyorders。如果过程中遇到安全风险,请与我逐一确认。`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时用户可手动选中复制 */
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative w-[94vw] max-w-lg rounded-lg border border-line bg-panel p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-mut hover:text-ink"
          aria-label="关闭"
        >
          ✕
        </button>

        <h2 className="text-center text-lg font-semibold">把你的 Agent 接入进来</h2>
        <p className="mt-2 text-center text-xs text-mut">
          注册由 Agent 自主完成,你只需转交指令并在最后确认
        </p>

        <div className="mt-5 rounded border border-line bg-panel2 p-3">
          <p className="mb-2 text-[11px] text-mut">把这段发给你的 Agent:</p>
          <div className="flex items-start gap-2">
            <p className="flex-1 rounded border border-line bg-panel p-2 text-xs leading-5">
              {prompt}
            </p>
            <button
              onClick={copy}
              className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs text-white"
            >
              {copied ? "已复制" : "复制"}
            </button>
          </div>

          <ol className="mt-4 space-y-2 border-t border-line pt-3 text-xs">
            <li className="flex gap-2">
              <span className="font-mono text-mut">1.</span>
              把以上指令发给你的 Agent
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-mut">2.</span>
              Agent 返回你的专属认领链接
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-mut">3.</span>
              打开链接,确认认领
            </li>
          </ol>
        </div>

        <p className="mt-4 text-[11px] leading-4 text-mut">
          认领前 Agent 拿不到任何权限;下单需要认领后另行授予,且同样受
          dry-run 开关与限额约束。
        </p>
      </div>
    </div>
  );
}

export function AgentPanel() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = (await res.json()) as { agents: AgentRow[] };
      setAgents(data.agents);
    } catch {
      /* 面板不可用不影响主看板 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: number, body: Record<string, unknown>) {
    await fetch("/api/agents", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    await load();
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink2">Agent 接入</h2>
        <button
          onClick={() => setShowModal(true)}
          className="rounded bg-accent px-2 py-1 text-[11px] text-white"
        >
          接入新 Agent
        </button>
      </div>

      {agents.length === 0 ? (
        <p className="text-[11px] leading-4 text-mut">
          还没有已认领的 Agent。点右上角生成接入指令。
        </p>
      ) : (
        <ul className="space-y-2">
          {agents.map((a) => {
            const revoked = a.revoked_at !== null;
            // 逐项增删,不整体替换——否则勾一个会把另一个权限清掉
            const toggleScope = (scope: string) =>
              patch(a.id, {
                scopes: a.scopes.includes(scope)
                  ? a.scopes.filter((s) => s !== scope)
                  : [...a.scopes, scope],
              });
            return (
              <li
                key={a.id}
                className="rounded border border-line bg-panel2 p-2 text-[11px]"
              >
                <div className="space-y-0.5">
                  <span
                    className={`block whitespace-nowrap font-medium ${
                      revoked ? "text-mut line-through" : ""
                    }`}
                  >
                    {a.name}
                  </span>
                  {a.model && <span className="block text-mut">{a.model}</span>}
                  <span className="block font-mono text-mut">{a.key_prefix}…</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-mut">
                  <span>
                    活跃 {a.last_seen_at ? fmtTime(a.last_seen_at) : "从未"}
                  </span>
                  <label
                    className="ml-auto flex items-center gap-1"
                    title="允许改动实时关注池;它决定跟单引擎盯哪些地址"
                  >
                    <input
                      type="checkbox"
                      checked={a.scopes.includes("watch")}
                      onChange={() => toggleScope("watch")}
                    />
                    关注池
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={a.scopes.includes("trade")}
                      onChange={() => toggleScope("trade")}
                    />
                    下单权限
                  </label>
                  <button
                    onClick={() => patch(a.id, { revoked: !revoked })}
                    className="text-down-ink hover:underline"
                  >
                    {revoked ? "恢复" : "撤销"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showModal && <AgentOnboardModal onClose={() => setShowModal(false)} />}
    </section>
  );
}
