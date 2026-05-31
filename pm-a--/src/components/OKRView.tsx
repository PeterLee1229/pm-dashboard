import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { getOKRs, createObjective, updateObjective, deleteObjective, createKeyResult, updateKeyResult, deleteKeyResult } from "../api";

export function OKRModal({ objective, onSave, onClose }: {
  objective: any;
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(objective?.title || "");
  const [description, setDescription] = useState(objective?.description || "");
  const [startDate, setStartDate] = useState(objective?.startDate || "");
  const [endDate, setEndDate] = useState(objective?.endDate || "");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">{objective ? "編輯目標" : "新增目標"}</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-label">🎯 目標名稱</label>
            <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：Q3 完成後端開發" />
          </div>
          <div className="field">
            <label className="field-label">描述</label>
            <textarea className="field-input field-textarea" value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述這個目標的背景和期望..." rows={3} />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field-label">開始日期</label>
              <input type="date" className="field-input" value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ colorScheme: "dark" }} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field-label">結束日期</label>
              <input type="date" className="field-input" value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ colorScheme: "dark" }} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => {
            if (title.trim()) onSave({ title, description, startDate, endDate });
          }}>{objective ? "儲存變更" : "建立目標"}</button>
        </div>
      </div>
    </div>
  );
}

export function NewKRForm({ onSave, onCancel }: {
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [targetValue, setTargetValue] = useState(100);
  const [unit, setUnit] = useState("%");

  return (
    <div style={{ background: "#0f1117", borderRadius: 8, padding: 12, marginTop: 8, border: "1px solid #ffffff08" }}>
      <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="關鍵結果名稱" style={{ marginBottom: 8, fontSize: 12 }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10, color: "#475569" }}>目標值</label>
          <input type="number" className="field-input" value={targetValue}
            onChange={(e) => setTargetValue(parseFloat(e.target.value) || 0)}
            style={{ fontSize: 12 }} />
        </div>
        <div style={{ width: 80 }}>
          <label style={{ fontSize: 10, color: "#475569" }}>單位</label>
          <select className="field-input" value={unit} onChange={(e) => setUnit(e.target.value)}
            style={{ fontSize: 12 }}>
            <option value="%">%</option>
            <option value="件">件</option>
            <option value="分">分</option>
            <option value="次">次</option>
            <option value="小時">小時</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => { if (title.trim()) onSave({ title, targetValue, unit }); }}
          style={{ flex: 1, background: "#6366f1", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600, padding: "7px", cursor: "pointer" }}>
          新增
        </button>
        <button onClick={onCancel}
          style={{ background: "#ffffff10", border: "none", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "7px 14px", cursor: "pointer" }}>
          取消
        </button>
      </div>
    </div>
  );
}

