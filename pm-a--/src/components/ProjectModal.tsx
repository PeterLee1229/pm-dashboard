import { useState } from "react";
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">{existing ? "編輯專案" : "新增專案"}</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
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
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => { if (name.trim()) { onSave(name.trim(), description, color); onClose(); } }}>
            {existing ? "儲存變更" : "建立專案"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Member Input ─────────────────────────────────────────────────────
