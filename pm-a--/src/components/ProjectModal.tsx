import { useState, useRef } from "react";
import { X, AlignLeft, Flag } from "lucide-react";
import { PROJECT_COLORS } from "../helpers";

export default function ProjectModal({ onSave, onClose, existing }: {
  onSave: (name: string, description: string, color: string) => void;
  onClose: () => void;
  existing?: { name: string; description: string; color: string };
}) {
  const [name, setName] = useState(existing?.name || "");
  const [description, setDescription] = useState(existing?.description || "");
  const [color, setColor] = useState(existing?.color || PROJECT_COLORS[0]);
  const initialName = useRef(existing?.name || "");
  const initialDescription = useRef(existing?.description || "");
  const initialColor = useRef(existing?.color || PROJECT_COLORS[0]);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);

  const isDirty = name !== initialName.current || description !== initialDescription.current || color !== initialColor.current;
  const handleClose = () => { if (isDirty) setShowConfirmLeave(true); else onClose(); };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">{existing ? "編輯專案" : "新增專案"}</span>
          <button className="modal-close" onClick={handleClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-label"><Flag size={13} /> 專案名稱</label>
            <input className="field-input" value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="輸入專案名稱..." />
          </div>
          <div className="field">
            <label className="field-label"><AlignLeft size={13} /> 描述</label>
            <textarea className="field-input field-textarea" value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="輸入專案描述..." rows={3} />
          </div>
          <div className="field">
            <label className="field-label"><Flag size={13} /> 專案顏色</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {PROJECT_COLORS.map((c) => (
                <div key={c} onClick={() => setColor(c)} style={{
                  width: 28, height: 28, borderRadius: 99, background: c,
                  cursor: "pointer", border: color === c ? "3px solid #fff" : "3px solid transparent",
                  transition: "border .15s"
                }} />
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={handleClose}>取消</button>
          <button className="btn-save" onClick={() => { if (name.trim()) { onSave(name.trim(), description, color); onClose(); } }}>
            {existing ? "儲存變更" : "建立專案"}
          </button>
        </div>

        {showConfirmLeave && (
          <div style={{ position: "absolute", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "inherit", zIndex: 10 }}>
            <div style={{ background: "#1e293b", border: "1px solid #ef444444", borderRadius: 12, padding: 24, width: 300, textAlign: "center" }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", marginBottom: 8 }}>放棄變更？</p>
              <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20, lineHeight: 1.5 }}>
                你有未儲存的修改，關閉後將遺失。<br />確定要離開嗎？
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button className="btn-cancel" onClick={() => setShowConfirmLeave(false)}>繼續編輯</button>
                <button onClick={onClose}
                  style={{ background: "#ef4444", border: "none", color: "#fff", borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  放棄變更
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Member Input ─────────────────────────────────────────────────────