export default function OKRView({ projectId, canManage }: {
  projectId: string;
  canManage: boolean;
}) {
  const [objectives, setObjectives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddObj, setShowAddObj] = useState(false);
  const [editingObj, setEditingObj] = useState<any>(null);
  const [addingKRId, setAddingKRId] = useState<string | null>(null);

  useEffect(() => { loadOKRs(); }, [projectId]);

  const loadOKRs = async () => {
    try {
      setLoading(true);
      const data = await getOKRs(projectId);
      setObjectives(data);
    } catch (err) {
      console.error("載入 OKR 失敗:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateObjective = async (data: any) => {
    try {
      const obj = await createObjective(projectId, data);
      setObjectives(prev => [...prev, obj]);
      setShowAddObj(false);
    } catch (err) { console.error("建立目標失敗:", err); }
  };

  const handleUpdateObjective = async (id: string, data: any) => {
    try {
      const updated = await updateObjective(id, data);
      setObjectives(prev => prev.map(o => o.id === id ? updated : o));
      setEditingObj(null);
    } catch (err) { console.error("更新目標失敗:", err); }
  };

  const handleDeleteObjective = async (id: string) => {
    try {
      await deleteObjective(id);
      setObjectives(prev => prev.filter(o => o.id !== id));
    } catch (err) { console.error("刪除目標失敗:", err); }
  };

  const handleCreateKR = async (objectiveId: string, data: any) => {
    try {
      const kr = await createKeyResult(objectiveId, data);
      setObjectives(prev => prev.map(o =>
        o.id === objectiveId ? { ...o, keyResults: [...(o.keyResults || []), kr] } : o
      ));
      setAddingKRId(null);
    } catch (err) { console.error("建立 KR 失敗:", err); }
  };

  const handleUpdateKR = async (krId: string, objectiveId: string, data: any) => {
    try {
      const updated = await updateKeyResult(krId, data);
      setObjectives(prev => prev.map(o =>
        o.id === objectiveId ? { ...o, keyResults: o.keyResults.map((kr: any) => kr.id === krId ? updated : kr) } : o
      ));
    } catch (err) { console.error("更新 KR 失敗:", err); }
  };

  const handleDeleteKR = async (krId: string, objectiveId: string) => {
    try {
      await deleteKeyResult(krId);
      setObjectives(prev => prev.map(o =>
        o.id === objectiveId ? { ...o, keyResults: o.keyResults.filter((kr: any) => kr.id !== krId) } : o
      ));
    } catch (err) { console.error("刪除 KR 失敗:", err); }
  };

  const getObjProgress = (obj: any) => {
    const krs = obj.keyResults || [];
    if (krs.length === 0) return 0;
    const total = krs.reduce((sum: number, kr: any) => {
      const p = kr.targetValue > 0 ? (kr.currentValue / kr.targetValue) * 100 : 0;
      return sum + Math.min(p, 100);
    }, 0);
    return Math.round(total / krs.length);
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>載入中...</div>;

  const overallProgress = objectives.length > 0
    ? Math.round(objectives.reduce((sum, o) => sum + getObjProgress(o), 0) / objectives.length)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* 頂部統計 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <div style={{ background: "#161b27", borderRadius: 10, padding: "16px 20px", border: "1px solid #6366f122" }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>目標數</p>
          <p style={{ fontSize: 28, fontWeight: 700, color: "#6366f1" }}>{objectives.length}</p>
        </div>
        <div style={{ background: "#161b27", borderRadius: 10, padding: "16px 20px", border: "1px solid #10b98122" }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>關鍵結果</p>
          <p style={{ fontSize: 28, fontWeight: 700, color: "#10b981" }}>
            {objectives.reduce((sum, o) => sum + (o.keyResults?.length || 0), 0)}
          </p>
        </div>
        <div style={{ background: "#161b27", borderRadius: 10, padding: "16px 20px", border: "1px solid #f59e0b22" }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>整體進度</p>
          <p style={{ fontSize: 28, fontWeight: 700, color: overallProgress >= 70 ? "#10b981" : overallProgress >= 40 ? "#f59e0b" : "#ef4444" }}>
            {overallProgress}%
          </p>
        </div>
      </div>

      {/* 新增按鈕 */}
      {canManage && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={() => setShowAddObj(true)} style={{
            background: "#6366f122", border: "1px solid #6366f144",
            borderRadius: 8, color: "#6366f1", fontSize: 13, fontWeight: 600,
            padding: "8px 20px", cursor: "pointer"
          }}>+ 新增目標</button>
        </div>
      )}

      {/* 目標列表 */}
      {objectives.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>🎯</p>
          <p style={{ fontSize: 15 }}>尚無 OKR 目標</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>點右上角「+ 新增目標」開始</p>
        </div>
      ) : objectives.map((obj) => {
        const progress = getObjProgress(obj);
        const progressColor = progress >= 70 ? "#10b981" : progress >= 40 ? "#f59e0b" : "#ef4444";

        return (
          <div key={obj.id} style={{ background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", overflow: "hidden" }}>
            {/* Objective 標題 */}
            <div style={{ padding: "16px 20px", background: "#1a2030", borderBottom: "1px solid #ffffff08" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🎯</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>{obj.title}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: progressColor }}>{progress}%</span>
                  {canManage && (
                    <>
                      <button onClick={() => setEditingObj(obj)} style={{
                        background: "#ffffff10", border: "none", borderRadius: 4,
                        color: "#94a3b8", fontSize: 10, padding: "3px 8px", cursor: "pointer"
                      }}>編輯</button>
                      <button onClick={() => handleDeleteObjective(obj.id)} style={{
                        background: "none", border: "none", color: "#ef4444",
                        cursor: "pointer", padding: 2, display: "flex"
                      }}><X size={14} /></button>
                    </>
                  )}
                </div>
              </div>
              {obj.description && (
                <p style={{ fontSize: 12, color: "#64748b", marginBottom: 8, marginLeft: 28 }}>{obj.description}</p>
              )}
              {(obj.startDate || obj.endDate) && (
                <p style={{ fontSize: 11, color: "#475569", marginLeft: 28 }}>
                  {obj.startDate || "?"} ~ {obj.endDate || "?"}
                </p>
              )}
              <div style={{ marginTop: 10, marginLeft: 28 }}>
                <div style={{ height: 6, background: "#ffffff10", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, background: progressColor, borderRadius: 99, transition: "width .3s" }} />
                </div>
              </div>
            </div>

            {/* Key Results */}
            <div style={{ padding: "12px 20px" }}>
              {(obj.keyResults || []).map((kr: any) => {
                const krProgress = kr.targetValue > 0 ? Math.min(Math.round((kr.currentValue / kr.targetValue) * 100), 100) : 0;
                const krColor = krProgress >= 70 ? "#10b981" : krProgress >= 40 ? "#f59e0b" : "#ef4444";
                return (
                  <div key={kr.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 0", borderBottom: "1px solid #ffffff06"
                  }}>
                    <span style={{ fontSize: 12, color: "#475569", flexShrink: 0 }}>🔑</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: "#e2e8f0" }}>{kr.title}</span>
                        <span style={{ fontSize: 11, color: krColor, fontWeight: 600 }}>
                          {kr.currentValue} / {kr.targetValue} {kr.unit}
                        </span>
                      </div>
                      <div style={{ height: 4, background: "#ffffff10", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${krProgress}%`, background: krColor, borderRadius: 99, transition: "width .3s" }} />
                      </div>
                    </div>
                    {canManage && (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <input type="number" value={kr.currentValue} min={0} max={kr.targetValue}
                          onChange={(e) => handleUpdateKR(kr.id, obj.id, { ...kr, currentValue: parseFloat(e.target.value) || 0 })}
                          style={{
                            width: 60, background: "#0f1117", border: "1px solid #ffffff12",
                            borderRadius: 6, color: "#e2e8f0", fontSize: 11, padding: "4px 6px",
                            outline: "none", textAlign: "center"
                          }} />
                        <button onClick={() => handleDeleteKR(kr.id, obj.id)} style={{
                          background: "none", border: "none", color: "#ef4444",
                          cursor: "pointer", padding: 2, display: "flex"
                        }}><X size={12} /></button>
                      </div>
                    )}
                  </div>
                );
              })}

              {canManage && (
                addingKRId === obj.id ? (
                  <NewKRForm
                    onSave={(data) => handleCreateKR(obj.id, data)}
                    onCancel={() => setAddingKRId(null)}
                  />
                ) : (
                  <button onClick={() => setAddingKRId(obj.id)} style={{
                    background: "none", border: "1px dashed #ffffff15", borderRadius: 8,
                    color: "#64748b", fontSize: 12, padding: "8px", cursor: "pointer",
                    width: "100%", marginTop: 8
                  }}>+ 新增關鍵結果</button>
                )
              )}
            </div>
          </div>
        );
      })}

      {(showAddObj || editingObj) && (
        <OKRModal
          objective={editingObj}
          onSave={(data) => editingObj ? handleUpdateObjective(editingObj.id, data) : handleCreateObjective(data)}
          onClose={() => { setShowAddObj(false); setEditingObj(null); }}
        />
      )}
    </div>
  );
}

// ── CalendarView ──────────────────────────────────────────────────────
