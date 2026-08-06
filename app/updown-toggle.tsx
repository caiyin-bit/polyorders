"use client";

import { useEffect, useState } from "react";

// 涨跌配色切换。默认绿涨红跌(欧美习惯),可切到红涨绿跌(中港台习惯)。
// 实现上只在 <html> 上挂 data-updown,由 globals.css 交换语义映射——
// 组件里的 text-up-ink / text-down-ink 一律不用改。

const KEY = "updown";
const RED_UP = "red-up";

export default function UpDownToggle() {
  // null 表示尚未读到本地偏好,此时渲染等宽占位,避免 hydration 前后跳动
  const [redUp, setRedUp] = useState<boolean | null>(null);

  useEffect(() => {
    setRedUp(document.documentElement.dataset.updown === RED_UP);
  }, []);

  function toggle() {
    const next = !redUp;
    setRedUp(next);
    if (next) document.documentElement.dataset.updown = RED_UP;
    else delete document.documentElement.dataset.updown;
    try {
      localStorage.setItem(KEY, next ? RED_UP : "green-up");
    } catch {}
  }

  const label = redUp ? "红涨绿跌" : "绿涨红跌";

  return (
    <button
      onClick={toggle}
      aria-label={`涨跌配色:${label},点击切换`}
      title={`当前${label},点击切换`}
      className="flex items-center gap-1 rounded border border-line px-1.5 py-1 text-ink2 hover:border-mut hover:text-ink"
    >
      {redUp === null ? (
        <span className="block h-4 w-8" />
      ) : (
        <>
          {/* 直接用两个色块表意,比文字更快辨认;色块自身就受配色影响 */}
          <span className="flex h-4 w-4 flex-col justify-center gap-0.5">
            <span className="block h-1 rounded-[1px] bg-up" />
            <span className="block h-1 rounded-[1px] bg-down" />
          </span>
          <span className="text-[10px] leading-none">{label}</span>
        </>
      )}
    </button>
  );
}
