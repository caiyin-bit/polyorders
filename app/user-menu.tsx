"use client";

import { useEffect, useState } from "react";

// 从展示 cookie 读用户名,避免服务端读 cookie 破坏首页 ISR 缓存
export default function UserMenu() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)po_user=([^;]+)/);
    setName(m ? decodeURIComponent(m[1]) : null);
  }, []);

  if (!name) return null;
  return (
    <form method="post" action="/api/auth/logout" className="flex items-center gap-2">
      <span className="text-xs text-ink2">@{name}</span>
      <button
        type="submit"
        className="rounded border border-line px-2 py-1 text-[11px] text-mut hover:border-mut hover:text-ink2"
      >
        退出
      </button>
    </form>
  );
}
