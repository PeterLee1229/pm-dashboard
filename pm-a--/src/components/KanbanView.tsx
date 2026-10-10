import { useEffect, useState, type ReactElement } from "react";
import { t } from "../i18n";
import { Plus, GripVertical, Circle, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Task, Column, Group } from "../types";
import { PRIORITY_CONFIG, COLUMN_COLORS, getCompletion, getSubtaskAssigneeLabel } from "../helpers";
import { getDueStatus } from "../reportCalc";

function DueDateBadge({ task }: { task: Task }) {
  const status = getDueStatus(task);
  if (!status) return null;
  const { due, isOverdue, isDueSoon } = status;

  const color = isOverdue ? "#ef4444" : isDueSoon ? "#f59e0b" : "#64748b";
  const label = `${due.getMonth() + 1}/${due.getDate()}`;

  return (
    <span style={{
      fontSize: 10, fontWeight: isOverdue ? 700 : 600, padding: "1px 6px", borderRadius: 4,
      background: (isOverdue || isDueSoon) ? color + "1c" : "transparent",
      border: (isOverdue || isDueSoon) ? `1px solid ${color}44` : "none",
      color, display: "inline-flex", alignItems: "center", gap: 3,
    }}>
      {isOverdue ? "⚠ 已逾期" : "截止"} {label}
    </span>
  );
}

export const COLUMN_ICONS: Record<string, ReactElement> = {
  todo:       <Circle size={14} />,
  inprogress: <Clock size={14} />,
  review:     <AlertCircle size={14} />,
  done:       <CheckCircle2 size={14} />,
};

export const COLUMN_TITLES: Record<string, () => string> = {
  todo:       () => t("kanban.todo"),
  inprogress: () => t("kanban.inprogress"),
  review:     () => t("kanban.review"),
  done:       () => t("kanban.done"),
};

export function TaskCard({ task, isDragging = false, onClick, groups = [], canDrag = true }: {
  task: Task; isDragging?: boolean; onClick?: () => void; groups?: Group[]; canDrag?: boolean;
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
        {canDrag && (
          <button className="drag-handle" aria-label="拖曳移動任務" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
            <GripVertical size={14} />
          </button>
        )}
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
      <div className="task-footer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span className="assignee">{getSubtaskAssigneeLabel(task, groups)}</span>
        <DueDateBadge task={task} />
      </div>
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────────

export default function ColumnComponent({ column, canAdd, canDrag, onAddTask, onEditTask, groups, forceOpenSignal }: {
  column: Column;
  canAdd: boolean;
  canDrag: boolean;
  onAddTask: (colId: string, title: string) => void;
  onEditTask: (task: Task) => void;
  groups: Group[];
  forceOpenSignal?: number;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const color = COLUMN_COLORS[column.id] || "#6366f1";
  const icon = COLUMN_ICONS[column.id];
  const isAddableColumn = column.id === "todo" || column.id === "inprogress";
  const { setNodeRef: setDropRef } = useDroppable({ id: column.id });

  useEffect(() => {
    if (forceOpenSignal) setAdding(true);
  }, [forceOpenSignal]);

  const handleAdd = () => {
    if (newTitle.trim()) { onAddTask(column.id, newTitle.trim()); setNewTitle(""); setAdding(false); }
  };

  return (
    <div className="column">
      <div className="column-header" style={{ borderTop: `3px solid ${color}` }}>
        <div className="column-title-row">
          <span style={{ color }}>{icon}</span>
          <span className="column-title">{COLUMN_TITLES[column.id]?.() || column.title}</span>
          <span className="task-count" style={{ background: color + "22", color }}>{column.tasks.length}</span>
        </div>
        {canAdd && isAddableColumn && (
          <button className="add-btn" onClick={() => setAdding(true)} style={{ color }}><Plus size={15} /></button>
        )}
      </div>

      <SortableContext items={column.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list" ref={setDropRef}>
          {/* 刪除任務在任務視窗內（避免與拖曳把手相鄰誤觸） */}
          {column.tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => onEditTask(task)} groups={groups} canDrag={canDrag} />
          ))}
        </div>
      </SortableContext>

      {canAdd && isAddableColumn && adding && (
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
