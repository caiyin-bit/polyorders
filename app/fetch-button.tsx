"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function FetchButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/fetch");
      const data = (await res.json()) as { running: boolean };
      setRunning(data.running);
      return data.running;
    } catch {
      return true;
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const still = await check();
      if (!still) router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [running, router, check]);

  async function start() {
    setError(null);
    setRunning(true);
    try {
      const res = await fetch("/api/fetch", { method: "POST" });
      if (res.status === 409) setError("已有拉取进程在运行");
    } catch {
      setError("启动失败");
      setRunning(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-amber-600 dark:text-amber-400">{error}</span>}
      <button
        onClick={start}
        disabled={running}
        className="rounded-lg border border-emerald-500 px-3 py-1.5 text-sm text-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400 dark:text-emerald-400 dark:hover:bg-emerald-950/40 dark:disabled:border-zinc-700 dark:disabled:text-zinc-500"
      >
        {running ? "拉取中…" : "手动拉取"}
      </button>
    </span>
  );
}
