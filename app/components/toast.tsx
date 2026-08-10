"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ---------- 全站统一提示(Toast) ---------- */

type ToastKind = "error" | "success" | "info";

type Toast = { id: number; kind: ToastKind; message: string };

/** 错误留久一点:用户往往还盯着刚点过的按钮,一闪而过等于没提示 */
const TTL: Record<ToastKind, number> = {
  error: 6000,
  success: 3000,
  info: 4500,
};

// 底色一律用不透明的 bg-panel:浮层压在表格/弹窗之上,半透明会把下面的
// 文字透上来。语义只靠边框和图标着色,且用恒定状态色而非涨跌色——
// 红涨绿跌配色下报错不该变绿
const STYLE: Record<ToastKind, { border: string; ink: string; icon: string }> = {
  error: { border: "border-bad/60", ink: "text-bad-ink", icon: "!" },
  success: { border: "border-ok/60", ink: "text-ok-ink", icon: "✓" },
  info: { border: "border-accent/60", ink: "text-accent", icon: "i" },
};

const MAX_VISIBLE = 4;

export type ToastApi = {
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
};

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast 必须在 ToastProvider 内使用");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    setToasts((prev) => {
      // 轮询/连点会反复抛同一条;重复只换个新 id 重置计时,不堆成一摞
      const rest = prev.filter((t) => !(t.kind === kind && t.message === message));
      return [...rest, { id: ++seq.current, kind, message }].slice(-MAX_VISIBLE);
    });
  }, []);

  // api 恒定,调用方可以安心把它放进 useCallback 的依赖里
  const api = useMemo<ToastApi>(
    () => ({
      error: (m) => push("error", m),
      success: (m) => push("success", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* 顶部居中悬浮:面板内的红字离触发点太远(在榜单点 ☆ 却在左栏底部报错),
          浮层贴着视线中轴才跑不掉。z-50 压过 z-40 的各类弹窗 */}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-1.5 px-4">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const { id, kind, message } = toast;

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), TTL[kind]);
    return () => clearTimeout(timer);
  }, [id, kind, onDismiss]);

  const style = STYLE[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`toast-in pointer-events-auto flex max-w-md items-start gap-2 rounded border bg-panel px-3 py-2 text-[11px] leading-4 text-ink shadow-lg ${style.border}`}
    >
      <span className={`shrink-0 font-mono font-bold ${style.ink}`}>
        {style.icon}
      </span>
      <span className="min-w-0 break-words">{message}</span>
      <button
        onClick={() => onDismiss(id)}
        title="关闭"
        className="-my-0.5 -mr-1 shrink-0 px-1 opacity-50 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
