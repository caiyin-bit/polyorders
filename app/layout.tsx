import type { Metadata } from "next";
import type { ReactNode } from "react";
import ThemeToggle from "./theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "polyorders",
  description: "Polymarket high win-rate wallet screener",
};

// 默认浅色;仅当用户显式选过深色时加 dark
const themeInit = `try{if(localStorage.getItem("theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <div className="mx-auto max-w-[1440px] px-5 py-4">
          <header className="mb-4 flex items-center gap-3 border-b border-line pb-3">
            <a href="/" className="font-mono text-lg font-bold tracking-tight">
              POLY<span className="text-accent">ORDERS</span>
            </a>
            <span className="text-xs text-mut">
              Polymarket 高胜率地址筛选终端
            </span>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
