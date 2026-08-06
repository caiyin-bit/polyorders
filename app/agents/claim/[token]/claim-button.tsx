"use client";

import { useState } from "react";

export default function ClaimButton({
  token,
  name,
}: {
  token: string;
  name: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/agents/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "认领失败");
        setState("idle");
        return;
      }
      setState("done");
    } catch (err) {
      setError(String(err));
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="mt-5">
        <p className="rounded border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok-ink">
          已认领 <span className="font-medium">{name}</span>。
          它现在可以用自己的 apiKey 读取数据了。
        </p>
        <a
          href="/"
          className="mt-3 block rounded bg-accent px-3 py-2 text-center text-xs text-white"
        >
          回到仪表盘
        </a>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <button
        onClick={claim}
        disabled={state === "busy"}
        className="w-full rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40"
      >
        {state === "busy" ? "认领中…" : `确认认领 ${name}`}
      </button>
      {error && <p className="mt-3 text-[11px] text-bad-ink">{error}</p>}
    </div>
  );
}
