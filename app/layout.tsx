import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "polyorders",
  description: "Polymarket high win-rate wallet screener",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body className="min-h-screen bg-bg text-ink antialiased">
        <div className="mx-auto max-w-[1440px] px-5 py-4">
          <header className="mb-4 flex items-baseline gap-3 border-b border-line pb-3">
            <a href="/" className="font-mono text-lg font-bold tracking-tight">
              POLY<span className="text-accent">ORDERS</span>
            </a>
            <span className="text-xs text-mut">
              Polymarket 高胜率地址筛选终端
            </span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
