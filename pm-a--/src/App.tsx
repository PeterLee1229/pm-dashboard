import { useState, useEffect, type ReactElement } from "react";
import {
  DndContext, type DragEndEvent, type DragOverEvent, DragOverlay, type DragStartEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X, GripVertical, Circle, Clock, CheckCircle2, AlertCircle, User, AlignLeft, Flag, Play, Pause, Timer, Calendar } from "lucide-react";

type Priority = "low" | "medium" | "high";
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
};
type Column = { id: string; title: string; tasks: Task[] };

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
      { id: "t1", title: "需求分析文件", description: "整理客戶訪談結果，輸出需求規格書", priority: "high", assignee: "Peter", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "" },
      { id: "t2", title: "UI 原型設計", description: "使用 Figma 製作低保真原型", priority: "medium", assignee: "Amy", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "" },
    ],
  },
  {
    id: "inprogress", title: "進行中",
    tasks: [
      { id: "t3", title: "後端 API 開發", description: "實作任務管理 CRUD endpoints", priority: "high", assignee: "John", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "" },
      { id: "t4", title: "資料庫設計", description: "設計 PostgreSQL schema 與索引", priority: "medium", assignee: "Peter", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "" },
    ],
  },
  {
    id: "review", title: "審查中",
    tasks: [
      { id: "t5", title: "前端看板元件", description: "實作拖拉排序看板介面", priority: "medium", assignee: "Amy", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "" },
    ],
  },
  {
    id: "done", title: "已完成",
    tasks: [
      { id: "t6", title: "專案環境建置", description: "完成 Vite + React + TS 環境設定", priority: "low", assignee: "Peter", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "" },
    ],
  },
];

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
            <input type="date" className="field-input" value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>

          <div className="field">
            <label className="field-label"><Calendar size={13} /> 結束日期</label>
            <input type="date" className="field-input" value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
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

// ── App ──────────────────────────────────────────────────────────────
export default function App() {
  const [columns, setColumns] = useState<Column[]>(initialColumns);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

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
      col.id === colId ? { ...col, tasks: [...col.tasks, { id: "t" + Date.now(), title, description: "", priority: "medium", assignee: "我", trackedSeconds: 0, isRunning: false, startDate: "", endDate: "" }] } : col
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

      <div className="app">
        <div className="topbar">
          <div className="topbar-left">
            <h1>專案管理看板</h1>
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

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <div className="board">
            {columns.map((col) => (
              <ColumnComponent key={col.id} column={col} onAddTask={handleAddTask} onDeleteTask={handleDeleteTask} onEditTask={setEditingTask} onToggleTimer={handleToggleTimer} />
            ))}
          </div>
          <DragOverlay>{activeTask && <TaskCard task={activeTask} isDragging />}</DragOverlay>
        </DndContext>
      </div>

      {editingTask && (
        <TaskModal task={editingTask} onSave={handleSaveTask} onClose={() => setEditingTask(null)} />
      )}
    </>
  );
}
