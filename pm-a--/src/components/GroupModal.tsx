import { useState } from "react";
import { X } from "lucide-react";
import type { Member, Group } from "../types";
import { PROJECT_COLORS } from "../helpers";

export function MemberInput({ onAdd, color }: { onAdd: (member: Member) => void; color: string }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const handleAdd = () => {
    if (id.trim() && name.trim()) {
      onAdd({ id: id.trim(), name: name.trim() });
      setId(""); setName("");
    }
  };
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input value={id} onChange={(e) => setId(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        placeholder="員工編號"
        style={{ width: 80, background: "#161b27", border: "1px solid #ffffff10", borderRadius: 6, padding: "5px 10px", color: "#e2e8f0", fontSize: 12, outline: "none" }} />
      <input value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        placeholder="姓名"
        style={{ flex: 1, background: "#161b27", border: "1px solid #ffffff10", borderRadius: 6, padding: "5px 10px", color: "#e2e8f0", fontSize: 12, outline: "none" }} />
      <button onClick={handleAdd}
        style={{ background: color + "22", border: `1px solid ${color}44`, borderRadius: 6, color, fontSize: 11, padding: "5px 10px", cursor: "pointer" }}>
        加入
      </button>
    </div>
  );
}

// ── Time Log Editor ───────────────────────────────────────────────────

export default function GroupModal({ groups, onSave, onClose }: {
  groups: Group[];
  onSave: (groups: Group[]) => void;
  onClose: () => void;
}) {
  const [editGroups, setEditGroups] = useState<Group[]>(
    groups.map((g) => ({ ...g, members: g.members || [] }))
  );
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PROJECT_COLORS[0]);

  const handleAdd = () => {
    if (!newName.trim()) return;
    setEditGroups([...editGroups, { id: "g" + Date.now(), name: newName.trim(), color: newColor, members: [] }]);
    setNewName("");
  };

  const handleDelete = (id: string) => {
    setEditGroups(editGroups.filter((g) => g.id !== id));
  };

  const handleRename = (id: string, name: string) => {
    setEditGroups(editGroups.map((g) => g.id === id ? { ...g, name } : g));
  };

  const handleColorChange = (id: string, color: string) => {
    setEditGroups(editGroups.map((g) => g.id === id ? { ...g, color } : g));
  };

  const handleAddMember = (groupId: string, member: Member) => {
    setEditGroups(editGroups.map((g) =>
      g.id === groupId && !g.members.some((m) => m.id === member.id)
        ? { ...g, members: [...g.members, member] }
        : g
    ));
  };

  const handleRemoveMember = (groupId: string, memberId: string) => {
    setEditGroups(editGroups.map((g) =>
      g.id === groupId ? { ...g, members: g.members.filter((m) => m.id !== memberId) } : g
    ));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">管理組別與成員</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: "65vh", overflowY: "auto" }}>
          {editGroups.map((g) => (
            <div key={g.id} style={{ background: "#0f1117", borderRadius: 10, padding: 14, border: "1px solid #ffffff08" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ position: "relative" }}>
                  <div style={{ width: 16, height: 16, borderRadius: 99, background: g.color, cursor: "pointer" }} />
                  <select value={g.color} onChange={(e) => handleColorChange(g.id, e.target.value)}
                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}>
                    {PROJECT_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <input value={g.name} onChange={(e) => handleRename(g.id, e.target.value)}
                  style={{ flex: 1, background: "transparent", border: "none", color: "#e2e8f0", fontSize: 14, fontWeight: 600, outline: "none" }} />
                <button onClick={() => handleDelete(g.id)}
                  style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 2, display: "flex" }}>
                  <X size={14} />
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {g.members.map((m) => (
                  <span key={m.id} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    background: g.color + "18", color: g.color,
                    border: `1px solid ${g.color}33`,
                    borderRadius: 99, padding: "3px 10px", fontSize: 11, fontWeight: 500
                  }}>
                    {m.name}（{m.id}）
                    <button onClick={() => handleRemoveMember(g.id, m.id)}
                      style={{ background: "none", border: "none", color: g.color, cursor: "pointer", padding: 0, display: "flex", marginLeft: 2 }}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {g.members.length === 0 && (
                  <span style={{ fontSize: 11, color: "#475569" }}>尚無成員</span>
                )}
              </div>
              <MemberInput onAdd={(member) => handleAddMember(g.id, member)} color={g.color} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, paddingTop: 12, borderTop: "1px solid #ffffff08" }}>
            <div style={{ position: "relative" }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: newColor, cursor: "pointer" }} />
              <select value={newColor} onChange={(e) => setNewColor(e.target.value)}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}>
                {PROJECT_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <input className="field-input" placeholder="新組別名稱..." value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              style={{ flex: 1 }} />
            <button onClick={handleAdd}
              style={{ background: "#6366f122", border: "1px solid #6366f144", borderRadius: 8, color: "#6366f1", fontSize: 12, padding: "8px 14px", cursor: "pointer", whiteSpace: "nowrap" }}>
              新增
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => { onSave(editGroups); onClose(); }}>儲存變更</button>
        </div>
      </div>
    </div>
  );
}
