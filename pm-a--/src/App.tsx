import { useState, useEffect, type ReactElement } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  DndContext, type DragEndEvent, type DragOverEvent, DragOverlay, type DragStartEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X, GripVertical, Circle, Clock, CheckCircle2, AlertCircle, User, AlignLeft, Flag, Play, Pause, Timer, Calendar, BarChart2 } from "lucide-react";

type Priority = "low" | "medium" | "high";
type SubTask = {
  id: string;
  title: string;
  description: string;
  assignee: string;
  startDate: string;
  endDate: string;
  completion: number;
};
type Task = {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  assignee: string;
  trackedSeconds: number;
  isRunning: boolean;
  startDate: string;
  endDate: string;
  completion: number;
  subtasks: SubTask[];
};
type Column = { id: string; title: string; tasks: Task[] };
type Project = {
  id: string;
  name: string;
  description: string;
  color: string;
  columns: Column[];
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
      { id: "t1", title: "需求分析文件", description: "整理客戶訪談結果，輸出需求規格書", priority: "high", assignee: "Peter", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "", completion: 0, subtasks: [] },
      { id: "t2", title: "UI 原型設計", description: "使用 Figma 製作低保真原型", priority: "medium", assignee: "Amy", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "", completion: 0, subtasks: [] },
    ],
  },
  {
    id: "inprogress", title: "進行中",
    tasks: [
      { id: "t3", title: "後端 API 開發", description: "實作任務管理 CRUD endpoints", priority: "high", assignee: "John", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "", completion: 0, subtasks: [] },
      { id: "t4", title: "資料庫設計", description: "設計 PostgreSQL schema 與索引", priority: "medium", assignee: "Peter", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "", completion: 0, subtasks: [] },
    ],
  },
  {
    id: "review", title: "審查中",
    tasks: [
      { id: "t5", title: "前端看板元件", description: "實作拖拉排序看板介面", priority: "medium", assignee: "Amy", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "", completion: 0, subtasks: [] },
    ],
  },
  {
    id: "done", title: "已完成",
    tasks: [
      { id: "t6", title: "專案環境建置", description: "完成 Vite + React + TS 環境設定", priority: "low", assignee: "Peter", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "", completion: 0, subtasks: [] },
    ],
  },
];

const PROJECT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#06b6d4"];

