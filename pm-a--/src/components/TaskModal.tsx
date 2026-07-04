import { useState, useEffect, useRef } from "react";
import { X, CheckCircle2, User, AlignLeft, Flag, Timer, Calendar } from "lucide-react";
import type { Priority, TimeLog, Group, Task, SubTask } from "../types";
import { PRIORITY_CONFIG, getCompletion, getEffectiveStartDate, getEffectiveEndDate, getTotalHours, hasPermission } from "../helpers";
import { getComments, addComment, deleteComment, getAttachments, addAttachment, deleteAttachment } from "../api";
import { Skeleton } from "./LoadingEmpty";

export function TimeLogEditor({ logs, onChange }: {
  logs: TimeLog[];
  onChange: (logs: TimeLog[]) => void;
}) {
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newHours, setNewHours] = useState("");

  const handleAdd = () => {
    if (!newDate || !newHours || parseFloat(newHours) <= 0) return;
    const newLog: TimeLog = { id: "tl" + Date.now(), date: newDate, hours: parseFloat(newHours) };
    onChange([...logs, newLog].sort((a, b) => b.date.localeCompare(a.date)));
    setNewHours("");
  };

  const handleDelete = (id: string) => onChange(logs.filter((l) => l.id !== id));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input type="date" value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          style={{ flex: 1, background: "#161b27", border: "1px solid #ffffff10", borderRadius: 6, padding: "5px 10px", color: "#e2e8f0", fontSize: 12, outline: "none", colorScheme: "dark" }} />
        <input type="number" step="0.5" min="0" value={newHours}
          onChange={(e) => setNewHours(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="工時"
          style={{ width: 70, background: "#161b27", border: "1px solid #ffffff10", borderRadius: 6, padding: "5px 10px", color: "#e2e8f0", fontSize: 12, outline: "none" }} />
        <span style={{ fontSize: 11, color: "#475569", alignSelf: "center" }}>h</span>
        <button onClick={handleAdd}
          style={{ background: "#10b98122", border: "1px solid #10b98144", borderRadius: 6, color: "#10b981", fontSize: 11, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
          + 新增
        </button>
      </div>
      {logs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {logs.map((log) => (
            <div key={log.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#161b27", borderRadius: 6, padding: "5px 10px", border: "1px solid #ffffff06" }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{log.date}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>{log.hours} h</span>
                <button onClick={() => handleDelete(log.id)}
                  style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 2, display: "flex" }}>
                  <X size={10} />
                </button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#10b981" }}>總計：{getTotalHours(logs)} 小時</span>
          </div>
        </div>
      )}
    </div>
  );
}

// dirty-check snapshot (excludes comment draft which is separate state)
const snapshotOf = (f: Task) => JSON.stringify({
  title: f.title, description: f.description, priority: f.priority,
  groupId: f.groupId, assignee: f.assignee, startDate: f.startDate,
  endDate: f.endDate, completion: f.completion,
  timeLogs: f.timeLogs, subtasks: f.subtasks,
});

// ── Task Modal ────────────────────────────────────────────────────────

export default function TaskModal({ task, groups, onSave, onClose, currentProjectRole, currentUser }: {
  task: Task;
  groups: Group[];
  onSave: (updated: Task) => void;
  onClose: () => void;
  currentProjectRole: string;
  currentUser: any;
}) {
  const [form, setForm] = useState<Task>({ ...task });
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loadingComments, setLoadingComments] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [newAttachName, setNewAttachName] = useState("");
  const [newAttachUrl, setNewAttachUrl] = useState("");
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);

  // snapshot taken after mount effects (assignee/groupId auto-fix) settle
  const initialSnapshot = useRef("");
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; });
  useEffect(() => {
    const id = setTimeout(() => { initialSnapshot.current = snapshotOf(formRef.current); }, 0);
    return () => clearTimeout(id);
  }, []);

  const isDesktop = window.innerWidth >= 1024;
  const isDirty = initialSnapshot.current !== "" && snapshotOf(form) !== initialSnapshot.current;

  const handleClose = () => {
    if (!isDirty) { onClose(); return; }
    setShowConfirmLeave(true);
  };

  const canEdit = hasPermission(currentProjectRole, "edit_all_tasks") ||
    (hasPermission(currentProjectRole, "edit_own_task") && task.assignee === currentUser?.memberId);

  const availableGroups = currentProjectRole === "group_leader"
    ? groups.filter((g) => g.id === currentUser?.group?.id)
    : groups;

  useEffect(() => {
    loadComments();
    loadAttachments();
  }, [task.id]);

  useEffect(() => {
    if (form.assignee && !form.groupId) {
      for (const g of groups) {
        const found = g.members?.find((m: any) => m.id === form.assignee);
        if (found) {
          setForm(prev => ({ ...prev, groupId: g.id }));
          break;
        }
      }
    }
  }, []);

  useEffect(() => {
    let changed = false;
    const updatedSubtasks = form.subtasks.map(sub => {
      if (sub.assignee && !sub.groupId) {
        for (const g of groups) {
          const found = g.members?.find((m: any) => m.id === sub.assignee);
          if (found) {
            changed = true;
            return { ...sub, groupId: g.id };
          }
        }
      }
      return sub;
    });
    if (changed) setForm(prev => ({ ...prev, subtasks: updatedSubtasks }));
  }, []);

  const loadAttachments = async () => {
    try {
      const data = await getAttachments(task.id);
      setAttachments(data);
    } catch (err) {
      console.error("載入附件失敗:", err);
    }
  };

  const handleAddAttachment = async () => {
    if (!newAttachName.trim() || !newAttachUrl.trim()) return;
    try {
      const attachment = await addAttachment(task.id, newAttachName.trim(), newAttachUrl.trim());
      setAttachments(prev => [attachment, ...prev]);
      setNewAttachName("");
      setNewAttachUrl("");
    } catch (err) {
      console.error("新增附件失敗:", err);
    }
  };

  const handleDeleteAttachment = async (id: string) => {
    try {
      await deleteAttachment(id);
      setAttachments(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error("刪除附件失敗:", err);
    }
  };

  const loadComments = async () => {
    try {
      setLoadingComments(true);
      const data = await getComments(task.id);
      setComments(data);
    } catch (err) {
      console.error("載入評論失敗:", err);
    } finally {
      setLoadingComments(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      const comment = await addComment(task.id, newComment.trim());
      setComments(prev => [...prev, comment]);
      setNewComment("");
    } catch (err) {
      console.error("新增評論失敗:", err);
    }
  };

  const handleDeleteComment = async (id: string) => {
    try {
      await deleteComment(id);
      setComments(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      console.error("刪除評論失敗:", err);
    }
  };

  // ── Field sections (shared between mobile & desktop layouts) ─────────

  const canEditBanner = !canEdit ? (
    <div style={{ background: "#f59e0b18", border: "1px solid #f59e0b33", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#f59e0b" }}>
      你只有檢視權限，無法編輯此任務
    </div>
  ) : null;

  const titleField = (
    <div className="field">
      <label className="field-label"><Flag size={13} /> 任務名稱</label>
      <input className="field-input" value={form.title} disabled={!canEdit}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        placeholder="輸入任務名稱..." />
    </div>
  );

  const descField = (
    <div className="field">
      <label className="field-label"><AlignLeft size={13} /> 描述</label>
      <textarea className="field-input field-textarea" value={form.description} disabled={!canEdit}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        placeholder="輸入任務描述..." rows={4} />
    </div>
  );

  const priorityField = (
    <div className="field">
      <label className="field-label"><Flag size={13} /> 優先級</label>
      <div className="priority-group">
        {(["low", "medium", "high"] as Priority[]).map((p) => {
          const cfg = PRIORITY_CONFIG[p];
          const active = form.priority === p;
          return (
            <button key={p} className="priority-option"
              style={{
                background: active ? cfg.color + "22" : "transparent",
                border: `1px solid ${active ? cfg.color : "#ffffff15"}`,
                color: active ? cfg.color : "#64748b",
              }}
              onClick={() => setForm({ ...form, priority: p })}>
              {cfg.label}優先
            </button>
          );
        })}
      </div>
    </div>
  );

  const groupField = (
    <div className="field">
      <label className="field-label"><User size={13} /> 所屬組別</label>
      <select className="field-input" value={form.groupId}
        disabled={form.subtasks.length > 0}
        onChange={(e) => setForm({ ...form, groupId: e.target.value, assignee: "" })}
        style={{ opacity: form.subtasks.length > 0 ? 0.4 : 1, cursor: form.subtasks.length > 0 ? "not-allowed" : "auto" }}>
        <option value="">未分組</option>
        {availableGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </div>
  );

  const assigneeField = (
    <div className="field">
      <label className="field-label"><User size={13} /> 指派人</label>
      {form.subtasks.length > 0 ? (
        <div className="field-input" style={{ opacity: 0.4, cursor: "not-allowed", color: "#475569" }}>
          由子工項各自指派
        </div>
      ) : (() => {
        const selectedGroup = groups.find((g) => g.id === form.groupId);
        const availableMembers = selectedGroup?.members || [];
        if (form.groupId && availableMembers.length > 0) {
          return (
            <select className="field-input" value={form.assignee}
              onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
              <option value="">請選擇指派人</option>
              {availableMembers.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.id}）</option>)}
            </select>
          );
        }
        return (
          <input className="field-input" value={form.assignee}
            onChange={(e) => setForm({ ...form, assignee: e.target.value })}
            placeholder={form.groupId ? "該組別尚無成員" : "請先選擇組別"} />
        );
      })()}
    </div>
  );

  const startDateField = (
    <div className="field">
      <label className="field-label"><Calendar size={13} /> 開始日期</label>
      <input type="date" className="field-input"
        value={form.subtasks.length > 0 ? getEffectiveStartDate(form) : form.startDate}
        disabled={form.subtasks.length > 0}
        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
        style={{ colorScheme: "dark", opacity: form.subtasks.length > 0 ? 0.4 : 1, cursor: form.subtasks.length > 0 ? "not-allowed" : "auto" }} />
    </div>
  );

  const endDateField = (
    <div className="field">
      <label className="field-label"><Calendar size={13} /> 結束日期</label>
      <input type="date" className="field-input"
        value={form.subtasks.length > 0 ? getEffectiveEndDate(form) : form.endDate}
        disabled={form.subtasks.length > 0}
        onChange={(e) => setForm({ ...form, endDate: e.target.value })}
        style={{ colorScheme: "dark", opacity: form.subtasks.length > 0 ? 0.4 : 1, cursor: form.subtasks.length > 0 ? "not-allowed" : "auto" }} />
    </div>
  );

  const completionField = (
    <div className="field">
      <label className="field-label"><CheckCircle2 size={13} /> 完成度</label>
      {form.subtasks.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input type="range" min={0} max={100} value={form.completion}
            onChange={(e) => setForm({ ...form, completion: Number(e.target.value) })}
            style={{ flex: 1, accentColor: "#6366f1" }} />
          <span style={{ fontSize: 13, color: "#e2e8f0", minWidth: 36 }}>{form.completion}%</span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, height: 6, background: "#ffffff10", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${getCompletion(form)}%`, background: "#6366f1", borderRadius: 99 }} />
          </div>
          <span style={{ fontSize: 13, color: "#94a3b8", minWidth: 36 }}>{getCompletion(form)}%（自動）</span>
        </div>
      )}
    </div>
  );

  const timeLogField = form.subtasks.length === 0 ? (
    <div className="field">
      <label className="field-label"><Timer size={13} /> 工時日誌</label>
      <TimeLogEditor
        logs={form.timeLogs || []}
        onChange={(logs) => setForm({ ...form, timeLogs: logs })}
      />
    </div>
  ) : null;

  const attachmentsField = (
    <div className="field" style={{ borderTop: "1px solid #ffffff08", paddingTop: 16 }}>
      <label className="field-label" style={{ fontSize: 13 }}>📎 附件連結</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {attachments.length === 0 ? (
          <p style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: 8 }}>尚無附件</p>
        ) : attachments.map((a: any) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#0f1117", borderRadius: 8, padding: "8px 12px", border: "1px solid #ffffff08" }}>
            <span style={{ fontSize: 16 }}>📄</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={a.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, fontWeight: 600, color: "#6366f1", textDecoration: "none" }}>
                {a.name}
              </a>
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 10, color: "#475569" }}>{a.uploader?.name || ""}（{a.uploader?.memberId || ""}）</span>
                <span style={{ fontSize: 10, color: "#475569" }}>{new Date(a.createdAt).toLocaleDateString("zh-TW")}</span>
              </div>
            </div>
            {(a.uploaderId === currentUser?.id || currentUser?.role === "admin" ||
              hasPermission(currentProjectRole, "edit_all_tasks")) && (
              <button onClick={() => handleDeleteAttachment(a.id)}
                style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 2, display: "flex" }}>
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div style={{ background: "#0f1117", borderRadius: 8, padding: 10, border: "1px solid #ffffff08" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input className="field-input" value={newAttachName}
              onChange={(e) => setNewAttachName(e.target.value)}
              placeholder="附件名稱（例如：需求規格書 v2）"
              style={{ flex: 1, fontSize: 12 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="field-input" value={newAttachUrl}
              onChange={(e) => setNewAttachUrl(e.target.value)}
              placeholder="貼上 Google Drive / OneDrive / Notion 連結..."
              style={{ flex: 1, fontSize: 12 }}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddAttachment(); }} />
            <button onClick={handleAddAttachment} style={{
              background: "#6366f1", border: "none", borderRadius: 8,
              color: "#fff", fontSize: 12, fontWeight: 600,
              padding: "0 16px", cursor: "pointer", whiteSpace: "nowrap",
              height: 36, opacity: (newAttachName.trim() && newAttachUrl.trim()) ? 1 : 0.4
            }}>新增</button>
          </div>
        </div>
      )}
    </div>
  );

  const commentsField = (
    <div className="field" style={{ borderTop: "1px solid #ffffff08", paddingTop: 16 }}>
      <label className="field-label" style={{ fontSize: 13 }}>💬 評論討論</label>
      <div style={{ maxHeight: 250, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {loadingComments ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[0, 1].map((i) => (
              <div key={i} style={{ background: "#0f1117", borderRadius: 8, padding: "10px 12px", border: "1px solid #ffffff08" }}>
                <Skeleton width="40%" height={11} style={{ marginBottom: 8 }} />
                <Skeleton width="85%" height={11} />
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <p style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: 12 }}>尚無評論</p>
        ) : comments.map((c: any) => (
          <div key={c.id} style={{ background: "#0f1117", borderRadius: 8, padding: "10px 12px", border: "1px solid #ffffff08" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{c.user?.name || "未知"}</span>
                {c.user?.group && (
                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: c.user.group.color + "22", color: c.user.group.color }}>{c.user.group.name}</span>
                )}
                <span style={{ fontSize: 10, color: "#475569" }}>{new Date(c.createdAt).toLocaleString("zh-TW")}</span>
              </div>
              {(c.userId === currentUser?.id || currentUser?.role === "admin") && (
                <button onClick={() => handleDeleteComment(c.id)}
                  style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 2, display: "flex" }}>
                  <X size={11} />
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.content}</p>
          </div>
        ))}
      </div>
      {hasPermission(currentProjectRole, "edit_own_task") && (
        <div style={{ display: "flex", gap: 8 }}>
          <textarea className="field-input" value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="輸入評論..." rows={2}
            style={{ flex: 1, resize: "none" }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }} />
          <button onClick={handleAddComment} style={{
            background: "#6366f1", border: "none", borderRadius: 8,
            color: "#fff", fontSize: 12, fontWeight: 600,
            padding: "0 16px", cursor: "pointer", alignSelf: "flex-end",
            height: 36, whiteSpace: "nowrap"
          }}>發送</button>
        </div>
      )}
    </div>
  );

  const subtasksField = (
    <div className="field" style={{ flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <label className="field-label" style={{ margin: 0 }}><AlignLeft size={13} /> 子工項</label>
        <button onClick={() => {
          const newSub: SubTask = {
            id: "s" + Date.now(), title: "新子工項", description: "",
            assignee: "", groupId: "", startDate: "", endDate: "",
            completion: 0, timeLogs: []
          };
          setForm({ ...form, subtasks: [...form.subtasks, newSub] });
        }} style={{ background: "#6366f122", border: "1px solid #6366f144", borderRadius: 6, color: "#6366f1", fontSize: 12, padding: "3px 10px", cursor: "pointer" }}>
          + 新增子工項
        </button>
      </div>

      {form.subtasks.length === 0 && (
        <p style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "12px 0" }}>尚無子工項</p>
      )}

      {form.subtasks.map((sub, idx) => (
        <div key={sub.id} style={{ background: "#0f1117", border: "1px solid #ffffff10", borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <input value={sub.title} onChange={(e) => {
              const updated = [...form.subtasks];
              updated[idx] = { ...sub, title: e.target.value };
              setForm({ ...form, subtasks: updated });
            }} style={{ background: "transparent", border: "none", color: "#e2e8f0", fontSize: 13, fontWeight: 600, outline: "none", flex: 1 }} />
            <button onClick={() => setForm({ ...form, subtasks: form.subtasks.filter((_, i) => i !== idx) })}
              style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 2 }}>
              <X size={13} />
            </button>
          </div>

          <select className="field-input" value={sub.groupId || ""}
            onChange={(e) => {
              const updated = [...form.subtasks];
              updated[idx] = { ...sub, groupId: e.target.value, assignee: "" };
              setForm({ ...form, subtasks: updated });
            }}
            style={{ marginBottom: 6, fontSize: 12 }}>
            <option value="">選擇組別</option>
            {availableGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>

          {(() => {
            const subGroup = groups.find((g) => g.id === sub.groupId);
            const subMembers = subGroup?.members || [];
            if (sub.groupId && subMembers.length > 0) {
              return (
                <select className="field-input" value={sub.assignee}
                  onChange={(e) => {
                    const updated = [...form.subtasks];
                    updated[idx] = { ...sub, assignee: e.target.value };
                    setForm({ ...form, subtasks: updated });
                  }}
                  style={{ marginBottom: 6, fontSize: 12 }}>
                  <option value="">選擇指派人</option>
                  {subMembers.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.id}）</option>)}
                </select>
              );
            }
            return (
              <input placeholder={sub.groupId ? "該組別尚無成員" : "請先選擇組別"}
                disabled className="field-input"
                style={{ marginBottom: 6, fontSize: 12, opacity: 0.5 }} />
            );
          })()}

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="date" value={sub.startDate} onChange={(e) => {
              const updated = [...form.subtasks];
              updated[idx] = { ...sub, startDate: e.target.value };
              setForm({ ...form, subtasks: updated });
            }} className="field-input" style={{ flex: 1, fontSize: 12, colorScheme: "dark" }} />
            <input type="date" value={sub.endDate} onChange={(e) => {
              const updated = [...form.subtasks];
              updated[idx] = { ...sub, endDate: e.target.value };
              setForm({ ...form, subtasks: updated });
            }} className="field-input" style={{ flex: 1, fontSize: 12, colorScheme: "dark" }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="range" min={0} max={100} value={sub.completion} onChange={(e) => {
              const updated = [...form.subtasks];
              updated[idx] = { ...sub, completion: Number(e.target.value) };
              setForm({ ...form, subtasks: updated });
            }} style={{ flex: 1, accentColor: "#10b981" }} />
            <span style={{ fontSize: 12, color: "#94a3b8", minWidth: 36 }}>{sub.completion}%</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>工時日誌</label>
            <TimeLogEditor
              logs={sub.timeLogs || []}
              onChange={(logs) => {
                const updated = [...form.subtasks];
                updated[idx] = { ...sub, timeLogs: logs };
                setForm({ ...form, subtasks: updated });
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────

  const colStyle = (border?: boolean): React.CSSProperties => ({
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 18,
    overflowY: "auto",
    maxHeight: "75vh",
    scrollbarWidth: "thin",
    scrollbarColor: "#ffffff15 transparent",
    ...(border ? { borderRight: "1px solid #ffffff08" } : {}),
  });

  return (
    <div className="modal-overlay">
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">編輯任務</span>
          <button className="modal-close" onClick={handleClose}><X size={16} /></button>
        </div>

        {isDesktop ? (
          <div style={{ display: "grid", gridTemplateColumns: "40% 60%", overflow: "hidden" }}>
            <div style={colStyle(true)}>
              {canEditBanner}
              {titleField}
              {descField}
              {priorityField}
              {groupField}
              {assigneeField}
              {startDateField}
              {endDateField}
              {completionField}
              {timeLogField}
              {attachmentsField}
              {commentsField}
            </div>
            <div style={colStyle()}>
              {subtasksField}
            </div>
          </div>
        ) : (
          <div className="modal-body">
            {canEditBanner}
            {titleField}
            {descField}
            {priorityField}
            {groupField}
            {assigneeField}
            {startDateField}
            {endDateField}
            {completionField}
            {subtasksField}
            {timeLogField}
            {attachmentsField}
            {commentsField}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn-cancel" onClick={handleClose}>關閉</button>
          {canEdit && (
            <button className="btn-save" onClick={() => { onSave(form); onClose(); }}>儲存變更</button>
          )}
        </div>
      </div>

      {showConfirmLeave && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "#00000090",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1a2030", borderRadius: 12, padding: 24, width: 340,
            border: "1px solid #ffffff15", boxShadow: "0 24px 64px #000a",
          }}>
            <p style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, marginBottom: 8 }}>有尚未儲存的變更</p>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              確定要離開嗎？所有未儲存的內容將會遺失。
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-cancel" onClick={() => setShowConfirmLeave(false)} style={{ flex: 1 }}>取消</button>
              <button onClick={() => { setShowConfirmLeave(false); onClose(); }} style={{
                flex: 1, background: "#ef4444", border: "none", borderRadius: 8,
                color: "#fff", fontSize: 13, fontWeight: 600, padding: 10, cursor: "pointer",
              }}>確定離開</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Task Card ────────────────────────────────────────────────────────
