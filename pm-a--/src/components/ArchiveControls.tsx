import { useState } from "react";

const btn: React.CSSProperties = { borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };

/** 已封存專案的頂部橫幅：唯讀說明；有權限時顯示「解除封存」 */
export function ArchivedBanner({ archivedAt, canUnarchive, onUnarchive }: {
  archivedAt: string;
  canUnarchive: boolean;
  onUnarchive: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const d = new Date(archivedAt);
  const date = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  return (
    <div role="status" style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      background: "#f59e0b14", border: "1px solid #f59e0b44", borderRadius: 10,
      padding: "10px 16px", marginBottom: 16, color: "#fbbf24", fontSize: 13,
    }}>
      <span style={{ fontWeight: 700 }}>🗄 已封存</span>
      <span style={{ color: "#d6b46a", flex: 1, minWidth: 200 }}>此專案已於 {date} 封存，目前為唯讀；仍可查看週報與匯出資料。</span>
      {canUnarchive && (
        <button disabled={busy} onClick={async () => { setBusy(true); try { await onUnarchive(); } finally { setBusy(false); } }}
          style={{ ...btn, background: "#f59e0b22", border: "1px solid #f59e0b66", color: "#fbbf24", opacity: busy ? 0.6 : 1 }}>
          解除封存
        </button>
      )}
    </div>
  );
}

/** 封存確認視窗：還有未完成的任務時列出數量並提醒不再出現在逾期提醒中 */
export function ArchiveConfirmModal({ projectName, unfinishedCount, onConfirm, onClose }: {
  projectName: string;
  unfinishedCount: number;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#161b27", borderRadius: 14, padding: 24, maxWidth: 440, width: "100%", border: "1px solid #ffffff15" }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 12 }}>封存「{projectName}」？</p>
        {unfinishedCount > 0 ? (
          <p style={{ fontSize: 13, color: "#fbbf24", lineHeight: 1.7, marginBottom: 8 }}>
            此專案還有 <strong>{unfinishedCount}</strong> 個未完成的任務。封存後這些任務不會再出現在逾期提醒中。
          </p>
        ) : (
          <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, marginBottom: 8 }}>所有任務都已完成。</p>
        )}
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, marginBottom: 20 }}>
          封存後專案變成唯讀，並從專案清單移到「已封存」區塊；週報與匯出仍可使用，可隨時解除封存。
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ ...btn, background: "transparent", border: "1px solid #ffffff20", color: "#94a3b8", fontWeight: 400 }}>取消</button>
          <button disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
            style={{ ...btn, background: "#f59e0b", border: "none", color: "#111827", opacity: busy ? 0.6 : 1 }}>確定封存</button>
        </div>
      </div>
    </div>
  );
}