const initialProjects: Project[] = [
  {
    id: "p1",
    name: "專案管理軟體開發",
    description: "PM Dashboard 系統開發專案",
    color: "#6366f1",
    columns: initialColumns,
  },
];

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

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ── Task Edit Modal ──────────────────────────────────────────────────
function TaskModal({ task, onSave, onClose }: {
  task: Task;
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
            <label className="field-label"><User size={13} /> 指派人</label>
            <input className="field-input" value={form.assignee}
              onChange={(e) => setForm({ ...form, assignee: e.target.value })}
              placeholder="輸入指派人姓名..." />
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
                  assignee: "", startDate: "", endDate: "", completion: 0
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

                <input placeholder="指派人" value={sub.assignee} onChange={(e) => {
                  const updated = [...form.subtasks];
                  updated[idx] = { ...sub, assignee: e.target.value };
                  setForm({ ...form, subtasks: updated });
                }} className="field-input" style={{ marginBottom: 6, fontSize: 12 }} />

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
              </div>
            ))}
          </div>

          <div className="field">
            <label className="field-label"><Timer size={13} /> 累計工時</label>
            <div className="field-time">{formatTime(task.trackedSeconds)}</div>
          </div>
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
function TaskCard({ task, isDragging = false, onClick, onToggleTimer }: {
  task: Task; isDragging?: boolean; onClick?: () => void; onToggleTimer?: (taskId: string) => void;
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
        <span className="assignee">{task.assignee}</span>
        <div className="timer-wrap">
          <span className={`timer-display${task.isRunning ? " running" : ""}`}>
            <Timer size={11} />
            {formatTime(task.trackedSeconds)}
          </span>
          <button className="timer-btn" onClick={(e) => { e.stopPropagation(); onToggleTimer?.(task.id); }}>
            {task.isRunning ? <Pause size={12} /> : <Play size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────────
function ColumnComponent({ column, onAddTask, onDeleteTask, onEditTask, onToggleTimer }: {
  column: Column;
  onAddTask: (colId: string, title: string) => void;
  onDeleteTask: (colId: string, taskId: string) => void;
  onEditTask: (task: Task) => void;
  onToggleTimer: (taskId: string) => void;
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
              <TaskCard task={task} onClick={() => onEditTask(task)} onToggleTimer={onToggleTimer} />
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

// ── Sidebar ──────────────────────────────────────────────────────────
function Sidebar({ view, setView, projects, activeProjectId, setActiveProjectId, onAddProject, onDeleteProject }: {
  view: "kanban" | "gantt" | "dashboard";
  setView: (v: "kanban" | "gantt" | "dashboard") => void;
  projects: Project[];
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  onAddProject: () => void;
  onDeleteProject: (id: string) => void;
}) {
  const items = [
    { id: "kanban",    label: "看板",   icon: <Circle size={16} /> },
    { id: "gantt",     label: "甘特圖", icon: <Clock size={16} /> },
    { id: "dashboard", label: "儀表板", icon: <BarChart2 size={16} /> },
  ] as const;

  return (
    <div style={{
      width: 200, minHeight: "100vh", background: "#111827",
      borderRight: "1px solid #ffffff08", padding: "24px 12px",
      display: "flex", flexDirection: "column", gap: 4,
      position: "fixed", top: 0, left: 0, zIndex: 50, overflowY: "auto"
    }}>
      <div style={{ padding: "0 8px 20px" }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", letterSpacing: -0.5 }}>專案管理</p>
        <p style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>PM Dashboard</p>
      </div>

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

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #ffffff08" }}>
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
    </div>
  );
}

// ── Dashboard View ───────────────────────────────────────────────────
function DashboardView({ columns }: { columns: Column[] }) {
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

  const assigneeMap: Record<string, number> = {};
  [...allTasks, ...allSubtasks].forEach((t) => {
    if (t.assignee) assigneeMap[t.assignee] = (assigneeMap[t.assignee] || 0) + 1;
  });
  const assigneeData = Object.entries(assigneeMap).map(([name, 任務數]) => ({ name, 任務數 }));

  const hoursMap: Record<string, number> = {};
  allTasks.forEach((t) => {
    if (t.assignee && t.trackedSeconds > 0) {
      hoursMap[t.assignee] = (hoursMap[t.assignee] || 0) + t.trackedSeconds;
    }
  });
  const hoursData = Object.entries(hoursMap).map(([name, secs]) => ({
    name, 工時: Math.round(secs / 360) / 10
  }));

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
          <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>各成員任務數</p>
          {assigneeData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>尚無資料</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={assigneeData} barSize={32} layout="vertical">
                <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff06" }} />
                <Bar dataKey="任務數" fill="#6366f1" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
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
    </div>
  );
}

// ── Gantt View ───────────────────────────────────────────────────────
function GanttView({ columns, onEditTask }: {
  columns: Column[];
  onEditTask: (task: Task) => void;
}) {
  const allTasks = columns.flatMap((col) => col.tasks);
  const tasksWithDates = allTasks.filter((t) =>
    getEffectiveStartDate(t) && getEffectiveEndDate(t)
  );

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
  const labelWidth = 180;

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

  const COL_COLORS_LIST = ["#6366f1", "#f59e0b", "#8b5cf6", "#10b981"];

  return (
    <div style={{ overflowX: "auto", background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", position: "relative" }}>
      <div style={{ minWidth: labelWidth + days.length * dayWidth }}>

        {/* 月份列 */}
        <div style={{ display: "flex", borderBottom: "1px solid #ffffff08" }}>
          <div style={{ minWidth: labelWidth, background: "#1a2030" }} />
          {months.map((m, i) => (
            <div key={i} style={{
              minWidth: m.span * dayWidth, padding: "8px 0",
              textAlign: "center", fontSize: 11, fontWeight: 600,
              color: "#94a3b8", background: "#1a2030",
              borderLeft: "1px solid #ffffff08"
            }}>{m.label}</div>
          ))}
        </div>

        {/* 日期列 */}
        <div style={{ display: "flex", borderBottom: "1px solid #ffffff10" }}>
          <div style={{ minWidth: labelWidth, background: "#1a2030", padding: "6px 14px", fontSize: 11, color: "#475569" }}>任務名稱</div>
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
        {tasksWithDates.map((task, taskIdx) => {
          const start = new Date(getEffectiveStartDate(task));
          const end = new Date(getEffectiveEndDate(task));
          const offsetX = dayOffset(start);
          const width = Math.max(1, dayOffset(end) - offsetX + 1);
          const completion = getCompletion(task);
          const colColor = COL_COLORS_LIST[taskIdx % COL_COLORS_LIST.length];

          return (
            <div key={task.id}>
              <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ffffff06", position: "relative", height: rowHeight }}>
                <div style={{
                  minWidth: labelWidth, padding: "0 14px",
                  fontSize: 12, fontWeight: 600, color: "#cbd5e1",
                  cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                }} onClick={() => onEditTask(task)}>{task.title}</div>

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
                  position: "absolute", left: labelWidth + offsetX * dayWidth,
                  width: width * dayWidth - 4, height: 24,
                  borderRadius: 6, background: colColor + "33",
                  border: `1px solid ${colColor}66`,
                  cursor: "pointer", overflow: "hidden"
                }} onClick={() => onEditTask(task)}>
                  <div style={{
                    position: "absolute", top: 0, left: 0,
                    height: "100%", width: `${completion}%`,
                    background: colColor + "66", borderRadius: 6,
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
                    <div style={{
                      minWidth: labelWidth, padding: "0 14px 0 28px",
                      fontSize: 11, color: "#64748b",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                    }}>↳ {sub.title}</div>

                    {days.map((_, i) => (
                      <div key={i} style={{ minWidth: dayWidth, height: "100%", borderLeft: "1px solid #ffffff03" }} />
                    ))}

                    <div style={{
                      position: "absolute", left: labelWidth + sOffsetX * dayWidth,
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
              left: labelWidth + todayOffset * dayWidth + dayWidth / 2,
              width: 2, background: "#6366f1", opacity: 0.6, pointerEvents: "none"
            }} />
          );
        })()}
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────
export default function App() {
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem("pm-projects");
      return saved ? JSON.parse(saved) : initialProjects;
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
  }, [activeProjectId]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [view, setView] = useState<"kanban" | "gantt" | "dashboard">("kanban");
  const [showProjectModal, setShowProjectModal] = useState(false);

  const handleAddProject = () => setShowProjectModal(true);

  const handleSaveProject = (name: string, description: string, color: string) => {
    const newProject: Project = {
      id: "p" + Date.now(),
      name, description, color,
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const findColumn = (taskId: string) => columns.find((c) => c.tasks.some((t) => t.id === taskId));

  useEffect(() => {
    const interval = setInterval(() => {
      setColumns((cols) => cols.map((col) => ({
        ...col,
        tasks: col.tasks.map((t) => t.isRunning ? { ...t, trackedSeconds: t.trackedSeconds + 1 } : t),
      })));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleTimer = (taskId: string) => {
    setColumns((cols) => cols.map((col) => ({
      ...col,
      tasks: col.tasks.map((t) => t.id === taskId ? { ...t, isRunning: !t.isRunning } : t),
    })));
  };

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
      col.id === colId ? { ...col, tasks: [...col.tasks, { id: "t" + Date.now(), title, description: "", priority: "medium", assignee: "我", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "", completion: 0, subtasks: [] }] } : col
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
            </div>
          </div>

          {view === "kanban" ? (
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
              <div className="board">
                {columns.map((col) => (
                  <ColumnComponent key={col.id} column={col} onAddTask={handleAddTask} onDeleteTask={handleDeleteTask} onEditTask={setEditingTask} onToggleTimer={handleToggleTimer} />
                ))}
              </div>
              <DragOverlay>{activeTask && <TaskCard task={activeTask} isDragging />}</DragOverlay>
            </DndContext>
          ) : view === "gantt" ? (
            <GanttView columns={columns} onEditTask={setEditingTask} />
          ) : (
            <DashboardView columns={columns} />
          )}
        </div>
      </div>

      {editingTask && (
        <TaskModal task={editingTask} onSave={handleSaveTask} onClose={() => setEditingTask(null)} />
      )}

      {showProjectModal && (
        <ProjectModal
          onSave={handleSaveProject}
          onClose={() => setShowProjectModal(false)}
        />
      )}
    </>
  );
}
