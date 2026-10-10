import { useRef, useState, type ReactNode } from "react";

/** 刪除等不可復原操作的確認視窗 */
export type ConfirmOptions = {
  title: string;
  /** 黃色警告（例如：子任務會一併刪除） */
  warning?: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
};

/**
 * const [confirmDialog, confirm] = useConfirm();
 * if (await confirm({ title: "刪除「x」？" })) { ... }
 * 並在畫面中放入 {confirmDialog}
 */
export function useConfirm(): [ReactNode, (opts: ConfirmOptions) => Promise<boolean>] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = (o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setOpts(o);
  });
  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };

  const dialog = opts && (
    <div role="dialog" aria-modal="true" onClick={(e) => { e.stopPropagation(); close(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") close(false); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1100, padding: 16,
        background: "#00000090", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1a2030", borderRadius: 12, padding: 24, width: 360, maxWidth: "100%",
        border: "1px solid #ffffff15", boxShadow: "0 24px 64px #000a",
      }}>
        <p style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, marginBottom: 8, wordBreak: "break-word" }}>{opts.title}</p>
        {opts.warning && (
          <p style={{ color: "#f59e0b", fontSize: 13, marginBottom: 8, lineHeight: 1.6 }}>{opts.warning}</p>
        )}
        <p style={{ color: "#64748b", fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          {opts.message ?? "刪除後無法復原。"}
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button autoFocus className="btn-cancel" onClick={() => close(false)} style={{ flex: 1 }}>取消</button>
          <button onClick={() => close(true)} style={{
            flex: 1, background: "#ef4444", border: "none", borderRadius: 8,
            color: "#fff", fontSize: 13, fontWeight: 600, padding: 10, cursor: "pointer",
          }}>{opts.confirmLabel ?? "確定刪除"}</button>
        </div>
      </div>
    </div>
  );

  return [dialog, confirm];
}
