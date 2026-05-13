import { useState, useEffect, type ReactElement } from "react";
import {
  exportTaskListCSV, exportTaskListPDF,
  exportTimeReportCSV, exportTimeReportPDF,
  exportGanttPNG
} from "./exportUtils";
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  DndContext, type DragEndEvent, type DragOverEvent, DragOverlay, type DragStartEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X, GripVertical, Circle, Clock, CheckCircle2, AlertCircle, User, AlignLeft, Flag, Timer, Calendar, BarChart2, Search } from "lucide-react";

type Priority = "low" | "medium" | "high";
type TimeLog = {
  id: string;
  date: string;
  hours: number;
};
type SubTask = {
  id: string;
  title: string;
  description: string;
  assignee: string;
  groupId: string;
  startDate: string;
  endDate: string;
  completion: number;
  timeLogs: TimeLog[];
};
type Task = {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  assignee: string;
  timeLogs: TimeLog[];
  startDate: string;
  endDate: string;
  completion: number;
  subtasks: SubTask[];
  groupId: string;
};
type Column = { id: string; title: string; tasks: Task[] };
type Member = {
  id: string;
  name: string;
};
type Group = {
  id: string;
  name: string;
  color: string;
  members: Member[];
};
type MeetingRecord = {
  id: string;
  date: string;
  attendees: string[];
  summary: string;
  externalLink: string;
};

type MeetingSeries = {
  id: string;
  name: string;
  type: "regular" | "adhoc";
  records: MeetingRecord[];
};

type Project = {
  id: string;
  name: string;
  description: string;
  color: string;
  columns: Column[];
  groups: Group[];
  meetings: MeetingSeries[];
};

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  low:    { label: "低",  color: "#4ade80" },
  medium: { label: "中",  color: "#facc15" },
  high:   { label: "高",  color: "#f87171" },
};

const COLUMN_ICONS: Record<string, ReactElement> = {
  todo:       <Circle size={14} />,
  inprogress: <Clock size={14} />,
  review:     <AlertCircle size={14} />,
  done:       <CheckCircle2 size={14} />,
};

const COLUMN_COLORS: Record<string, string> = {
  todo: "#6366f1", inprogress: "#f59e0b", review: "#8b5cf6", done: "#10b981",
};

const initialColumns: Column[] = [
  {
    id: "todo", title: "待處理",
    tasks: [
      { id: "t1", title: "需求分析文件", description: "整理客戶訪談結果，輸出需求規格書", priority: "high", assignee: "Peter", timeLogs: [], startDate: "", endDate: "", completion: 0, subtasks: [], groupId: "" },
      { id: "t2", title: "UI 原型設計", description: "使用 Figma 製作低保真原型", priority: "medium", assignee: "Amy", timeLogs: [], startDate: "", endDate: "", completion: 0, subtasks: [], groupId: "" },
    ],
  },
  {
    id: "inprogress", title: "進行中",
    tasks: [
      { id: "t3", title: "後端 API 開發", description: "實作任務管理 CRUD endpoints", priority: "high", assignee: "John", timeLogs: [], startDate: "", endDate: "", completion: 0, subtasks: [], groupId: "" },
      { id: "t4", title: "資料庫設計", description: "設計 PostgreSQL schema 與索引", priority: "medium", assignee: "Peter", timeLogs: [], startDate: "", endDate: "", completion: 0, subtasks: [], groupId: "" },
    ],
  },
  {
    id: "review", title: "審查中",
    tasks: [
      { id: "t5", title: "前端看板元件", description: "實作拖拉排序看板介面", priority: "medium", assignee: "Amy", timeLogs: [], startDate: "", endDate: "", completion: 0, subtasks: [], groupId: "" },
    ],
  },
  {
    id: "done", title: "已完成",
    tasks: [
      { id: "t6", title: "專案環境建置", description: "完成 Vite + React + TS 環境設定", priority: "low", assignee: "Peter", timeLogs: [], startDate: "", endDate: "", completion: 0, subtasks: [], groupId: "" },
    ],
  },
];

const PROJECT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#06b6d4"];

const DEFAULT_GROUPS: Group[] = [
  { id: "g1", name: "專管組", color: "#6366f1", members: [{ id: "A001", name: "Peter" }] },
  { id: "g2", name: "美術組", color: "#f59e0b", members: [] },
  { id: "g3", name: "設計組", color: "#8b5cf6", members: [] },
  { id: "g4", name: "硬體組", color: "#10b981", members: [] },
  { id: "g5", name: "軟體組", color: "#06b6d4", members: [] },
  { id: "g6", name: "維運組", color: "#f43f5e", members: [] },
  { id: "g7", name: "費曼圖", color: "#facc15", members: [] },
];

const initialProjects: Project[] = [
  {
    id: "p1",
    name: "專案管理軟體開發",
    description: "PM Dashboard 系統開發專案",
    color: "#6366f1",
    groups: DEFAULT_GROUPS,
    columns: initialColumns,
    meetings: [],
  },
];

function getTotalHours(logs: TimeLog[]): number {
  return Math.round(logs.reduce((sum, l) => sum + l.hours, 0) * 10) / 10;
}

function memberDisplay(member: Member): string {
  return `${member.name}（${member.id}）`;
}

function findMemberById(groups: Group[], memberId: string): Member | undefined {
  for (const g of groups) {
    const found = g.members.find((m) => m.id === memberId);
    if (found) return found;
  }
  return undefined;
}

function getEffectiveStartDate(task: Task): string {
  if (task.subtasks.length === 0) return task.startDate;
  const dates = task.subtasks.filter((s) => s.startDate).map((s) => s.startDate);
  if (dates.length === 0) return task.startDate;
  return dates.sort()[0];
}

function getEffectiveEndDate(task: Task): string {
  if (task.subtasks.length === 0) return task.endDate;
  const dates = task.subtasks.filter((s) => s.endDate).map((s) => s.endDate);
  if (dates.length === 0) return task.endDate;
  return dates.sort().reverse()[0];
}

function getCompletion(task: Task): number {
  if (task.subtasks.length === 0) return task.completion;
  const avg = task.subtasks.reduce((sum, s) => sum + s.completion, 0) / task.subtasks.length;
  return Math.round(avg);
}

