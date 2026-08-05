import type { ReactNode } from "react";
import ThemeToggle from "../theme-toggle";
import UserMenu from "../user-menu";

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-4">
      <header className="mb-4 flex items-center gap-3 border-b border-line pb-3">
        <a href="/" className="font-mono text-lg font-bold tracking-tight">
          POLY<span className="text-accent">ORDERS</span>
        </a>
        <span className="text-xs text-mut">
          Polymarket 高胜率地址筛选终端
        </span>
        <div className="ml-auto flex items-center gap-3">
          <UserMenu />
          <ThemeToggle />
        </div>
      </header>
      {children}
    </div>
  );
}
