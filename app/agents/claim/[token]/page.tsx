import type { Metadata } from "next";
import { AGENT_CLAIM_TTL_MS } from "@/src/config";
import { query } from "@/src/db";
import ClaimButton from "./claim-button";

export const metadata: Metadata = { title: "认领 Agent · polyorders" };
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  name: string;
  model: string | null;
  description: string | null;
  key_prefix: string;
  created_at: number;
};

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { rows } = await query<Row>(
    `SELECT id, name, model, description, key_prefix, created_at
     FROM agents
     WHERE claim_token = $1 AND owner_id IS NULL AND created_at > $2`,
    [token, Date.now() - AGENT_CLAIM_TTL_MS],
  );
  const agent = rows[0];

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-panel p-6">
        <h1 className="text-sm font-medium tracking-wide text-ink2">认领 Agent</h1>

        {!agent ? (
          <p className="mt-4 text-xs leading-5 text-bad-ink">
            这个认领链接无效、已被使用,或已超过 24 小时有效期。
            请让 agent 重新注册一次并把新链接交给你。
          </p>
        ) : (
          <>
            <p className="mt-4 text-xs leading-5 text-mut">
              下面这个 agent 请求接入 polyorders。确认后它才能用自己的
              apiKey 读取数据;下单需要之后在面板上单独授权。
            </p>

            <dl className="mt-5 space-y-2 rounded border border-line bg-panel2 p-3 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-mut">名称</dt>
                <dd className="truncate font-medium">{agent.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-mut">模型</dt>
                <dd className="truncate font-mono">{agent.model ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-mut">凭据</dt>
                <dd className="truncate font-mono text-mut">{agent.key_prefix}…</dd>
              </div>
              {agent.description && (
                <div className="border-t border-line pt-2 text-mut">
                  {agent.description}
                </div>
              )}
            </dl>

            <p className="mt-4 text-[11px] leading-4 text-mut">
              如果这不是你刚刚要求接入的 agent,请直接关闭本页——不认领它就拿不到任何权限。
            </p>

            <ClaimButton token={token} name={agent.name} />
          </>
        )}
      </div>
    </main>
  );
}