// ── Task Edit Modal ──────────────────────────────────────────────────
function TaskModal({ task, groups, onSave, onClose }: {
  task: Task;
  groups: Group[];
  onSave: (updated: Task) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Task>({ ...task });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">編輯任務</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="field-label"><Flag size={13} /> 任務名稱</label>
            <input className="field-input" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="輸入任務名稱..." />
          </div>

          <div className="field">
            <label className="field-label"><AlignLeft size={13} /> 描述</label>
            <textarea className="field-input field-textarea" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="輸入任務描述..." rows={4} />
          </div>

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

          <div className="field">
            <label className="field-label"><User size={13} /> 所屬組別</label>
            <select className="field-input" value={form.groupId}
              disabled={form.subtasks.length > 0}
              onChange={(e) => setForm({ ...form, groupId: e.target.value, assignee: "" })}
              style={{ opacity: form.subtasks.length > 0 ? 0.4 : 1, cursor: form.subtasks.length > 0 ? "not-allowed" : "auto" }}>
              <option value="">未分組</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>

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

          <div className="field">
            <label className="field-label"><Calendar size={13} /> 開始日期</label>
            <input
              type="date"
              className="field-input"
              value={form.subtasks.length > 0 ? getEffectiveStartDate(form) : form.startDate}
              disabled={form.subtasks.length > 0}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              style={{ colorScheme: "dark", opacity: form.subtasks.length > 0 ? 0.4 : 1, cursor: form.subtasks.length > 0 ? "not-allowed" : "auto" }}
            />
          </div>

          <div className="field">
            <label className="field-label"><Calendar size={13} /> 結束日期</label>
            <input
              type="date"
              className="field-input"
              value={form.subtasks.length > 0 ? getEffectiveEndDate(form) : form.endDate}
              disabled={form.subtasks.length > 0}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              style={{ colorScheme: "dark", opacity: form.subtasks.length > 0 ? 0.4 : 1, cursor: form.subtasks.length > 0 ? "not-allowed" : "auto" }}
            />
          </div>

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

          <div className="field">
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

                {/* 子工項組別選擇 */}
                <select className="field-input" value={sub.groupId || ""}
                  onChange={(e) => {
                    const updated = [...form.subtasks];
                    updated[idx] = { ...sub, groupId: e.target.value, assignee: "" };
                    setForm({ ...form, subtasks: updated });
                  }}
                  style={{ marginBottom: 6, fontSize: 12 }}>
                  <option value="">選擇組別</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>

                {/* 子工項指派人 */}
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

          {form.subtasks.length === 0 && (
            <div className="field">
              <label className="field-label"><Timer size={13} /> 工時日誌</label>
              <TimeLogEditor
                logs={form.timeLogs || []}
                onChange={(logs) => setForm({ ...form, timeLogs: logs })}
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => { onSave(form); onClose(); }}>儲存變更</button>
        </div>
      </div>
    </div>
  );
}

// ── Task Card ────────────────────────────────────────────────────────
function TaskCard({ task, isDragging = false, onClick, groups = [] }: {
  task: Task; isDragging?: boolean; onClick?: () => void; groups?: Group[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortableDragging } =
    useSortable({ id: task.id });

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isSortableDragging ? 0.3 : 1 };
  const p = PRIORITY_CONFIG[task.priority];

  return (
    <div ref={setNodeRef} style={style} className={`task-card ${isDragging ? "dragging" : ""}`} onClick={onClick}>
      <div className="task-header">
        <span className="priority-badge" style={{ background: p.color + "22", color: p.color, border: `1px solid ${p.color}44` }}>
          {p.label}優先
        </span>
        <button className="drag-handle" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
          <GripVertical size={14} />
        </button>
      </div>
      <p className="task-title">{task.title}</p>
      {task.description && <p className="task-desc">{task.description}</p>}
      <div style={{ margin: "8px 0 6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: "#64748b" }}>完成度</span>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>{getCompletion(task)}%</span>
        </div>
        <div style={{ height: 4, background: "#ffffff10", borderRadius: 99, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 99,
            width: `${getCompletion(task)}%`,
            background: getCompletion(task) === 100 ? "#10b981" : "#6366f1",
            transition: "width .3s"
          }} />
        </div>
      </div>
      <div className="task-footer">
        <span className="assignee">
          {(() => {
            const member = findMemberById(groups, task.assignee);
            return member ? member.name : task.assignee || "未指派";
          })()}
        </span>
      </div>
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────────
function ColumnComponent({ column, onAddTask, onDeleteTask, onEditTask, groups }: {
  column: Column;
  onAddTask: (colId: string, title: string) => void;
  onDeleteTask: (colId: string, taskId: string) => void;
  onEditTask: (task: Task) => void;
  groups: Group[];
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const color = COLUMN_COLORS[column.id] || "#6366f1";
  const icon = COLUMN_ICONS[column.id];

  const handleAdd = () => {
    if (newTitle.trim()) { onAddTask(column.id, newTitle.trim()); setNewTitle(""); setAdding(false); }
  };

  return (
    <div className="column">
      <div className="column-header" style={{ borderTop: `3px solid ${color}` }}>
        <div className="column-title-row">
          <span style={{ color }}>{icon}</span>
          <span className="column-title">{column.title}</span>
          <span className="task-count" style={{ background: color + "22", color }}>{column.tasks.length}</span>
        </div>
        <button className="add-btn" onClick={() => setAdding(true)} style={{ color }}><Plus size={15} /></button>
      </div>

      <SortableContext items={column.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list">
          {column.tasks.map((task) => (
            <div key={task.id} style={{ position: "relative" }}>
              <TaskCard task={task} onClick={() => onEditTask(task)} groups={groups} />
              <button className="delete-task" onClick={(e) => { e.stopPropagation(); onDeleteTask(column.id, task.id); }}>
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      </SortableContext>

      {adding && (
        <div className="add-form">
          <input autoFocus className="add-input" placeholder="輸入任務名稱..."
            value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }} />
          <div className="add-form-actions">
            <button className="confirm-btn" onClick={handleAdd}>新增</button>
            <button className="cancel-btn" onClick={() => setAdding(false)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Project Modal ─────────────────────────────────────────────────────
function ProjectModal({ onSave, onClose, existing }: {
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
function MemberInput({ onAdd, color }: { onAdd: (member: Member) => void; color: string }) {
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
function TimeLogEditor({ logs, onChange }: {
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

// ── Group Modal ───────────────────────────────────────────────────────
function GroupModal({ groups, onSave, onClose }: {
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

// ── Sidebar ──────────────────────────────────────────────────────────
function Sidebar({ view, setView, projects, activeProjectId, setActiveProjectId, onAddProject, onDeleteProject, onManageGroups }: {
  view: "kanban" | "gantt" | "dashboard" | "meetings";
  setView: (v: "kanban" | "gantt" | "dashboard" | "meetings") => void;
  projects: Project[];
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  onAddProject: () => void;
  onDeleteProject: (id: string) => void;
  onManageGroups: () => void;
}) {
  const items = [
    { id: "kanban",    label: "看板",     icon: <Circle size={16} /> },
    { id: "gantt",     label: "甘特圖",   icon: <Clock size={16} /> },
    { id: "dashboard", label: "儀表板",   icon: <BarChart2 size={16} /> },
    { id: "meetings",  label: "會議記錄", icon: <AlignLeft size={16} /> },
  ] as const;

  return (
    <div style={{
      width: 200, minHeight: "100vh", background: "#111827",
      borderRight: "1px solid #ffffff08", padding: "24px 12px",
      display: "flex", flexDirection: "column", gap: 4,
      position: "fixed", top: 0, left: 0, zIndex: 50, overflowY: "auto"
    }}>
      {/* Logo */}
      <div style={{ padding: "0 8px 20px" }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", letterSpacing: -0.5 }}>專案管理</p>
        <p style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>PM Dashboard</p>
      </div>

      {/* 專案列表 */}
      <div style={{ paddingBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 10px" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: ".05em" }}>專案</span>
          <button onClick={onAddProject} style={{
            background: "none", border: "none", color: "#475569", cursor: "pointer",
            padding: 2, display: "flex", borderRadius: 4, transition: "color .15s"
          }}><Plus size={14} /></button>
        </div>

        {projects.map((p) => {
          const active = p.id === activeProjectId;
          return (
            <div key={p.id} style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <button onClick={() => setActiveProjectId(p.id)} style={{
                flex: 1, display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 8, border: "none",
                background: active ? p.color + "18" : "transparent",
                color: active ? p.color : "#64748b",
                fontSize: 12, fontWeight: active ? 600 : 400,
                cursor: "pointer", textAlign: "left", transition: "all .15s",
                borderLeft: active ? `3px solid ${p.color}` : "3px solid transparent",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>
                <div style={{ width: 8, height: 8, borderRadius: 99, background: p.color, flexShrink: 0 }} />
                {p.name}
              </button>
              {projects.length > 1 && (
                <button onClick={() => onDeleteProject(p.id)} style={{
                  position: "absolute", right: 6,
                  background: "none", border: "none", color: "#ef4444",
                  cursor: "pointer", padding: 2, display: "none", borderRadius: 4
                }} className="delete-project">
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 分隔線 */}
      <div style={{ borderTop: "1px solid #ffffff08", marginBottom: 12 }} />

      {/* 視圖切換 */}
      {items.map((item) => {
        const active = view === item.id;
        return (
          <button key={item.id} onClick={() => setView(item.id)} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 8, border: "none",
            background: active ? "#6366f122" : "transparent",
            color: active ? "#6366f1" : "#64748b",
            fontSize: 13, fontWeight: active ? 600 : 400,
            cursor: "pointer", textAlign: "left", transition: "all .15s",
            borderLeft: active ? "3px solid #6366f1" : "3px solid transparent"
          }}>
            {item.icon}{item.label}
          </button>
        );
      })}

      {/* 管理組別 */}
      <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid #ffffff08" }}>
        <button onClick={onManageGroups} style={{
          display: "flex", alignItems: "center", gap: 10,
          width: "100%", padding: "10px 12px", borderRadius: 8, border: "none",
          background: "transparent", color: "#64748b",
          fontSize: 13, cursor: "pointer", textAlign: "left", transition: "all .15s",
          borderLeft: "3px solid transparent"
        }}>
          <User size={16} />管理組別與成員
        </button>
      </div>
    </div>
  );
}

// ── Meetings View ────────────────────────────────────────────────────
function NewRecordForm({ groups, onSave, onCancel }: {
  groups: Group[];
  onSave: (record: MeetingRecord) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [externalLink, setExternalLink] = useState("");

  const toggleAttendee = (name: string) =>
    setAttendees((prev) => prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]);

  const filteredMembers: Member[] = selectedGroupIds.length === 0
    ? []
    : (() => {
        const map = new Map<string, Member>();
        groups.filter((g) => selectedGroupIds.includes(g.id))
          .flatMap((g) => g.members || [])
          .forEach((m) => map.set(m.id, m));
        return Array.from(map.values());
      })();

  return (
    <div style={{ background: "#1a2030", borderRadius: 10, padding: 16, border: "1px solid #6366f133" }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 12 }}>新增會議紀錄</p>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>日期</label>
        <input type="date" className="field-input" value={date}
          onChange={(e) => setDate(e.target.value)} style={{ colorScheme: "dark" }} />
      </div>

      {/* 組別篩選 */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 6, display: "block" }}>選擇組別</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {groups.map((g) => {
            const active = selectedGroupIds.includes(g.id);
            return (
              <button key={g.id} onClick={() => {
                if (active) {
                  const newIds = selectedGroupIds.filter((x) => x !== g.id);
                  setSelectedGroupIds(newIds);
                  const remainingIds = groups.filter((gr) => newIds.includes(gr.id))
                    .flatMap((gr) => gr.members || []).map((m) => m.id);
                  setAttendees(attendees.filter((a) => remainingIds.includes(a)));
                } else {
                  setSelectedGroupIds([...selectedGroupIds, g.id]);
                }
              }} style={{
                background: active ? g.color + "22" : "transparent",
                border: `1px solid ${active ? g.color : "#ffffff15"}`,
                color: active ? g.color : "#64748b",
                borderRadius: 8, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer"
              }}>{g.name}</button>
            );
          })}
        </div>
      </div>

      {/* 出席人員 */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 6, display: "block" }}>出席人員</label>
        {selectedGroupIds.length === 0 ? (
          <p style={{ fontSize: 11, color: "#475569" }}>請先選擇組別</p>
        ) : filteredMembers.length === 0 ? (
          <p style={{ fontSize: 11, color: "#475569" }}>所選組別尚無成員</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {filteredMembers.map((m) => {
              const active = attendees.includes(m.id);
              const memberGroup = groups.find((g) => selectedGroupIds.includes(g.id) && g.members.some((gm) => gm.id === m.id));
              const mColor = memberGroup?.color || "#6366f1";
              return (
                <button key={m.id} onClick={() => toggleAttendee(m.id)} style={{
                  background: active ? mColor + "22" : "transparent",
                  border: `1px solid ${active ? mColor : "#ffffff15"}`,
                  color: active ? mColor : "#64748b",
                  borderRadius: 99, padding: "4px 12px", fontSize: 11, cursor: "pointer"
                }}>{memberDisplay(m)}</button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>會議摘要（結論 + 行動事項）</label>
        <textarea className="field-input field-textarea" value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="輸入會議重點結論與待辦事項..." rows={4} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>外部連結（選填）</label>
        <input className="field-input" value={externalLink}
          onChange={(e) => setExternalLink(e.target.value)}
          placeholder="貼上 Google Docs / Notion 連結..." />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-cancel" style={{ flex: 1 }} onClick={onCancel}>取消</button>
        <button className="btn-save" style={{ flex: 2 }} onClick={() => {
          if (date) onSave({ id: "mr" + Date.now(), date, attendees, summary, externalLink });
        }}>儲存紀錄</button>
      </div>
    </div>
  );
}

function NewSeriesModal({ onSave, onClose }: {
  onSave: (series: MeetingSeries) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"regular" | "adhoc">("regular");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">新增會議系列</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-label"><Flag size={13} /> 會議名稱</label>
            <input className="field-input" value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：每週專案進度會議" />
          </div>
          <div className="field">
            <label className="field-label"><Flag size={13} /> 會議類型</label>
            <div style={{ display: "flex", gap: 8 }}>
              {([["regular", "定期會議", "#6366f1"], ["adhoc", "臨時會議", "#f59e0b"]] as const).map(([val, label, color]) => (
                <button key={val} onClick={() => setType(val)} style={{
                  flex: 1, borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  background: type === val ? color + "22" : "transparent",
                  border: `1px solid ${type === val ? color : "#ffffff15"}`,
                  color: type === val ? color : "#64748b"
                }}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => {
            if (name.trim()) {
              onSave({ id: "ms" + Date.now(), name: name.trim(), type, records: [] });
              onClose();
            }
          }}>建立</button>
        </div>
      </div>
    </div>
  );
}

function MeetingsView({ meetings, groups, onUpdate }: {
  meetings: MeetingSeries[];
  groups: Group[];
  onUpdate: (meetings: MeetingSeries[]) => void;
}) {
  const [showSeriesModal, setShowSeriesModal] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [addingRecordId, setAddingRecordId] = useState<string | null>(null);

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleDeleteSeries = (id: string) => onUpdate(meetings.filter((m) => m.id !== id));

  const handleDeleteRecord = (seriesId: string, recordId: string) =>
    onUpdate(meetings.map((m) =>
      m.id === seriesId ? { ...m, records: m.records.filter((r) => r.id !== recordId) } : m
    ));

  const renderSeries = (series: MeetingSeries) => {
    const isExpanded = expandedIds.includes(series.id);
    const typeColor = series.type === "regular" ? "#6366f1" : "#f59e0b";
    const typeLabel = series.type === "regular" ? "定期" : "臨時";

    return (
      <div key={series.id} style={{ background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", overflow: "hidden" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", background: "#1a2030", cursor: "pointer",
          borderBottom: isExpanded ? "1px solid #ffffff08" : "none"
        }} onClick={() => toggleExpand(series.id)}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
              background: typeColor + "22", color: typeColor, border: `1px solid ${typeColor}44`
            }}>{typeLabel}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{series.name}</span>
            <span style={{ fontSize: 11, color: "#475569" }}>{series.records.length} 筆紀錄</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={(e) => {
              e.stopPropagation();
              setAddingRecordId(series.id);
              setExpandedIds((prev) => prev.includes(series.id) ? prev : [...prev, series.id]);
            }} style={{ background: "#10b98122", border: "1px solid #10b98144", borderRadius: 6, color: "#10b981", fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>
              + 新增紀錄
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleDeleteSeries(series.id); }}
              style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 4, display: "flex" }}>
              <X size={14} />
            </button>
            <span style={{ color: "#475569", fontSize: 14, transition: "transform .2s", display: "inline-block", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
          </div>
        </div>

        {isExpanded && (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {addingRecordId === series.id && (
              <NewRecordForm
                groups={groups}
                onSave={(record) => {
                  onUpdate(meetings.map((m) =>
                    m.id === series.id ? { ...m, records: [record, ...m.records] } : m
                  ));
                  setAddingRecordId(null);
                }}
                onCancel={() => setAddingRecordId(null)}
              />
            )}

            {series.records.length === 0 && addingRecordId !== series.id && (
              <p style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: 16 }}>尚無會議紀錄</p>
            )}

            {series.records.map((record) => (
              <div key={record.id} style={{ background: "#0f1117", borderRadius: 10, padding: 14, border: "1px solid #ffffff08" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{record.date}</span>
                  <button onClick={() => handleDeleteRecord(series.id, record.id)}
                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 2, display: "flex" }}>
                    <X size={12} />
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                  {record.attendees.map((aId) => {
                    const member = findMemberById(groups, aId);
                    return (
                      <span key={aId} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "#6366f118", color: "#6366f1", border: "1px solid #6366f133" }}>
                        {member ? member.name : aId}
                      </span>
                    );
                  })}
                </div>
                {record.summary && (
                  <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 8, whiteSpace: "pre-wrap" }}>{record.summary}</p>
                )}
                {record.externalLink && (
                  <a href={record.externalLink} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "#6366f1", textDecoration: "none" }}>
                    📎 查看完整記錄 →
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const regularMeetings = meetings.filter((m) => m.type === "regular");
  const adhocMeetings   = meetings.filter((m) => m.type === "adhoc");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setShowSeriesModal(true)} style={{
          background: "#6366f122", border: "1px solid #6366f144",
          borderRadius: 8, color: "#6366f1", fontSize: 13, fontWeight: 600,
          padding: "8px 20px", cursor: "pointer"
        }}>+ 新增會議系列</button>
      </div>

      {regularMeetings.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>定期會議</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{regularMeetings.map(renderSeries)}</div>
        </div>
      )}

      {adhocMeetings.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>臨時會議</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{adhocMeetings.map(renderSeries)}</div>
        </div>
      )}

      {meetings.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, color: "#475569", gap: 12 }}>
          <p style={{ fontSize: 48 }}>📋</p>
          <p style={{ fontSize: 15 }}>尚無會議記錄</p>
          <p style={{ fontSize: 13 }}>點右上角「+ 新增會議系列」開始</p>
        </div>
      )}

      {showSeriesModal && (
        <NewSeriesModal
          onSave={(series) => { onUpdate([...meetings, series]); setShowSeriesModal(false); }}
          onClose={() => setShowSeriesModal(false)}
        />
      )}
    </div>
  );
}

// ── Dashboard View ───────────────────────────────────────────────────
function DashboardView({ columns, groups }: { columns: Column[]; groups: Group[] }) {
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  const allTasks = columns.flatMap((c) => c.tasks);
  const allSubtasks = allTasks.flatMap((t) => t.subtasks);

  const columnData = columns.map((c) => ({ name: c.title, 數量: c.tasks.length }));

  const priorityCount = { high: 0, medium: 0, low: 0 };
  allTasks.forEach((t) => { priorityCount[t.priority]++; });
  const priorityData = [
    { name: "高優先", value: priorityCount.high, color: "#f87171" },
    { name: "中優先", value: priorityCount.medium, color: "#facc15" },
    { name: "低優先", value: priorityCount.low, color: "#4ade80" },
  ].filter((d) => d.value > 0);

  const groupTaskData: { id: string; name: string; 任務數: number; color: string }[] = groups.map((g) => {
    const count = allTasks.filter((t) => t.groupId === g.id).length;
    return { id: g.id, name: g.name, 任務數: count, color: g.color };
  }).filter((d) => d.任務數 > 0);
  const ungroupedCount = allTasks.filter((t) => !t.groupId).length;
  if (ungroupedCount > 0) {
    groupTaskData.push({ id: "none", name: "未分組", 任務數: ungroupedCount, color: "#475569" });
  }

  const hoursMap: Record<string, number> = {};
  allTasks.forEach((t) => {
    if (t.subtasks.length === 0 && t.assignee) {
      hoursMap[t.assignee] = (hoursMap[t.assignee] || 0) + getTotalHours(t.timeLogs || []);
    }
  });
  allTasks.forEach((t) => {
    t.subtasks.forEach((s) => {
      if (s.assignee) {
        hoursMap[s.assignee] = (hoursMap[s.assignee] || 0) + getTotalHours(s.timeLogs || []);
      }
    });
  });
  const hoursData = Object.entries(hoursMap).map(([memberId, hours]) => {
    const member = findMemberById(groups, memberId);
    return { name: member ? member.name : memberId, 工時: Math.round(hours * 10) / 10 };
  });

  const totalCompletion = allTasks.length > 0
    ? Math.round(allTasks.reduce((sum, t) => sum + getCompletion(t), 0) / allTasks.length)
    : 0;

  const doneTasks = columns.find((c) => c.id === "done")?.tasks.length ?? 0;

  const TOOLTIP_STYLE = {
    background: "#1a2030", border: "1px solid #ffffff15",
    borderRadius: 8, color: "#e2e8f0", fontSize: 12
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[
          { label: "總任務數", value: allTasks.length, color: "#6366f1" },
          { label: "已完成", value: doneTasks, color: "#10b981" },
          { label: "整體完成度", value: `${totalCompletion}%`, color: "#f59e0b" },
          { label: "子工項數", value: allSubtasks.length, color: "#8b5cf6" },
        ].map((card) => (
          <div key={card.label} style={{
            background: "#161b27", borderRadius: 12, padding: "20px 24px",
            border: `1px solid ${card.color}22`
          }}>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{card.label}</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{card.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>各階段任務數</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={columnData} barSize={32}>
              <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff06" }} />
              <Bar dataKey="數量" radius={[6, 6, 0, 0]}>
                {columnData.map((_, i) => (
                  <Cell key={i} fill={["#6366f1", "#f59e0b", "#8b5cf6", "#10b981"][i % 4]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>優先級分布</p>
          {priorityData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>尚無資料</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <ResponsiveContainer width="60%" height={200}>
                <PieChart>
                  <Pie data={priorityData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                    {priorityData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {priorityData.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 99, background: d.color }} />
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>{d.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>各組別任務數</p>
          {groupTaskData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>尚無資料</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={groupTaskData} barSize={32} layout="vertical">
                <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff06" }} />
                <Bar dataKey="任務數" radius={[0, 6, 6, 0]} cursor="pointer"
                  onClick={(data: { id?: string }) => {
                    const group = groups.find((g) => g.id === data.id);
                    if (group) setSelectedGroup(group);
                  }}>
                  {groupTaskData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>點擊組別查看成員工項與工時</p>
        </div>

        <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>各成員累計工時（小時）</p>
          {hoursData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>尚無計時紀錄</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hoursData} barSize={32} layout="vertical">
                <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff06" }} />
                <Bar dataKey="工時" fill="#10b981" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {selectedGroup && (() => {
        const groupTasks = allTasks.filter((t) => t.groupId === selectedGroup.id);

        const memberStats: Record<string, { tasks: string[]; hours: number }> = {};

        groupTasks.forEach((t) => {
          if (t.subtasks.length === 0 && t.assignee) {
            if (!memberStats[t.assignee]) memberStats[t.assignee] = { tasks: [], hours: 0 };
            memberStats[t.assignee].tasks.push(t.title);
            memberStats[t.assignee].hours += getTotalHours(t.timeLogs || []);
          }
        });

        groupTasks.forEach((t) => {
          t.subtasks.forEach((s) => {
            if (s.assignee) {
              if (!memberStats[s.assignee]) memberStats[s.assignee] = { tasks: [], hours: 0 };
              memberStats[s.assignee].tasks.push(`${t.title} → ${s.title}`);
              memberStats[s.assignee].hours += getTotalHours(s.timeLogs || []);
            }
          });
        });

        selectedGroup.members.forEach((m) => {
          if (!memberStats[m.id]) memberStats[m.id] = { tasks: [], hours: 0 };
        });

        const memberList = Object.entries(memberStats).sort((a, b) => a[0].localeCompare(b[0]));

        return (
          <div className="modal-overlay" onClick={() => setSelectedGroup(null)}>
            <div className="modal" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 99, background: selectedGroup.color }} />
                  <span className="modal-label">{selectedGroup.name} — 成員工項與工時</span>
                </div>
                <button className="modal-close" onClick={() => setSelectedGroup(null)}><X size={16} /></button>
              </div>
              <div className="modal-body" style={{ maxHeight: "65vh", overflowY: "auto" }}>
                {memberList.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#475569", textAlign: "center", padding: 20 }}>該組別尚無成員</p>
                ) : (
                  memberList.map(([memberId, stats]) => {
                    const member = findMemberById([selectedGroup], memberId);
                    const displayName = member ? memberDisplay(member) : memberId;
                    return (
                      <div key={memberId} style={{ background: "#0f1117", borderRadius: 10, padding: 14, border: "1px solid #ffffff08" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{displayName}</span>
                          <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: "#10b98122", color: "#10b981", border: "1px solid #10b98133" }}>
                            工時：{stats.hours > 0 ? `${Math.round(stats.hours * 10) / 10} 小時` : "0 小時"}
                          </span>
                        </div>
                        {stats.tasks.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {stats.tasks.map((taskName, i) => (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8" }}>
                                <div style={{ width: 4, height: 4, borderRadius: 99, background: selectedGroup.color, flexShrink: 0 }} />
                                {taskName}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ fontSize: 12, color: "#475569" }}>尚無指派工項</p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="modal-footer">
                <button className="btn-save" style={{ flex: 1 }} onClick={() => setSelectedGroup(null)}>關閉</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Gantt View ───────────────────────────────────────────────────────
function GanttView({ columns, groups, onEditTask }: {
  columns: Column[];
  groups: Group[];
  onEditTask: (task: Task) => void;
}) {
  const allTasks = columns.flatMap((col) => col.tasks);
  const tasksWithDates = allTasks
    .filter((t) => getEffectiveStartDate(t) && getEffectiveEndDate(t))
    .sort((a, b) => new Date(getEffectiveStartDate(a)).getTime() - new Date(getEffectiveStartDate(b)).getTime());

  if (tasksWithDates.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, color: "#475569", gap: 8 }}>
        <p style={{ fontSize: 15 }}>尚無設定日期的任務</p>
        <p style={{ fontSize: 13 }}>請先在任務編輯視窗設定開始與結束日期</p>
      </div>
    );
  }

  const allDates = tasksWithDates.flatMap((t) => [
    new Date(getEffectiveStartDate(t)),
    new Date(getEffectiveEndDate(t))
  ]);
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 2);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000);
  const dayWidth = Math.max(32, Math.min(60, 800 / totalDays));
  const rowHeight = 44;
  const groupWidth = 80;
  const labelWidth = 180;
  const frozenWidth = groupWidth + labelWidth;

  const days: Date[] = [];
  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(minDate);
    d.setDate(minDate.getDate() + i);
    days.push(d);
  }

  const months: { label: string; span: number }[] = [];
  days.forEach((d) => {
    const label = `${d.getFullYear()}/${d.getMonth() + 1}`;
    if (months.length === 0 || months[months.length - 1].label !== label) {
      months.push({ label, span: 1 });
    } else {
      months[months.length - 1].span++;
    }
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function dayOffset(date: Date) {
    return Math.floor((date.getTime() - minDate.getTime()) / 86400000);
  }

  return (
    <div id="gantt-container" style={{ display: "flex", background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", overflow: "hidden" }}>

      {/* 凍結左側面板 */}
      <div style={{ minWidth: frozenWidth, flexShrink: 0, zIndex: 1, borderRight: "1px solid #ffffff12" }}>
        {/* 月份列佔位 */}
        <div style={{ height: 37, background: "#1a2030", borderBottom: "1px solid #ffffff08", display: "flex", alignItems: "center", paddingLeft: 14 }}>
          <span style={{ fontSize: 11, color: "#475569" }}>組別 / 任務名稱</span>
        </div>
        {/* 日期列佔位 */}
        <div style={{ height: 33, background: "#1a2030", borderBottom: "1px solid #ffffff10" }} />

        {/* 任務列 */}
        {tasksWithDates.map((task) => {
          const group = groups.find((g) => g.id === task.groupId);
          return (
            <div key={task.id}>
              <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ffffff06", height: rowHeight }}>
                {/* 組別徽章 */}
                <div style={{ minWidth: groupWidth, padding: "0 6px", display: "flex", justifyContent: "center" }}>
                  {group && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 6px",
                      borderRadius: 4, background: group.color + "22",
                      border: `1px solid ${group.color}55`, color: group.color,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      maxWidth: groupWidth - 12
                    }}>{group.name}</span>
                  )}
                </div>
                {/* 任務名稱 */}
                <div style={{
                  minWidth: labelWidth, padding: "0 14px",
                  fontSize: 12, fontWeight: 600, color: "#cbd5e1",
                  cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                }} onClick={() => onEditTask(task)}>{task.title}</div>
              </div>

              {task.subtasks
                .filter((s) => s.startDate && s.endDate)
                .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                .map((sub) => (
                  <div key={sub.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ffffff04", height: 36, background: "#ffffff02" }}>
                    <div style={{ minWidth: groupWidth }} />
                    <div style={{
                      minWidth: labelWidth, padding: "0 14px 0 28px",
                      fontSize: 11, color: "#64748b",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                    }}>↳ {sub.title}</div>
                  </div>
                ))}
            </div>
          );
        })}
      </div>

      {/* 可捲動右側面板 */}
      <div style={{ overflowX: "auto", position: "relative", flex: 1 }}>
        <div style={{ minWidth: days.length * dayWidth }}>

          {/* 月份列 */}
          <div style={{ display: "flex", borderBottom: "1px solid #ffffff08" }}>
            {months.map((m, i) => (
              <div key={i} style={{
                minWidth: m.span * dayWidth, padding: "8px 0",
                textAlign: "center", fontSize: 11, fontWeight: 600,
                color: "#94a3b8", background: "#1a2030",
                borderLeft: i > 0 ? "1px solid #ffffff08" : "none"
              }}>{m.label}</div>
            ))}
          </div>

          {/* 日期列 */}
          <div style={{ display: "flex", borderBottom: "1px solid #ffffff10" }}>
            {days.map((d, i) => {
              const isToday = d.getTime() === today.getTime();
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div key={i} style={{
                  minWidth: dayWidth, textAlign: "center",
                  padding: "6px 0", fontSize: 10,
                  color: isToday ? "#6366f1" : isWeekend ? "#475569" : "#64748b",
                  fontWeight: isToday ? 700 : 400,
                  background: isToday ? "#6366f111" : "#1a2030",
                  borderLeft: "1px solid #ffffff06"
                }}>{d.getDate()}</div>
              );
            })}
          </div>

          {/* 任務列 */}
          {tasksWithDates.map((task) => {
            const start = new Date(getEffectiveStartDate(task));
            const end = new Date(getEffectiveEndDate(task));
            const offsetX = dayOffset(start);
            const width = Math.max(1, dayOffset(end) - offsetX + 1);
            const completion = getCompletion(task);
            const group = groups.find((g) => g.id === task.groupId);
            const barColor = group?.color || "#6366f1";

            return (
              <div key={task.id}>
                <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ffffff06", position: "relative", height: rowHeight }}>
                  {days.map((d, i) => {
                    const isToday = d.getTime() === today.getTime();
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <div key={i} style={{
                        minWidth: dayWidth, height: "100%",
                        background: isToday ? "#6366f108" : isWeekend ? "#ffffff03" : "transparent",
                        borderLeft: "1px solid #ffffff04"
                      }} />
                    );
                  })}

                  <div style={{
                    position: "absolute", left: offsetX * dayWidth,
                    width: width * dayWidth - 4, height: 24,
                    borderRadius: 6, background: barColor + "33",
                    border: `1px solid ${barColor}66`,
                    cursor: "pointer", overflow: "hidden"
                  }} onClick={() => onEditTask(task)}>
                    <div style={{
                      position: "absolute", top: 0, left: 0,
                      height: "100%", width: `${completion}%`,
                      background: barColor + "66", borderRadius: 6,
                      transition: "width .3s"
                    }} />
                    <div style={{
                      position: "absolute", inset: 0, display: "flex",
                      alignItems: "center", paddingLeft: 8,
                      fontSize: 10, fontWeight: 600, color: "#e2e8f0",
                      whiteSpace: "nowrap", overflow: "hidden"
                    }}>{completion}%</div>
                  </div>
                </div>

                {task.subtasks
                  .filter((s) => s.startDate && s.endDate)
                  .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                  .map((sub) => {
                    const sStart = new Date(sub.startDate);
                    const sEnd = new Date(sub.endDate);
                    const sOffsetX = dayOffset(sStart);
                    const sWidth = Math.max(1, dayOffset(sEnd) - sOffsetX + 1);

                    return (
                      <div key={sub.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ffffff04", position: "relative", height: 36, background: "#ffffff02" }}>
                        {days.map((_, i) => (
                          <div key={i} style={{ minWidth: dayWidth, height: "100%", borderLeft: "1px solid #ffffff03" }} />
                        ))}

                        <div style={{
                          position: "absolute", left: sOffsetX * dayWidth,
                          width: sWidth * dayWidth - 4, height: 18,
                          borderRadius: 4, background: "#10b98122",
                          border: "1px solid #10b98144", overflow: "hidden"
                        }}>
                          <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${sub.completion}%`, background: "#10b98155", borderRadius: 4 }} />
                          <div style={{
                            position: "absolute", inset: 0, display: "flex",
                            alignItems: "center", paddingLeft: 6,
                            fontSize: 9, color: "#94a3b8"
                          }}>{sub.completion}%</div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}

          {/* 今日線 */}
          {(() => {
            const todayOffset = dayOffset(today);
            if (todayOffset < 0 || todayOffset > totalDays) return null;
            return (
              <div style={{
                position: "absolute", top: 0, bottom: 0,
                left: todayOffset * dayWidth + dayWidth / 2,
                width: 2, background: "#6366f1", opacity: 0.6, pointerEvents: "none"
              }} />
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────
export default function App() {
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem("pm-projects");
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((p: any) => ({
          ...p,
          meetings: p.meetings || [],
          groups: (p.groups?.length > 0 ? p.groups : DEFAULT_GROUPS).map((g: any) => ({
            ...g,
            members: (g.members || []).map((m: any) =>
              typeof m === "string" ? { id: m, name: m } : { id: m.id || m.name, name: m.name || m.id }
            ),
          })),
          columns: p.columns.map((col: any) => ({
            ...col,
            tasks: col.tasks.map((t: any) => ({
              ...t,
              timeLogs: t.timeLogs || [],
              groupId: t.groupId || "",
              subtasks: (t.subtasks || []).map((s: any) => ({
                ...s,
                timeLogs: s.timeLogs || [],
                groupId: s.groupId || "",
              })),
            })),
          })),
        }));
      }
      return initialProjects;
    } catch {
      return initialProjects;
    }
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    return localStorage.getItem("pm-active-project") || "p1";
  });

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const columns = activeProject?.columns || [];

  const setColumns = (updater: Column[] | ((prev: Column[]) => Column[])) => {
    setProjects((prev) => prev.map((p) => {
      if (p.id === activeProjectId) {
        return { ...p, columns: typeof updater === "function" ? updater(p.columns) : updater };
      }
      return p;
    }));
  };

  useEffect(() => {
    localStorage.setItem("pm-projects", JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem("pm-active-project", activeProjectId);
    setFilterGroups([]);
    setFilterPriorities([]);
    setFilterAssignees([]);
    setSearchText("");
  }, [activeProjectId]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [view, setView] = useState<"kanban" | "gantt" | "dashboard" | "meetings">("kanban");
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleAddProject = () => setShowProjectModal(true);
  const [showGroupModal, setShowGroupModal] = useState(false);

  const handleSaveGroups = (groups: Group[]) => {
    setProjects((prev) => prev.map((p) =>
      p.id === activeProjectId ? { ...p, groups } : p
    ));
  };

  const handleUpdateMeetings = (meetings: MeetingSeries[]) => {
    setProjects((prev) => prev.map((p) =>
      p.id === activeProjectId ? { ...p, meetings } : p
    ));
  };

  const handleSaveProject = (name: string, description: string, color: string) => {
    const newProject: Project = {
      id: "p" + Date.now(),
      name, description, color,
      groups: DEFAULT_GROUPS,
      meetings: [],
      columns: [
        { id: "todo",       title: "待處理", tasks: [] },
        { id: "inprogress", title: "進行中", tasks: [] },
        { id: "review",     title: "審查中", tasks: [] },
        { id: "done",       title: "已完成", tasks: [] },
      ],
    };
    setProjects((prev) => [...prev, newProject]);
    setActiveProjectId(newProject.id);
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProjectId === id) {
      setActiveProjectId(projects.find((p) => p.id !== id)?.id || "");
    }
  };

  const [searchText, setSearchText] = useState("");
  const [filterPriorities, setFilterPriorities] = useState<string[]>([]);
  const [filterAssignees, setFilterAssignees] = useState<string[]>([]);
  const [filterGroups, setFilterGroups] = useState<string[]>([]);


  const filteredColumns = columns.map((col) => ({
    ...col,
    tasks: col.tasks.filter((task) => {
      const memberName = (() => {
        const m = findMemberById(activeProject?.groups || [], task.assignee);
        return m ? m.name : task.assignee;
      })();
      const matchSearch = searchText === "" ||
        task.title.toLowerCase().includes(searchText.toLowerCase()) ||
        memberName.toLowerCase().includes(searchText.toLowerCase());
      const matchPriority = filterPriorities.length === 0 || filterPriorities.includes(task.priority);
      const matchAssignee = filterAssignees.length === 0 || filterAssignees.includes(task.assignee);
      const matchGroup = filterGroups.length === 0 || filterGroups.includes(task.groupId);
      return matchSearch && matchPriority && matchAssignee && matchGroup;
    })
  }));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const findColumn = (taskId: string) => columns.find((c) => c.tasks.some((t) => t.id === taskId));

  const handleDragStart = (e: DragStartEvent) => {
    const task = findColumn(e.active.id as string)?.tasks.find((t) => t.id === e.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeCol = findColumn(active.id as string);
    const overCol = columns.find((c) => c.id === over.id) || findColumn(over.id as string);
    if (!activeCol || !overCol || activeCol === overCol) return;
    setColumns((cols) => cols.map((col) => {
      if (col.id === activeCol.id) return { ...col, tasks: col.tasks.filter((t) => t.id !== active.id) };
      if (col.id === overCol.id) {
        const task = activeCol.tasks.find((t) => t.id === active.id)!;
        return { ...col, tasks: [...col.tasks, task] };
      }
      return col;
    }));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveTask(null);
    if (!over) return;
    const activeCol = findColumn(active.id as string);
    const overCol = findColumn(over.id as string);
    if (!activeCol || !overCol || activeCol.id !== overCol.id) return;
    const oldIdx = activeCol.tasks.findIndex((t) => t.id === active.id);
    const newIdx = overCol.tasks.findIndex((t) => t.id === over.id);
    if (oldIdx !== newIdx) {
      setColumns((cols) => cols.map((col) =>
        col.id === activeCol.id ? { ...col, tasks: arrayMove(col.tasks, oldIdx, newIdx) } : col
      ));
    }
  };

  const handleAddTask = (colId: string, title: string) => {
    setColumns((cols) => cols.map((col) =>
      col.id === colId ? { ...col, tasks: [...col.tasks, { id: "t" + Date.now(), title, description: "", priority: "medium", assignee: "我", timeLogs: [], startDate: "", endDate: "", completion: 0, subtasks: [], groupId: "" }] } : col
    ));
  };

  const handleDeleteTask = (colId: string, taskId: string) => {
    setColumns((cols) => cols.map((col) =>
      col.id === colId ? { ...col, tasks: col.tasks.filter((t) => t.id !== taskId) } : col
    ));
  };

  const handleSaveTask = (updated: Task) => {
    setColumns((cols) => cols.map((col) => ({
      ...col, tasks: col.tasks.map((t) => t.id === updated.id ? updated : t),
    })));
  };

  const prepareTaskExportData = () => {
    const allTasks = columns.flatMap((c) => c.tasks);
    return allTasks.map((task) => {
      const group = activeProject.groups.find((g) => g.id === task.groupId);
      const assignee = findMemberById(activeProject.groups, task.assignee);
      return {
        title: task.title,
        group: group?.name || "未分組",
        assignee: assignee ? memberDisplay(assignee) : task.assignee || "未指派",
        priority: PRIORITY_CONFIG[task.priority].label + "優先",
        startDate: getEffectiveStartDate(task),
        endDate: getEffectiveEndDate(task),
        completion: getCompletion(task),
        subtasks: task.subtasks.map((sub) => {
          const subGroup = activeProject.groups.find((g) => g.id === sub.groupId);
          const subAssignee = findMemberById(activeProject.groups, sub.assignee);
          return {
            title: sub.title,
            group: subGroup?.name || "未分組",
            assignee: subAssignee ? memberDisplay(subAssignee) : sub.assignee || "未指派",
            startDate: sub.startDate,
            endDate: sub.endDate,
            completion: sub.completion,
          };
        }),
      };
    });
  };

  const prepareTimeReportData = () => {
    const allTasks = columns.flatMap((c) => c.tasks);
    const memberMap: Record<string, {
      name: string; memberId: string; group: string;
      totalHours: number; logs: { task: string; date: string; hours: number }[];
    }> = {};

    allTasks.forEach((t) => {
      if (t.subtasks.length === 0 && t.assignee) {
        const member = findMemberById(activeProject.groups, t.assignee);
        const group = activeProject.groups.find((g) => g.id === t.groupId);
        if (!memberMap[t.assignee]) {
          memberMap[t.assignee] = {
            name: member?.name || t.assignee,
            memberId: member?.id || t.assignee,
            group: group?.name || "未分組",
            totalHours: 0, logs: []
          };
        }
        (t.timeLogs || []).forEach((log) => {
          memberMap[t.assignee].logs.push({ task: t.title, date: log.date, hours: log.hours });
          memberMap[t.assignee].totalHours += log.hours;
        });
      }
    });

    allTasks.forEach((t) => {
      t.subtasks.forEach((s) => {
        if (s.assignee) {
          const member = findMemberById(activeProject.groups, s.assignee);
          const group = activeProject.groups.find((g) => g.id === s.groupId);
          if (!memberMap[s.assignee]) {
            memberMap[s.assignee] = {
              name: member?.name || s.assignee,
              memberId: member?.id || s.assignee,
              group: group?.name || "未分組",
              totalHours: 0, logs: []
            };
          }
          (s.timeLogs || []).forEach((log) => {
            memberMap[s.assignee].logs.push({ task: `${t.title} → ${s.title}`, date: log.date, hours: log.hours });
            memberMap[s.assignee].totalHours += log.hours;
          });
        }
      });
    });

    return Object.values(memberMap).map((m) => ({
      ...m,
      totalHours: Math.round(m.totalHours * 10) / 10,
      logs: m.logs.sort((a, b) => b.date.localeCompare(a.date)),
    }));
  };

  useEffect(() => {
    const handleClick = () => setShowExportMenu(false);
    if (showExportMenu) {
      setTimeout(() => document.addEventListener("click", handleClick), 0);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [showExportMenu]);

  const totalTasks = columns.reduce((s, c) => s + c.tasks.length, 0);
  const doneTasks = columns.find((c) => c.id === "done")?.tasks.length ?? 0;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f1117; font-family: 'Segoe UI', system-ui, sans-serif; color: #e2e8f0; }
        .app { min-height: 100vh; padding: 24px; }

        .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #ffffff10; }
        .topbar-left h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: #f1f5f9; }
        .topbar-left p  { font-size: 13px; color: #64748b; margin-top: 2px; }
        .progress-wrap  { display: flex; align-items: center; gap: 12px; }
        .progress-label { font-size: 13px; color: #64748b; }
        .progress-bar   { width: 140px; height: 6px; background: #1e293b; border-radius: 99px; overflow: hidden; }
        .progress-fill  { height: 100%; background: linear-gradient(90deg, #6366f1, #10b981); border-radius: 99px; transition: width .4s; }

        .board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; align-items: start; }
        @media (max-width: 900px) { .board { grid-template-columns: repeat(2, 1fr); } }

        .column { background: #161b27; border-radius: 12px; border: 1px solid #ffffff08; overflow: hidden; }
        .column-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 12px; background: #1a2030; }
        .column-title-row { display: flex; align-items: center; gap: 7px; }
        .column-title { font-size: 13px; font-weight: 600; color: #cbd5e1; }
        .task-count { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 99px; }
        .add-btn { background: none; border: none; cursor: pointer; padding: 4px; border-radius: 6px; display: flex; align-items: center; transition: background .15s; }
        .add-btn:hover { background: #ffffff10; }

        .task-list { padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 60px; max-height: 60vh; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #ffffff15 transparent; }

        .task-card { background: #1e2638; border-radius: 8px; padding: 12px; border: 1px solid #ffffff08; transition: border-color .15s, box-shadow .15s; cursor: pointer; }
        .task-card:hover { border-color: #6366f144; box-shadow: 0 4px 16px #0008; }
        .task-card.dragging { box-shadow: 0 8px 32px #0009; border-color: #6366f144; }

        .task-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .priority-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 99px; }
        .drag-handle { background: none; border: none; cursor: grab; color: #475569; padding: 2px; display: flex; align-items: center; }
        .drag-handle:active { cursor: grabbing; }
        .task-title { font-size: 13px; font-weight: 600; color: #e2e8f0; margin-bottom: 5px; line-height: 1.4; }
        .task-desc  { font-size: 11px; color: #64748b; line-height: 1.5; margin-bottom: 10px; }
        .task-footer { display: flex; align-items: center; justify-content: space-between; }
        .assignee { font-size: 11px; color: #94a3b8; background: #ffffff08; padding: 2px 8px; border-radius: 99px; }

        .timer-wrap { display: flex; align-items: center; gap: 4px; }
        .timer-display { display: flex; align-items: center; gap: 3px; font-size: 10px; color: #475569; font-variant-numeric: tabular-nums; }
        .timer-display.running { color: #10b981; }
        .timer-btn { background: none; border: none; cursor: pointer; color: #475569; padding: 2px; display: flex; align-items: center; border-radius: 4px; transition: color .15s, background .15s; }
        .timer-btn:hover { color: #e2e8f0; background: #ffffff10; }

        .delete-task { position: absolute; top: 8px; right: 8px; background: #ef444422; border: none; border-radius: 4px; color: #ef4444; cursor: pointer; padding: 3px; display: none; align-items: center; }
        div:hover > .delete-task { display: flex; }
        div:hover > .delete-project { display: flex !important; }

        .add-form { padding: 0 10px 10px; }
        .add-input { width: 100%; background: #0f1117; border: 1px solid #6366f144; border-radius: 8px; padding: 9px 12px; color: #e2e8f0; font-size: 13px; outline: none; }
        .add-input:focus { border-color: #6366f1; }
        .add-form-actions { display: flex; gap: 6px; margin-top: 7px; }
        .confirm-btn { flex: 1; background: #6366f1; border: none; border-radius: 6px; color: #fff; font-size: 12px; font-weight: 600; padding: 7px; cursor: pointer; transition: background .15s; }
        .confirm-btn:hover { background: #4f46e5; }
        .cancel-btn { background: #ffffff10; border: none; border-radius: 6px; color: #94a3b8; font-size: 12px; padding: 7px 12px; cursor: pointer; }

        .modal-overlay { position: fixed; inset: 0; background: #00000088; display: flex; align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(4px); }
        .modal { background: #1a2030; border-radius: 14px; border: 1px solid #ffffff12; width: 480px; max-width: 95vw; box-shadow: 0 24px 64px #000a; animation: modal-in .18s ease; }
        @keyframes modal-in { from { opacity: 0; transform: scale(.96) translateY(8px); } to { opacity: 1; transform: none; } }

        .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 14px; border-bottom: 1px solid #ffffff08; }
        .modal-label { font-size: 14px; font-weight: 600; color: #e2e8f0; }
        .modal-close { background: none; border: none; color: #64748b; cursor: pointer; padding: 4px; border-radius: 6px; display: flex; transition: color .15s; }
        .modal-close:hover { color: #e2e8f0; }

        .modal-body { padding: 20px; display: flex; flex-direction: column; gap: 18px; max-height: 65vh; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #ffffff15 transparent; }
        .field { display: flex; flex-direction: column; gap: 7px; }
        .field-label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
        .field-input { background: #0f1117; border: 1px solid #ffffff12; border-radius: 8px; padding: 10px 12px; color: #e2e8f0; font-size: 13px; outline: none; font-family: inherit; resize: none; transition: border-color .15s; width: 100%; }
        .field-input:focus { border-color: #6366f1; }
        .field-input[type="date"] { color-scheme: dark; }
        .field-textarea { line-height: 1.6; }
        .field-time { background: #0f1117; border: 1px solid #ffffff08; border-radius: 8px; padding: 10px 12px; color: #94a3b8; font-size: 13px; font-variant-numeric: tabular-nums; }

        .priority-group { display: flex; gap: 8px; }
        .priority-option { flex: 1; border-radius: 8px; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s; }

        .modal-footer { display: flex; gap: 10px; padding: 14px 20px 18px; border-top: 1px solid #ffffff08; }
        .btn-cancel { flex: 1; background: #ffffff10; border: none; border-radius: 8px; color: #94a3b8; font-size: 13px; padding: 10px; cursor: pointer; }
        .btn-cancel:hover { background: #ffffff18; }
        .btn-save { flex: 2; background: #6366f1; border: none; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; padding: 10px; cursor: pointer; }
        .btn-save:hover { background: #4f46e5; }
      `}</style>

      <Sidebar
        view={view}
        setView={setView}
        projects={projects}
        activeProjectId={activeProjectId}
        setActiveProjectId={setActiveProjectId}
        onAddProject={handleAddProject}
        onDeleteProject={handleDeleteProject}
        onManageGroups={() => setShowGroupModal(true)}
      />

      <div style={{ marginLeft: 200 }}>
        <div className="app">
          <div className="topbar">
            <div className="topbar-left">
              <h1>{activeProject?.name || "專案管理"}</h1>
              <p>共 {totalTasks} 項任務 · {doneTasks} 項已完成</p>
            </div>
            <div className="progress-wrap">
              <span className="progress-label">進度</span>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: totalTasks ? `${(doneTasks / totalTasks) * 100}%` : "0%" }} />
              </div>
              <span className="progress-label">{totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0}%</span>

              <div style={{ position: "relative" }}>
                <button onClick={() => setShowExportMenu((prev) => !prev)}
                  style={{
                    background: "#6366f122", border: "1px solid #6366f144",
                    borderRadius: 8, color: "#6366f1", fontSize: 13, fontWeight: 600,
                    padding: "6px 16px", cursor: "pointer"
                  }}>
                  匯出 ▾
                </button>

                {showExportMenu && (
                  <div style={{
                    position: "absolute", top: "100%", right: 0, marginTop: 6,
                    background: "#1a2030", border: "1px solid #ffffff12", borderRadius: 10,
                    padding: 6, zIndex: 100, minWidth: 200,
                    boxShadow: "0 12px 32px #000a"
                  }}>
                    <p style={{ fontSize: 10, color: "#475569", padding: "4px 10px", textTransform: "uppercase", letterSpacing: ".05em" }}>任務清單</p>
                    <button onClick={() => { exportTaskListCSV(activeProject.name, prepareTaskExportData()); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "#ffffff08")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "none")}>
                      📄 CSV 格式
                    </button>
                    <button onClick={() => { exportTaskListPDF(activeProject.name, prepareTaskExportData()); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "#ffffff08")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "none")}>
                      📑 PDF 格式
                    </button>

                    <div style={{ height: 1, background: "#ffffff08", margin: "4px 0" }} />

                    <p style={{ fontSize: 10, color: "#475569", padding: "4px 10px", textTransform: "uppercase", letterSpacing: ".05em" }}>工時報表</p>
                    <button onClick={() => { exportTimeReportCSV(activeProject.name, prepareTimeReportData()); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "#ffffff08")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "none")}>
                      📄 CSV 格式
                    </button>
                    <button onClick={() => { exportTimeReportPDF(activeProject.name, prepareTimeReportData()); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "#ffffff08")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "none")}>
                      📑 PDF 格式
                    </button>

                    <div style={{ height: 1, background: "#ffffff08", margin: "4px 0" }} />

                    <p style={{ fontSize: 10, color: "#475569", padding: "4px 10px", textTransform: "uppercase", letterSpacing: ".05em" }}>甘特圖</p>
                    <button onClick={() => { exportGanttPNG("gantt-container", activeProject.name); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "#ffffff08")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "none")}>
                      🖼️ PNG 圖片
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            {/* 第一行：搜尋 + 清除 */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
                <input
                  className="field-input"
                  placeholder="搜尋任務或指派人..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  style={{ paddingLeft: 32, fontSize: 13 }}
                />
              </div>
              {(searchText || filterPriorities.length > 0 || filterAssignees.length > 0 || filterGroups.length > 0) && (
                <button onClick={() => { setSearchText(""); setFilterPriorities([]); setFilterAssignees([]); setFilterGroups([]); }}
                  style={{ background: "#ef444422", border: "1px solid #ef444444", borderRadius: 8, color: "#ef4444", fontSize: 12, padding: "6px 12px", cursor: "pointer" }}>
                  清除篩選
                </button>
              )}
            </div>

            {/* 第二行：組別多選 */}
            {activeProject?.groups?.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {activeProject.groups.map((g) => {
                  const active = filterGroups.includes(g.id);
                  return (
                    <button key={g.id}
                      onClick={() => {
                        if (active) {
                          const newGroups = filterGroups.filter((x) => x !== g.id);
                          setFilterGroups(newGroups);
                          const remainingMemberIds = activeProject.groups
                            .filter((gr) => newGroups.includes(gr.id))
                            .flatMap((gr) => gr.members || [])
                            .map((m) => m.id);
                          setFilterAssignees(filterAssignees.filter((a) => remainingMemberIds.includes(a)));
                        } else {
                          setFilterGroups([...filterGroups, g.id]);
                        }
                      }}
                      style={{
                        background: active ? g.color + "22" : "transparent",
                        border: `1px solid ${active ? g.color : "#ffffff15"}`,
                        color: active ? g.color : "#64748b",
                        borderRadius: 8, padding: "6px 12px",
                        fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s"
                      }}>
                      {g.name}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 第三行：優先級多選 */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["high", "medium", "low"] as Priority[]).map((p) => {
                const active = filterPriorities.includes(p);
                const cfg = PRIORITY_CONFIG[p];
                return (
                  <button key={p}
                    onClick={() => setFilterPriorities(active ? filterPriorities.filter((x) => x !== p) : [...filterPriorities, p])}
                    style={{
                      background: active ? cfg.color + "22" : "transparent",
                      border: `1px solid ${active ? cfg.color : "#ffffff15"}`,
                      color: active ? cfg.color : "#64748b",
                      borderRadius: 8, padding: "6px 12px",
                      fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s"
                    }}>
                    {cfg.label}優先
                  </button>
                );
              })}
            </div>

            {/* 第四行：人員篩選 - 依選中組別動態顯示 */}
            {filterGroups.length > 0 && (() => {
              const selectedGroups = activeProject.groups.filter((g) => filterGroups.includes(g.id));
              const memberMap = new Map<string, Member>();
              selectedGroups.flatMap((g) => g.members || []).forEach((m) => memberMap.set(m.id, m));
              const availableMembers = Array.from(memberMap.values());
              if (availableMembers.length === 0) return null;
              return (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {availableMembers.map((m) => {
                    const active = filterAssignees.includes(m.id);
                    return (
                      <button key={m.id}
                        onClick={() => setFilterAssignees(active
                          ? filterAssignees.filter((x) => x !== m.id)
                          : [...filterAssignees, m.id]
                        )}
                        style={{
                          background: active ? "#6366f122" : "transparent",
                          border: `1px solid ${active ? "#6366f1" : "#ffffff15"}`,
                          color: active ? "#6366f1" : "#64748b",
                          borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer"
                        }}>
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {view === "kanban" ? (
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
              <div className="board">
                {filteredColumns.map((col) => (
                  <ColumnComponent key={col.id} column={col} onAddTask={handleAddTask} onDeleteTask={handleDeleteTask} onEditTask={setEditingTask} groups={activeProject?.groups || []} />
                ))}
              </div>
              <DragOverlay>{activeTask && <TaskCard task={activeTask} isDragging groups={activeProject?.groups || []} />}</DragOverlay>
            </DndContext>
          ) : view === "gantt" ? (
            <GanttView columns={filteredColumns} groups={activeProject?.groups || []} onEditTask={setEditingTask} />
          ) : view === "dashboard" ? (
            <DashboardView columns={columns} groups={activeProject?.groups || []} />
          ) : (
            <MeetingsView
              meetings={activeProject?.meetings || []}
              groups={activeProject?.groups || []}
              onUpdate={handleUpdateMeetings}
            />
          )}
        </div>
      </div>

      {editingTask && (
        <TaskModal task={editingTask} groups={activeProject?.groups || []} onSave={handleSaveTask} onClose={() => setEditingTask(null)} />
      )}

      {showProjectModal && (
        <ProjectModal
          onSave={handleSaveProject}
          onClose={() => setShowProjectModal(false)}
        />
      )}

      {showGroupModal && (
        <GroupModal
          groups={activeProject?.groups || []}
          onSave={handleSaveGroups}
          onClose={() => setShowGroupModal(false)}
        />
      )}
    </>
  );
}
