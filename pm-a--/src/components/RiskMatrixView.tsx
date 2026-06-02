import { useState } from "react";
import { X, AlertCircle, AlignLeft, Flag, User } from "lucide-react";
import type { RiskLevel, RiskStatus, Group, Risk } from "../types";
import { RISK_LEVELS, RISK_STATUS_CONFIG, findMemberById, memberDisplay } from "../helpers";

export function RiskModal({ risk, onSave, onClose, projectMembers, currentProjectRole, currentUser }: {
  risk: Risk | null;
  onSave: (risk: Risk) => void;
  onClose: () => void;
  projectMembers: any[];
  currentProjectRole: string;
  currentUser: any;
}) {
  const [form, setForm] = useState<Risk>(risk || {
    id: "r" + Date.now(),
    title: "",
    description: "",
    probability: "medium",
    impact: "medium",
    countermeasure: "",
    ownerId: "",
    ownerGroupId: "",
    status: "monitoring",
    createdDate: new Date().toISOString().split("T")[0],
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">{risk ? "編輯風險" : "新增風險"}</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: "65vh", overflowY: "auto" }}>
          <div className="field">
            <label className="field-label"><Flag size={13} /> 風險名稱</label>
            <input className="field-input" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="輸入風險名稱..." />
          </div>
          <div className="field">
            <label className="field-label"><AlignLeft size={13} /> 風險描述</label>
            <textarea className="field-input field-textarea" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="描述風險情境..." rows={3} />
          </div>
          <div className="field">
            <label className="field-label"><AlertCircle size={13} /> 發生機率</label>
            <div style={{ display: "flex", gap: 6 }}>
              {RISK_LEVELS.map((l) => (
                <button key={l.id} onClick={() => setForm({ ...form, probability: l.id })}
                  style={{
                    flex: 1, borderRadius: 8, padding: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: form.probability === l.id ? l.color + "22" : "transparent",
                    border: `1px solid ${form.probability === l.id ? l.color : "#ffffff15"}`,
                    color: form.probability === l.id ? l.color : "#64748b"
                  }}>{l.label}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="field-label"><AlertCircle size={13} /> 影響程度</label>
            <div style={{ display: "flex", gap: 6 }}>
              {RISK_LEVELS.map((l) => (
                <button key={l.id} onClick={() => setForm({ ...form, impact: l.id })}
                  style={{
                    flex: 1, borderRadius: 8, padding: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: form.impact === l.id ? l.color + "22" : "transparent",
                    border: `1px solid ${form.impact === l.id ? l.color : "#ffffff15"}`,
                    color: form.impact === l.id ? l.color : "#64748b"
                  }}>{l.label}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="field-label"><Flag size={13} /> 因應對策</label>
            <textarea className="field-input field-textarea" value={form.countermeasure}
              onChange={(e) => setForm({ ...form, countermeasure: e.target.value })}
              placeholder="輸入因應對策..." rows={3} />
          </div>
          <div className="field">
            <label className="field-label"><User size={13} /> 負責人</label>
            {(() => {
              const available = currentProjectRole === "group_leader"
                ? projectMembers.filter((pm: any) => pm.user?.group?.id === currentUser?.group?.id)
                : projectMembers;
              return (
                <select className="field-input" value={form.ownerId}
                  onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
                  <option value="">選擇負責人</option>
                  {available.map((pm: any) => (
                    <option key={pm.user?.id} value={pm.user?.memberId || pm.user?.id}>
                      {pm.user?.name}（{pm.user?.memberId}）{pm.user?.group ? ` — ${pm.user.group.name}` : ""}
                    </option>
                  ))}
                </select>
              );
            })()}
          </div>
          <div className="field">
            <label className="field-label"><Flag size={13} /> 狀態</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(Object.entries(RISK_STATUS_CONFIG) as [RiskStatus, { label: string; color: string }][]).map(([key, cfg]) => (
                <button key={key} onClick={() => setForm({ ...form, status: key })}
                  style={{
                    flex: 1, borderRadius: 8, padding: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: form.status === key ? cfg.color + "22" : "transparent",
                    border: `1px solid ${form.status === key ? cfg.color : "#ffffff15"}`,
                    color: form.status === key ? cfg.color : "#64748b"
                  }}>{cfg.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => {
            if (form.title.trim()) { onSave(form); onClose(); }
          }}>{risk ? "儲存變更" : "建立風險"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Risk Matrix View ──────────────────────────────────────────────────

export default function RiskMatrixView({ risks, groups, onCreateRisk, onUpdateRisk, onDeleteRisk, canManage, projectMembers, currentProjectRole, currentUser }: {
  risks: Risk[];
  groups: Group[];
  onCreateRisk: (risk: Risk) => void;
  onUpdateRisk: (risk: Risk) => void;
  onDeleteRisk: (id: string) => void;
  canManage: boolean;
  projectMembers: any[];
  currentProjectRole: string;
  currentUser: any;
}) {
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [editingRisk, setEditingRisk] = useState<Risk | null>(null);

  const levels = RISK_LEVELS;

  const getCell = (prob: RiskLevel, imp: RiskLevel) =>
    risks.filter((r) => r.probability === prob && r.impact === imp && r.status !== "resolved");

  const getCellColor = (prob: RiskLevel, imp: RiskLevel) => {
    const pv = levels.find((l) => l.id === prob)!.value;
    const iv = levels.find((l) => l.id === imp)!.value;
    const score = pv * iv;
    if (score >= 16) return "#ef444440";
    if (score >= 10) return "#f9731640";
    if (score >= 5)  return "#facc1530";
    if (score >= 3)  return "#6366f120";
    return "#4ade8015";
  };

  const handleDelete = (id: string) => onDeleteRisk(id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12 }}>
          {Object.entries(RISK_STATUS_CONFIG).map(([key, cfg]) => {
            const count = risks.filter((r) => r.status === key).length;
            return (
              <div key={key} style={{
                background: "#161b27", borderRadius: 8, padding: "8px 16px",
                border: `1px solid ${cfg.color}22`, display: "flex", alignItems: "center", gap: 8
              }}>
                <div style={{ width: 8, height: 8, borderRadius: 99, background: cfg.color }} />
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{cfg.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: cfg.color }}>{count}</span>
              </div>
            );
          })}
        </div>
        {canManage && (
          <button onClick={() => { setEditingRisk(null); setShowRiskModal(true); }}
            style={{
              background: "#6366f122", border: "1px solid #6366f144",
              borderRadius: 8, color: "#6366f1", fontSize: 13, fontWeight: 600,
              padding: "8px 20px", cursor: "pointer"
            }}>
            + 新增風險
          </button>
        )}
      </div>

      {/* 5×5 矩陣 */}
      <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>風險矩陣（機率 × 影響）</p>
        <div style={{ display: "flex" }}>
          {/* Y 軸標籤 */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 20, marginRight: 4
          }}>
            <span style={{
              fontSize: 11, color: "#64748b",
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              letterSpacing: 4,
              whiteSpace: "nowrap"
            }}>← 機率</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", paddingLeft: 50 }}>
              {levels.map((l) => (
                <div key={l.id} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: 600, color: l.color, padding: "6px 0" }}>
                  {l.label}
                </div>
              ))}
            </div>
            {[...levels].map((probLevel) => (
              <div key={probLevel.id} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ width: 50, textAlign: "center", fontSize: 11, fontWeight: 600, color: probLevel.color }}>
                  {probLevel.label}
                </div>
                {levels.map((impLevel) => {
                  const cellRisks = getCell(probLevel.id, impLevel.id);
                  return (
                    <div key={impLevel.id} style={{
                      flex: 1, height: 60, background: getCellColor(probLevel.id, impLevel.id),
                      border: "1px solid #ffffff08", borderRadius: 4, margin: 2,
                      display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center",
                      gap: 3, padding: 3, cursor: cellRisks.length > 0 ? "pointer" : "default"
                    }}>
                      {cellRisks.map((r) => (
                        <div key={r.id} onClick={() => { if (canManage) { setEditingRisk(r); setShowRiskModal(true); } }}
                          title={r.title}
                          style={{
                            width: 18, height: 18, borderRadius: 4, fontSize: 8, fontWeight: 700,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: RISK_STATUS_CONFIG[r.status].color + "33",
                            color: RISK_STATUS_CONFIG[r.status].color,
                            border: `1px solid ${RISK_STATUS_CONFIG[r.status].color}66`,
                            cursor: canManage ? "pointer" : "default"
                          }}>
                          {r.title.charAt(0)}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ textAlign: "center", fontSize: 10, color: "#64748b", marginTop: 6 }}>影響 →</div>
          </div>
        </div>
      </div>

      {/* 風險清單 */}
      <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>風險清單</p>
        {risks.length === 0 ? (
          <p style={{ fontSize: 13, color: "#475569", textAlign: "center", padding: 24 }}>尚無風險項目</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {risks.map((risk) => {
              const owner = findMemberById(groups, risk.ownerId);
              const statusCfg = RISK_STATUS_CONFIG[risk.status];
              const probCfg = RISK_LEVELS.find((l) => l.id === risk.probability)!;
              const impCfg = RISK_LEVELS.find((l) => l.id === risk.impact)!;
              return (
                <div key={risk.id} style={{
                  background: "#0f1117", borderRadius: 10, padding: 14,
                  border: "1px solid #ffffff08", cursor: canManage ? "pointer" : "default"
                }} onClick={() => { if (canManage) { setEditingRisk(risk); setShowRiskModal(true); } }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{risk.title}</span>
                      <span style={{
                        fontSize: 10, padding: "2px 8px", borderRadius: 99,
                        background: statusCfg.color + "22", color: statusCfg.color,
                        border: `1px solid ${statusCfg.color}44`
                      }}>{statusCfg.label}</span>
                    </div>
                    {canManage && (
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(risk.id); }}
                        style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 4, display: "flex" }}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {risk.description && (
                    <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, marginBottom: 8 }}>{risk.description}</p>
                  )}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>機率：<span style={{ color: probCfg.color, fontWeight: 600 }}>{probCfg.label}</span></span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>影響：<span style={{ color: impCfg.color, fontWeight: 600 }}>{impCfg.label}</span></span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>負責人：<span style={{ color: "#e2e8f0" }}>{owner ? memberDisplay(owner) : "未指派"}</span></span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>建立：{risk.createdDate}</span>
                  </div>
                  {risk.countermeasure && (
                    <p style={{ fontSize: 11, color: "#6366f1", marginTop: 6 }}>對策：{risk.countermeasure}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showRiskModal && (
        <RiskModal
          risk={editingRisk}
          projectMembers={projectMembers}
          currentProjectRole={currentProjectRole}
          currentUser={currentUser}
          onSave={(risk) => {
            if (editingRisk) {
              onUpdateRisk(risk);
            } else {
              onCreateRisk(risk);
            }
            setShowRiskModal(false);
          }}
          onClose={() => setShowRiskModal(false)}
        />
      )}
    </div>
  );
}

// ── Gantt View ───────────────────────────────────────────────────────
