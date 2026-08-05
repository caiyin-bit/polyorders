"use client";

import { useEffect, useRef } from "react";

export default function TelegramWidget({ bot }: { bot: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", bot);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "24");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-auth-url", "/api/auth/telegram");
    script.setAttribute("data-request-access", "write");
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
    };
  }, [bot]);

  return <div ref={ref} className="flex min-h-[48px] items-center justify-center" />;
}
