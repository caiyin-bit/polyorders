import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "polyorders",
  description: "Polymarket high win-rate wallet screener",
};

// 默认浅色;仅当用户显式选过深色时加 dark。
// 涨跌配色同理:默认绿涨红跌,选过红涨绿跌才挂 data-updown。
// 两者都必须在首屏绘制前同步执行,否则会闪一下错误配色。
const themeInit =
  `try{if(localStorage.getItem("theme")==="dark")document.documentElement.classList.add("dark");` +
  `if(localStorage.getItem("updown")==="red-up")document.documentElement.dataset.updown="red-up"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
