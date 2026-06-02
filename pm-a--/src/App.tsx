import { useState, useEffect, Suspense, lazy } from "react";
import { t, getLanguage, setLanguage, type Language } from "./i18n";
import LoginPage from "./LoginPage";
import {
  isLoggedIn, clearToken, getCurrentUser, getProjects, createProject as apiCreateProject, deleteProject as apiDeleteProject, getProjectTasks, createProjectTask, updateTask as apiUpdateTask, deleteTask as apiDeleteTask, createGroup as apiCreateGroup, updateGroup as apiUpdateGroup, deleteGroup as apiDeleteGroup, getGroups, getProjectMembers, getNotifications, getUnreadCount, markAsRead, markAllAsRead, searchProject, getProjectMeetings, createMeetingSeries as apiCreateMeetingSeries, deleteMeetingSeries as apiDeleteMeetingSeries, createMeetingRecord as apiCreateMeetingRecord, updateMeetingRecord as apiUpdateMeetingRecord, deleteMeetingRecord as apiDeleteMeetingRecord, getProjectRisks, createRisk as apiCreateRisk, updateRisk as apiUpdateRisk, deleteRisk as apiDeleteRisk, getWeeklyReports, saveWeeklyReport as apiSaveWeeklyReport,
} from "./api";
import { exportTaskListCSV, exportTaskListPDF, exportTimeReportCSV, exportTimeReportPDF, exportGanttPNG } from "./exportUtils";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { X } from "lucide-react";
import MultiSelect from "./components/MultiSelect";
import type { Member, Group, Task, Column, MeetingSeries, Risk, WeeklyReport, Project } from "./types";
import { getCompletion, getEffectiveStartDate, getEffectiveEndDate, memberDisplay, findMemberById, normalizeDate, hasPermission, PRIORITY_CONFIG } from "./helpers";

import Sidebar from "./components/Sidebar";
import TaskModal from "./components/TaskModal";
import ProjectModal from "./components/ProjectModal";
import GroupModal from "./components/GroupModal";
import ColumnComponent, { TaskCard } from "./components/KanbanView";

const GanttView = lazy(() => import("./components/GanttView"));
const DashboardView = lazy(() => import("./components/DashboardView"));
const MeetingsView = lazy(() => import("./components/MeetingsView"));
const RiskMatrixView = lazy(() => import("./components/RiskMatrixView"));
const WeeklyReportView = lazy(() => import("./components/WeeklyReportView"));
const CalendarView = lazy(() => import("./components/CalendarView"));
const ActivityView = lazy(() => import("./components/ActivityView"));
const OKRView = lazy(() => import("./components/OKRView"));
const AdminView = lazy(() => import("./components/AdminView"));
const ProjectMembersView = lazy(() => import("./components/ProjectMembersView"));
const ImportModal = lazy(() => import("./components/ImportModal"));

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeProjectId, setActiveProjectId] = useState<string>("");

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
    setFilterGroups([]);
    setFilterPriorities([]);
    setFilterAssignees([]);
    setSearchText("");
  }, [activeProjectId]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [view, setView] = useState<"kanban" | "gantt" | "dashboard" | "meetings" | "risks" | "weekly" | "admin" | "project_members" | "activities" | "calendar" | "okr">("kanban");
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const handleAddProject = () => setShowProjectModal(true);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searching, setSearching] = useState(false);

  const [language, setLang] = useState<Language>(getLanguage());
  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    setLang(lang);
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      setSearching(true);
      const results = await searchProject(activeProjectId, query.trim());
      setSearchResults(results);
    } catch (err) {
      console.error("搜尋失敗:", err);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === "Escape" && showSearch) {
        setShowSearch(false);
        setSearchQuery("");
        setSearchResults(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showSearch]);

  const handleCreateMeetingSeries = async (name: string, type: string) => {
    try {
      const series = await apiCreateMeetingSeries(activeProjectId, { name, type });
      setMeetings(prev => [...prev, { ...series, records: [] }]);
    } catch (err) {
      console.error("建立會議系列失敗:", err);
    }
  };

  const handleDeleteMeetingSeries = async (id: string) => {
    try {
      await apiDeleteMeetingSeries(id);
      setMeetings(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      console.error("刪除會議系列失敗:", err);
    }
  };

  const handleCreateMeetingRecord = async (seriesId: string, record: any) => {
    try {
      const newRecord = await apiCreateMeetingRecord(seriesId, record);
      setMeetings(prev => prev.map(m =>
        m.id === seriesId ? { ...m, records: [newRecord, ...m.records] } : m
      ));
    } catch (err) {
      console.error("新增會議紀錄失敗:", err);
    }
  };

  const handleDeleteMeetingRecord = async (seriesId: string, recordId: string) => {
    try {
      await apiDeleteMeetingRecord(recordId);
      setMeetings(prev => prev.map(m =>
        m.id === seriesId ? { ...m, records: m.records.filter(r => r.id !== recordId) } : m
      ));
    } catch (err) {
      console.error("刪除會議紀錄失敗:", err);
    }
  };

  const handleUpdateMeetingRecord = async (seriesId: string, recordId: string, data: any) => {
    try {
      await apiUpdateMeetingRecord(recordId, data);
      setMeetings(prev => prev.map(m =>
        m.id === seriesId ? { ...m, records: m.records.map(r => r.id === recordId ? { ...r, ...data } : r) } : m
      ));
    } catch (err) {
      console.error("更新會議紀錄失敗:", err);
    }
  };

  const handleCreateRisk = async (risk: Risk) => {
    try {
      const newRisk = await apiCreateRisk(activeProjectId, risk);
      setRisks(prev => [...prev, newRisk]);
    } catch (err) {
      console.error("建立風險失敗:", err);
    }
  };

  const handleUpdateRisk = async (risk: Risk) => {
    try {
      const updated = await apiUpdateRisk(risk.id, risk);
      setRisks(prev => prev.map(r => r.id === risk.id ? updated : r));
    } catch (err) {
      console.error("更新風險失敗:", err);
    }
  };

  const handleDeleteRisk = async (id: string) => {
    try {
      await apiDeleteRisk(id);
      setRisks(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      console.error("刪除風險失敗:", err);
    }
  };

  const handleSaveWeeklyNotes = async (weekStart: string, weekEnd: string, notes: string) => {
    try {
      const report = await apiSaveWeeklyReport(activeProjectId, { weekStart, weekEnd, notes });
      setWeeklyReports(prev => {
        const exists = prev.find(r => r.weekStart === weekStart);
        if (exists) return prev.map(r => r.weekStart === weekStart ? report : r);
        return [...prev, report];
      });
    } catch (err) {
      console.error("儲存週報失敗:", err);
    }
  };

  const handleSaveProject = async (name: string, description: string, color: string) => {
    try {
      const newProject = await apiCreateProject({ name, description, color });

      const defaultGroups = [
        { name: "專管組", color: "#6366f1" },
        { name: "美術組", color: "#f59e0b" },
        { name: "設計組", color: "#8b5cf6" },
        { name: "硬體組", color: "#10b981" },
        { name: "軟體組", color: "#06b6d4" },
        { name: "維運組", color: "#f43f5e" },
        { name: "費曼圖", color: "#facc15" },
      ];
      for (const group of defaultGroups) {
        try { await apiCreateGroup(newProject.id, group); } catch { /* 組別已存在則跳過 */ }
      }
      getGroups().then(setSystemGroups).catch(console.error);

      await loadProjects();
      setActiveProjectId(newProject.id);
    } catch (err) {
      console.error("新增專案失敗:", err);
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await apiDeleteProject(id);
      await loadProjects();
      if (activeProjectId === id && projects.length > 1) {
        setActiveProjectId(projects.find((p) => p.id !== id)?.id || "");
      }
    } catch (err) {
      console.error("刪除專案失敗:", err);
    }
  };

  const [searchText, setSearchText] = useState("");
  const [filterPriorities, setFilterPriorities] = useState<string[]>([]);
  const [filterAssignees, setFilterAssignees] = useState<string[]>([]);
  const [filterGroups, setFilterGroups] = useState<string[]>([]);

  const [meetings, setMeetings] = useState<MeetingSeries[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);

  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [currentUser, setCurrentUser] = useState(getCurrentUser());

  const currentProjectRole = currentUser?.role === "admin" ? "admin" : (activeProject?.userRole || "viewer");

  const [systemGroups, setSystemGroups] = useState<any[]>([]);
  const [projectMembers, setProjectMembers] = useState<any[]>([]);

  useEffect(() => {
    if (loggedIn) {
      getGroups().then(setSystemGroups).catch(console.error);
    }
  }, [loggedIn]);

  const formattedGroups: Group[] = systemGroups.map((g: any) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    members: (g.users || []).map((u: any) => ({
      id: u.memberId || u.id,
      name: u.name,
    })),
  }));

  const projectMemberGroups: Group[] = (() => {
    const groupMap = new Map<string, { id: string; name: string; color: string; members: Member[] }>();
    projectMembers.forEach((pm: any) => {
      const user = pm.user;
      if (!user) return;
      const group = user.group;
      const groupId = group?.id || "ungrouped";
      const groupName = group?.name || "未分組";
      const groupColor = group?.color || "#64748b";
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, { id: groupId, name: groupName, color: groupColor, members: [] });
      }
      groupMap.get(groupId)!.members.push({ id: user.memberId || user.id, name: user.name });
    });
    return Array.from(groupMap.values());
  })();

  const handleLogout = () => {
    clearToken();
    setLoggedIn(false);
    setProjects([]);
    setProjectMembers([]);
    setMeetings([]);
    setRisks([]);
    setWeeklyReports([]);
    setNotifications([]);
    setUnreadCount(0);
    setSystemGroups([]);
    setView("kanban");
    setActiveProjectId("");
    setSearchQuery("");
    setSearchResults(null);
    setShowSearch(false);
    setShowExportMenu(false);
    setShowImportModal(false);
    setShowProjectModal(false);
    setShowGroupModal(false);
    setEditingTask(null);
    setFilterPriorities([]);
    setFilterAssignees([]);
    setFilterGroups([]);
    setSearchText("");
    setToast(null);
    setSidebarOpen(false);
  };

  const loadProjects = async () => {
    try {
      setLoading(true);
      const projectsData = await getProjects();
      console.log("API 回傳的專案:", JSON.stringify(projectsData, null, 2));

      const formatted: Project[] = await Promise.all(
        projectsData.map(async (p: any) => {
          let tasks: any[] = [];
          try { tasks = await getProjectTasks(p.id); } catch {}

          const columnMap: Record<string, Task[]> = {
            todo: [], inprogress: [], review: [], done: []
          };
          tasks.forEach((t: any) => {
            const col = t.columnId || "todo";
            if (!columnMap[col]) columnMap[col] = [];
            columnMap[col].push({
              ...t,
              startDate: normalizeDate(t.startDate || ""),
              endDate: normalizeDate(t.endDate || ""),
              subtasks: (t.subtasks || []).map((s: any) => ({
                ...s,
                startDate: normalizeDate(s.startDate || ""),
                endDate: normalizeDate(s.endDate || ""),
                timeLogs: s.timeLogs || [],
              })),
              timeLogs: t.timeLogs || [],
            });
          });

          return {
            id: p.id,
            name: p.name,
            description: p.description || "",
            color: p.color || "#6366f1",
            userRole: p.userRole || "viewer",
            groups: [],
            columns: [
              { id: "todo",       title: "待處理", tasks: columnMap.todo },
              { id: "inprogress", title: "進行中", tasks: columnMap.inprogress },
              { id: "review",     title: "審查中", tasks: columnMap.review },
              { id: "done",       title: "已完成", tasks: columnMap.done },
            ],
          };
        })
      );

      setProjects(formatted);
      setActiveProjectId((prev) => {
        if (formatted.length > 0 && !formatted.find((p) => p.id === prev)) {
          return formatted[0].id;
        }
        return prev;
      });
    } catch (err: any) {
      console.error("載入專案失敗:", err);
      if (err.message?.includes("登入已過期")) {
        setLoggedIn(false);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loggedIn) {
      loadProjects();
    }
  }, [loggedIn]);

  const loadProjectDetails = async (projectId: string) => {
    try {
      const [meetingsData, risksData, reportsData] = await Promise.all([
        getProjectMeetings(projectId),
        getProjectRisks(projectId),
        getWeeklyReports(projectId),
      ]);
      setMeetings(meetingsData);
      setRisks(risksData);
      setWeeklyReports(reportsData);
    } catch (err) {
      console.error("載入專案詳情失敗:", err);
    }
  };

  const loadProjectMembers = async (projectId: string) => {
    try {
      const members = await getProjectMembers(projectId);
      setProjectMembers(members);
    } catch (err) {
      console.error("載入專案成員失敗:", err);
      setProjectMembers([]);
    }
  };

  useEffect(() => {
    if (activeProjectId) {
      loadProjectDetails(activeProjectId);
      loadProjectMembers(activeProjectId);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const filteredColumns = columns.map((col) => ({
    ...col,
    tasks: col.tasks.filter((task) => {
      const memberName = (() => {
        const m = findMemberById(projectMemberGroups, task.assignee);
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

    if (!hasPermission(currentProjectRole, "drag_task")) return;

    const activeCol = findColumn(active.id as string);
    let overCol = columns.find((c) => c.id === over.id);
    if (!overCol) overCol = findColumn(over.id as string);
    if (!activeCol || !overCol || activeCol.id === overCol.id) return;

    // 從「已完成」拖出：只有 PM 以上可以
    if (activeCol.id === "done" && !hasPermission(currentProjectRole, "drag_to_done")) {
      setToast("只有 PM 以上可以將任務從已完成移出");
      return;
    }

    // 拖到「已完成」：檢查權限 + 完成度
    if (overCol.id === "done") {
      if (!hasPermission(currentProjectRole, "drag_to_done")) {
        setToast("只有 PM 以上可以將任務移至已完成");
        return;
      }
      const task = activeCol.tasks.find((t) => t.id === active.id);
      if (task) {
        const completion = getCompletion(task);
        if (completion < 100) {
          setToast(`「${task.title}」完成度為 ${completion}%，需達 100% 才能移至已完成`);
          return;
        }
      }
    }

    apiUpdateTask(active.id as string, { columnId: overCol.id }).catch(console.error);

    setColumns((cols) => cols.map((col) => {
      if (col.id === activeCol.id) return { ...col, tasks: col.tasks.filter((t) => t.id !== active.id) };
      if (col.id === overCol!.id) {
        if (col.tasks.some((t) => t.id === active.id)) return col;
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
    if (!activeCol || !overCol) return;

    // 從「已完成」拖出：只有 PM 以上可以
    if (activeCol.id === "done" && overCol.id !== "done" && !hasPermission(currentProjectRole, "drag_to_done")) {
      setToast("只有 PM 以上可以將任務從已完成移出");
      return;
    }

    // 拖到「已完成」：檢查權限 + 完成度
    if (activeCol.id !== overCol.id && overCol.id === "done") {
      if (!hasPermission(currentProjectRole, "drag_to_done")) {
        setToast("只有 PM 以上可以將任務移至已完成");
        return;
      }
      const task = activeCol.tasks.find((t) => t.id === active.id);
      if (task && getCompletion(task) < 100) {
        setToast(`「${task.title}」完成度為 ${getCompletion(task)}%，需達 100% 才能移至已完成`);
        return;
      }
    }

    if (activeCol.id === overCol.id) {
      const oldIdx = activeCol.tasks.findIndex((t) => t.id === active.id);
      const newIdx = overCol.tasks.findIndex((t) => t.id === over.id);
      if (oldIdx !== newIdx) {
        setColumns((cols) => cols.map((col) =>
          col.id === activeCol.id ? { ...col, tasks: arrayMove(col.tasks, oldIdx, newIdx) } : col
        ));
      }
    }
  };

  const handleAddTask = async (colId: string, title: string) => {
    try {
      const newTask = await createProjectTask(activeProjectId, {
        title,
        columnId: colId,
        priority: "medium",
        assignee: "",
        groupId: "",
      });
      setColumns((cols) => cols.map((col) =>
        col.id === colId ? {
          ...col,
          tasks: [...col.tasks, { ...newTask, subtasks: [], timeLogs: [] }]
        } : col
      ));
    } catch (err) {
      console.error("新增任務失敗:", err);
    }
  };

  const handleDeleteTask = async (colId: string, taskId: string) => {
    try {
      await apiDeleteTask(taskId);
      setColumns((cols) => cols.map((col) =>
        col.id === colId ? { ...col, tasks: col.tasks.filter((t) => t.id !== taskId) } : col
      ));
    } catch (err) {
      console.error("刪除任務失敗:", err);
    }
  };

  const handleSaveTask = async (updated: Task) => {
    try {
      await apiUpdateTask(updated.id, {
        title: updated.title,
        description: updated.description,
        priority: updated.priority,
        assignee: updated.assignee,
        groupId: updated.groupId,
        startDate: updated.startDate,
        endDate: updated.endDate,
        completion: updated.completion,
        timeLogs: updated.timeLogs,
        subtasks: updated.subtasks,
      });
      setColumns((cols) => cols.map((col) => ({
        ...col,
        tasks: col.tasks.map((t) => t.id === updated.id ? updated : t),
      })));
    } catch (err) {
      console.error("更新任務失敗:", err);
    }
  };

  const prepareTaskExportData = () => {
    const allTasks = columns.flatMap((c) => c.tasks);
    return allTasks.map((task) => {
      const group = projectMemberGroups.find((g) => g.id === task.groupId);
      const assignee = findMemberById(projectMemberGroups, task.assignee);
      return {
        title: task.title,
        group: group?.name || "未分組",
        assignee: assignee ? memberDisplay(assignee) : task.assignee || "未指派",
        priority: PRIORITY_CONFIG[task.priority].label + "優先",
        startDate: getEffectiveStartDate(task),
        endDate: getEffectiveEndDate(task),
        completion: getCompletion(task),
        subtasks: task.subtasks.map((sub) => {
          const subGroup = projectMemberGroups.find((g) => g.id === sub.groupId);
          const subAssignee = findMemberById(projectMemberGroups, sub.assignee);
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
        const member = findMemberById(projectMemberGroups, t.assignee);
        const group = projectMemberGroups.find((g) => g.id === t.groupId);
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
          const member = findMemberById(projectMemberGroups, s.assignee);
          const group = projectMemberGroups.find((g) => g.id === s.groupId);
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

  const loadNotifications = async () => {
    try {
      const [notifs, countData] = await Promise.all([getNotifications(), getUnreadCount()]);
      console.log("通知:", notifs, "未讀:", countData);
      setNotifications(notifs);
      setUnreadCount(countData.count);
    } catch (err) {
      console.error("載入通知失敗:", err);
    }
  };

  useEffect(() => {
    if (loggedIn) {
      loadNotifications();
      const interval = setInterval(loadNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [loggedIn]);

  useEffect(() => {
    const handleClick = () => setShowNotifications(false);
    if (showNotifications) {
      setTimeout(() => document.addEventListener("click", handleClick), 0);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [showNotifications]);

  const totalTasks = columns.reduce((s, c) => s + c.tasks.length, 0);
  const doneTasks = columns.find((c) => c.id === "done")?.tasks.length ?? 0;

  if (!loggedIn) {
    return <LoginPage onLogin={() => { setLoggedIn(true); setCurrentUser(getCurrentUser()); }} />;
  }

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", background: "#0f1117",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Segoe UI', system-ui, sans-serif"
      }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>📋</p>
          <p style={{ fontSize: 15, color: "#e2e8f0", marginBottom: 4 }}>PM Dashboard</p>
          <p style={{ fontSize: 13, color: "#64748b" }}>{t("app.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f1117; font-family: 'Segoe UI', system-ui, sans-serif; color: #e2e8f0; overflow-x: hidden; }
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

        button { transition: all .15s ease; }
        button:hover { filter: brightness(1.15); transform: translateY(-1px); }
        button:active { transform: scale(0.97); }
        .drag-handle:hover { filter: none; transform: none; }
        .dropdown-item:hover { background: #ffffff08 !important; filter: none; transform: none; }

        .modal-footer { display: flex; gap: 10px; padding: 14px 20px 18px; border-top: 1px solid #ffffff08; }
        .btn-cancel { flex: 1; background: #ffffff10; border: none; border-radius: 8px; color: #94a3b8; font-size: 13px; padding: 10px; cursor: pointer; }
        .btn-cancel:hover { background: #ffffff18; filter: none; }
        .btn-save { flex: 2; background: #6366f1; border: none; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; padding: 10px; cursor: pointer; }
        .btn-save:hover { background: #4f46e5; box-shadow: 0 2px 8px #6366f144; filter: none; }
        .confirm-btn:hover { background: #4f46e5; box-shadow: 0 2px 8px #6366f144; filter: none; }
        .add-btn:hover { background: #ffffff15; filter: none; }

        @keyframes toast-in {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        /* 手機版 RWD */
        /* 手機版適配 */
        @media (max-width: 768px) {
          .hamburger-btn { display: flex !important; }
          .sidebar {
            transform: translateX(-100%);
            transition: transform .2s ease;
            z-index: 55 !important;
          }
          .sidebar.open { transform: translateX(0); }
          .app { padding: 12px !important; margin-left: 0 !important; }
          .main-content {
            margin-left: 0 !important;
            width: 100% !important;
            max-width: 100vw !important;
            overflow-x: hidden !important;
          }
          .page-content {
            padding: 84px 12px 24px !important;
          }
          .sidebar-overlay { display: block !important; }
          .topbar {
            flex-direction: column !important;
            gap: 8px !important;
            align-items: stretch !important;
            padding-bottom: 12px !important;
          }
          .topbar-left h1 { font-size: 18px !important; }
          .topbar-left p { font-size: 12px !important; }
          .progress-wrap { justify-content: flex-start !important; }
          .board { grid-template-columns: 1fr !important; gap: 12px !important; }
          .filter-row {
            flex-wrap: wrap !important;
            gap: 6px !important;
          }
          .filter-row .field-input { min-width: 100% !important; }
          .topbar-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          .stats-grid-4 { grid-template-columns: repeat(2, 1fr) !important; }
          .stats-grid-3 { grid-template-columns: 1fr !important; }
          .stats-grid-5 { grid-template-columns: repeat(2, 1fr) !important; }
          .stats-grid-3,
          .stats-grid-4,
          .stats-grid-5,
          .charts-grid {
            min-width: 0 !important;
          }
          .stats-grid-3 > *,
          .stats-grid-4 > *,
          .stats-grid-5 > *,
          .charts-grid > * {
            min-width: 0 !important;
          }
          .charts-grid { grid-template-columns: 1fr !important; }
          .weekly-toolbar {
            flex-wrap: wrap !important;
            justify-content: center !important;
            gap: 10px !important;
            padding: 14px 12px !important;
          }
          .weekly-toolbar-title {
            order: -1;
            width: 100% !important;
          }
          .weekly-toolbar button {
            flex: 1 1 calc(50% - 8px);
            min-width: 0;
          }
          .okr-actions {
            justify-content: stretch !important;
          }
          .okr-actions button {
            width: 100% !important;
          }
          .okr-objective-head {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
          }
          .okr-objective-title {
            min-width: 0 !important;
            overflow-wrap: anywhere;
          }
          .okr-objective-controls {
            justify-content: space-between !important;
            flex-wrap: wrap !important;
          }
          .okr-kr-row {
            align-items: flex-start !important;
            flex-wrap: wrap !important;
          }
          .okr-kr-body {
            min-width: 0 !important;
            flex: 1 1 180px !important;
          }
          .okr-kr-controls {
            width: 100% !important;
            justify-content: flex-end !important;
          }
          .mobile-form-row {
            flex-direction: column !important;
          }
          .admin-page {
            max-width: none !important;
          }
          .admin-stats {
            display: grid !important;
            grid-template-columns: 1fr !important;
            gap: 12px !important;
          }
          .admin-table-wrap {
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch;
          }
          .admin-table-wrap table {
            min-width: 720px !important;
          }
          .admin-table-wrap th,
          .admin-table-wrap td {
            white-space: nowrap !important;
          }
          .modal {
            width: 95vw !important;
            max-height: 85vh !important;
          }
          .gantt-frozen { width: 140px !important; min-width: 140px !important; }
          .calendar-layout { flex-direction: column !important; }
          .calendar-detail { width: 100% !important; }
          .desktop-only { display: none !important; }
        }

        @media (min-width: 769px) {
          .hamburger-btn { display: none !important; }
          .sidebar-overlay { display: none !important; }
        }
      `}</style>

      {/* 漢堡按鈕（手機版） */}
      <button className="hamburger-btn" onClick={() => setSidebarOpen(!sidebarOpen)} style={{
        display: "none",
        position: "fixed", top: 12, left: 12, zIndex: 60,
        background: "#161b27", border: "1px solid #ffffff12",
        borderRadius: 8, color: "#e2e8f0", fontSize: 20,
        padding: "8px 12px", cursor: "pointer",
      }}>☰</button>

      {/* Sidebar 背景遮罩（手機版） */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}
          style={{ display: "none", position: "fixed", inset: 0, background: "#00000066", zIndex: 50 }} />
      )}

      <Sidebar
        view={view}
        setView={setView}
        projects={projects}
        activeProjectId={activeProjectId}
        setActiveProjectId={setActiveProjectId}
        onAddProject={handleAddProject}
        onDeleteProject={handleDeleteProject}
        onManageGroups={() => setShowGroupModal(true)}
        onLogout={handleLogout}
        currentUser={currentUser}
        currentProjectRole={currentProjectRole}
        language={language}
        onLanguageChange={handleLanguageChange}
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {<Suspense fallback={
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "#64748b" }}>
                載入中...
              </div>
            }>{view === "admin" && currentUser?.role === "admin" ? (
        <div className="main-content page-content" style={{ marginLeft: 200 }}>
          <AdminView currentUser={currentUser} />
        </div>
      ) : view === "project_members" && activeProject ? (
        <div className="main-content page-content" style={{ marginLeft: 200, padding: "32px 40px" }}>
          <ProjectMembersView
            projectId={activeProject.id}
            projectName={activeProject.name}
            currentUser={currentUser}
            currentProjectRole={currentProjectRole}
            onMembersChange={() => loadProjectMembers(activeProjectId)}
          />
        </div>
      ) : view === "activities" && activeProject ? (
        <div className="main-content page-content" style={{ marginLeft: 200, padding: "32px 40px" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", marginBottom: 20 }}>
            活動紀錄 · {activeProject.name}
          </h2>
          <ActivityView projectId={activeProject.id} />
        </div>
      ) : view === "calendar" && activeProject ? (
        <div className="main-content page-content" style={{ marginLeft: 200, padding: "32px 40px" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", marginBottom: 20 }}>
            行事曆 · {activeProject.name}
          </h2>
          <CalendarView columns={columns} meetings={meetings} groups={projectMemberGroups} />
        </div>
      ) : view === "okr" && activeProject ? (
        <div className="main-content page-content" style={{ marginLeft: 200, padding: "32px 40px" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", marginBottom: 20 }}>
            OKR · {activeProject.name}
          </h2>
          <OKRView projectId={activeProject.id} canManage={hasPermission(currentProjectRole, "manage_weekly")} />
        </div>
      ) : null}</Suspense>}

      <div className="main-content" style={{ marginLeft: 200, display: (view === "admin" || view === "project_members" || view === "activities" || view === "calendar" || view === "okr") ? "none" : undefined }}>
        <div className="app">
          <div className="topbar">
            <div className="topbar-left">
              <h1>{activeProject?.name || t("app.title")}</h1>
              <p>{totalTasks} {t("kanban.totalTasks")} · {doneTasks} {t("kanban.completed")}</p>
            </div>
            <div className="progress-wrap topbar-actions">
              <span className="progress-label">{t("kanban.progress")}</span>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: totalTasks ? `${(doneTasks / totalTasks) * 100}%` : "0%" }} />
              </div>
              <span className="progress-label">{totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0}%</span>

              {/* 搜尋按鈕 */}
              <button onClick={() => setShowSearch(true)} style={{
                background: "none", border: "none", color: "#94a3b8",
                cursor: "pointer", padding: 8, borderRadius: 8, display: "flex", alignItems: "center"
              }}>
                🔍
              </button>

              {/* 通知鈴鐺 */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowNotifications(!showNotifications)} style={{
                  background: "none", border: "none", color: "#94a3b8",
                  cursor: "pointer", padding: 8, borderRadius: 8, position: "relative",
                  display: "flex", alignItems: "center"
                }}>
                  🔔
                  {unreadCount > 0 && (
                    <span style={{
                      position: "absolute", top: 2, right: 2,
                      background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 700,
                      width: 16, height: 16, borderRadius: 99,
                      display: "flex", alignItems: "center", justifyContent: "center"
                    }}>{unreadCount > 9 ? "9+" : unreadCount}</span>
                  )}
                </button>

                {showNotifications && (
                  <div onClick={(e) => e.stopPropagation()} style={{
                    position: "absolute", top: "100%", right: 0, marginTop: 8,
                    background: "#1a2030", border: "1px solid #ffffff12", borderRadius: 12,
                    width: 360, maxHeight: 480, overflow: "hidden",
                    boxShadow: "0 16px 48px #000a", zIndex: 200
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "14px 16px", borderBottom: "1px solid #ffffff08"
                    }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{t("notifications.title")}</span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {unreadCount > 0 && (
                          <button onClick={async () => { await markAllAsRead(); loadNotifications(); }} style={{
                            background: "none", border: "none", color: "#6366f1",
                            fontSize: 11, cursor: "pointer"
                          }}>{t("notifications.readAll")}</button>
                        )}
                        <button onClick={() => setShowNotifications(false)} style={{
                          background: "none", border: "none", color: "#64748b",
                          cursor: "pointer", padding: 2, display: "flex"
                        }}><X size={14} /></button>
                      </div>
                    </div>

                    <div style={{ maxHeight: 400, overflowY: "auto" }}>
                      {notifications.length === 0 ? (
                        <div style={{ padding: 32, textAlign: "center", color: "#475569", fontSize: 13 }}>{t("notifications.empty")}</div>
                      ) : notifications.map((n: any) => {
                        const NOTIF_ICONS: Record<string, string> = {
                          task_assigned: "📋", task_moved: "🔄",
                          project_invited: "👋", risk_updated: "⚠️", meeting_created: "📅",
                          comment_added: "💬",
                        };
                        return (
                          <div key={n.id} onClick={async () => {
                            if (!n.isRead) { await markAsRead(n.id); loadNotifications(); }
                          }} style={{
                            padding: "12px 16px", borderBottom: "1px solid #ffffff06",
                            cursor: n.isRead ? "default" : "pointer",
                            background: n.isRead ? "transparent" : "#6366f108",
                          }}>
                            <div style={{ display: "flex", gap: 10 }}>
                              <span style={{ fontSize: 18, flexShrink: 0 }}>{NOTIF_ICONS[n.type] || "📌"}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: n.isRead ? "#94a3b8" : "#e2e8f0" }}>{n.title}</span>
                                  {!n.isRead && (
                                    <div style={{ width: 6, height: 6, borderRadius: 99, background: "#6366f1", flexShrink: 0 }} />
                                  )}
                                </div>
                                <p style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>{n.message}</p>
                                <span style={{ fontSize: 10, color: "#475569", marginTop: 4, display: "block" }}>
                                  {new Date(n.createdAt).toLocaleString("zh-TW")}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {hasPermission(currentProjectRole, "create_task") && (
                <button onClick={() => setShowImportModal(true)} style={{
                  background: "#10b98122", border: "1px solid #10b98144",
                  borderRadius: 8, color: "#10b981", fontSize: 13, fontWeight: 600,
                  padding: "6px 16px", cursor: "pointer"
                }}>{t("app.import")}</button>
              )}

              {hasPermission(currentProjectRole, "export") && <div style={{ position: "relative" }}>
                <button onClick={() => setShowExportMenu((prev) => !prev)}
                  style={{
                    background: "#6366f122", border: "1px solid #6366f144",
                    borderRadius: 8, color: "#6366f1", fontSize: 13, fontWeight: 600,
                    padding: "6px 16px", cursor: "pointer"
                  }}>
                  {t("app.export")} ▾
                </button>

                {showExportMenu && (
                  <div style={{
                    position: "absolute", top: "100%", right: 0, marginTop: 6,
                    background: "#1a2030", border: "1px solid #ffffff12", borderRadius: 10,
                    padding: 6, zIndex: 100, minWidth: 200,
                    boxShadow: "0 12px 32px #000a"
                  }}>
                    <p style={{ fontSize: 10, color: "#475569", padding: "4px 10px", textTransform: "uppercase", letterSpacing: ".05em" }}>{t("export.taskList")}</p>
                    <button className="dropdown-item" onClick={() => { exportTaskListCSV(activeProject.name, prepareTaskExportData()); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}>
                      {t("export.taskListCsv")}
                    </button>
                    <button className="dropdown-item" onClick={() => { exportTaskListPDF(activeProject.name, prepareTaskExportData()); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}>
                      {t("export.taskListPdf")}
                    </button>

                    <div style={{ height: 1, background: "#ffffff08", margin: "4px 0" }} />

                    <p style={{ fontSize: 10, color: "#475569", padding: "4px 10px", textTransform: "uppercase", letterSpacing: ".05em" }}>{t("export.timeReport")}</p>
                    <button className="dropdown-item" onClick={() => { exportTimeReportCSV(activeProject.name, prepareTimeReportData()); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}>
                      {t("export.timeReportCsv")}
                    </button>
                    <button className="dropdown-item" onClick={() => { exportTimeReportPDF(activeProject.name, prepareTimeReportData()); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}>
                      {t("export.timeReportPdf")}
                    </button>

                    <div style={{ height: 1, background: "#ffffff08", margin: "4px 0" }} />

                    <p style={{ fontSize: 10, color: "#475569", padding: "4px 10px", textTransform: "uppercase", letterSpacing: ".05em" }}>{t("export.gantt")}</p>
                    <button className="dropdown-item" onClick={() => { exportGanttPNG("gantt-container", activeProject.name); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e2e8f0", fontSize: 12, padding: "8px 10px", borderRadius: 6, cursor: "pointer" }}>
                      {t("export.ganttPng")}
                    </button>
                  </div>
                )}
              </div>}
            </div>
          </div>

          {(view === "kanban" || view === "gantt") && (
            <div className="filter-row" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <input className="field-input" placeholder={t("filter.search")}
                  value={searchText} onChange={(e) => setSearchText(e.target.value)}
                  style={{ fontSize: 13 }} />
              </div>

              <MultiSelect
                options={projectMemberGroups.map(g => ({ id: g.id, label: g.name, color: g.color }))}
                selected={filterGroups}
                onChange={(newGroups) => {
                  setFilterGroups(newGroups);
                  const remainingMembers = projectMemberGroups
                    .filter(g => newGroups.includes(g.id))
                    .flatMap(g => g.members || []);
                  setFilterAssignees(filterAssignees.filter(a => remainingMembers.some(m => m.id === a)));
                }}
                placeholder="所有組別"
              />

              {filterGroups.length > 0 && (() => {
                const availableMembers = Array.from(
                  new Map(
                    projectMemberGroups
                      .filter(g => filterGroups.includes(g.id))
                      .flatMap(g => g.members || [])
                      .map(m => [m.id, m])
                  ).values()
                );
                if (availableMembers.length === 0) return null;
                return (
                  <MultiSelect
                    options={availableMembers.map(m => ({ id: m.id, label: `${m.name}（${m.id}）` }))}
                    selected={filterAssignees}
                    onChange={setFilterAssignees}
                    placeholder="所有成員"
                  />
                );
              })()}

              <MultiSelect
                options={[
                  { id: "high",   label: "高優先", color: "#f87171" },
                  { id: "medium", label: "中優先", color: "#facc15" },
                  { id: "low",    label: "低優先", color: "#4ade80" },
                ]}
                selected={filterPriorities}
                onChange={setFilterPriorities}
                placeholder="所有優先級"
              />

              {(searchText || filterPriorities.length > 0 || filterAssignees.length > 0 || filterGroups.length > 0) && (
                <button onClick={() => { setSearchText(""); setFilterPriorities([]); setFilterAssignees([]); setFilterGroups([]); }}
                  style={{ background: "#ef444422", border: "1px solid #ef444444", borderRadius: 8, color: "#ef4444", fontSize: 12, padding: "8px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {t("filter.clear")}
                </button>
              )}
            </div>
          )}

          {<Suspense fallback={
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "#64748b" }}>
                載入中...
              </div>
            }>{view === "kanban" ? (
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
              <div className="board">
                {filteredColumns.map((col) => (
                  <ColumnComponent key={col.id} column={col} canAdd={hasPermission(currentProjectRole, "create_task")} canDrag={hasPermission(currentProjectRole, "drag_task")} onAddTask={handleAddTask} onDeleteTask={handleDeleteTask} onEditTask={setEditingTask} groups={projectMemberGroups} />
                ))}
              </div>
              <DragOverlay>{activeTask && <TaskCard task={activeTask} isDragging groups={projectMemberGroups} />}</DragOverlay>
            </DndContext>
          ) : view === "gantt" ? (
            <GanttView columns={filteredColumns} onEditTask={setEditingTask} />
          ) : view === "dashboard" ? (
            <DashboardView columns={columns} groups={projectMemberGroups} />
          ) : view === "meetings" ? (
            <MeetingsView
              meetings={meetings}
              projectMembers={projectMembers}
              onCreateSeries={handleCreateMeetingSeries}
              onDeleteSeries={handleDeleteMeetingSeries}
              onCreateRecord={handleCreateMeetingRecord}
              onDeleteRecord={handleDeleteMeetingRecord}
              onUpdateRecord={handleUpdateMeetingRecord}
            />
          ) : view === "risks" ? (
            <RiskMatrixView
              risks={risks}
              groups={formattedGroups}
              onCreateRisk={handleCreateRisk}
              onUpdateRisk={handleUpdateRisk}
              onDeleteRisk={handleDeleteRisk}
              canManage={hasPermission(currentProjectRole, "manage_risks")}
              projectMembers={projectMembers}
              currentProjectRole={currentProjectRole}
              currentUser={currentUser}
            />
          ) : (
            <WeeklyReportView
              columns={columns}
              groups={projectMemberGroups}
              risks={risks}
              weeklyReports={weeklyReports}
              onSaveNotes={handleSaveWeeklyNotes}
              projectName={activeProject?.name || ""}
            />
          )}</Suspense>}
        </div>
      </div>

      {editingTask && (
        <TaskModal task={editingTask} groups={projectMemberGroups} onSave={handleSaveTask} onClose={() => setEditingTask(null)} currentProjectRole={currentProjectRole} currentUser={currentUser} />
      )}

      {<Suspense fallback={null}>{showImportModal && (
        <ImportModal
          projectId={activeProjectId}
          onClose={() => setShowImportModal(false)}
          onSuccess={() => loadProjects()}
        />
      )}</Suspense>}

      {showProjectModal && (
        <ProjectModal
          onSave={handleSaveProject}
          onClose={() => setShowProjectModal(false)}
        />
      )}

      {showGroupModal && (
        <GroupModal
          groups={formattedGroups}
          onSave={async (updatedGroups) => {
            const existingIds = new Set(formattedGroups.map((g) => g.id));
            const newIds = new Set(updatedGroups.map((g) => g.id));
            for (const g of updatedGroups) {
              if (!existingIds.has(g.id)) {
                try { await apiCreateGroup(activeProject?.id || "", { name: g.name, color: g.color }); } catch {}
              } else {
                try { await apiUpdateGroup(g.id, { name: g.name, color: g.color }); } catch {}
              }
            }
            for (const g of formattedGroups) {
              if (!newIds.has(g.id)) {
                try { await apiDeleteGroup(g.id); } catch {}
              }
            }
            getGroups().then(setSystemGroups).catch(console.error);
          }}
          onClose={() => setShowGroupModal(false)}
        />
      )}

      {showSearch && (
        <div style={{
          position: "fixed", inset: 0, background: "#00000088",
          display: "flex", alignItems: "flex-start", justifyContent: "center",
          zIndex: 300, paddingTop: 80, backdropFilter: "blur(4px)"
        }} onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults(null); }}>
          <div style={{
            background: "#1a2030", borderRadius: 14, border: "1px solid #ffffff12",
            width: 600, maxWidth: "95vw", maxHeight: "70vh",
            boxShadow: "0 24px 64px #000a", overflow: "hidden",
            animation: "modal-in .18s ease"
          }} onClick={(e) => e.stopPropagation()}>

            {/* 搜尋輸入 */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid #ffffff08" }}>
              <span style={{ fontSize: 18 }}>🔍</span>
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="搜尋任務、風險、會議紀錄..."
                style={{
                  flex: 1, background: "transparent", border: "none",
                  color: "#e2e8f0", fontSize: 15, outline: "none", fontFamily: "inherit"
                }}
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(""); setSearchResults(null); }} style={{
                  background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 4, display: "flex"
                }}><X size={16} /></button>
              )}
              <button onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults(null); }} style={{
                background: "#ffffff10", border: "none", borderRadius: 6,
                color: "#94a3b8", fontSize: 11, padding: "4px 10px", cursor: "pointer"
              }}>ESC</button>
            </div>

            {/* 搜尋結果 */}
            <div style={{ maxHeight: "calc(70vh - 60px)", overflowY: "auto", padding: "12px 20px" }}>
              {searching ? (
                <p style={{ textAlign: "center", color: "#475569", padding: 20, fontSize: 13 }}>搜尋中...</p>
              ) : !searchResults ? (
                <p style={{ textAlign: "center", color: "#475569", padding: 20, fontSize: 13 }}>輸入關鍵字開始搜尋</p>
              ) : (
                <>
                  {searchResults.tasks?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>
                        📋 任務（{searchResults.tasks.length}）
                      </p>
                      {searchResults.tasks.map((t: any) => (
                        <div key={t.id} onClick={() => {
                          setEditingTask(t);
                          setShowSearch(false);
                          setSearchQuery("");
                          setSearchResults(null);
                        }} style={{
                          padding: "10px 12px", borderRadius: 8, marginBottom: 4,
                          background: "#0f1117", border: "1px solid #ffffff08", cursor: "pointer"
                        }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{t.title}</span>
                            <span style={{ fontSize: 10, color: "#6366f1" }}>{t.completion || 0}%</span>
                          </div>
                          {t.description && (
                            <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                              {t.description.slice(0, 80)}{t.description.length > 80 ? "..." : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.subtasks?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: "#8b5cf6", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>
                        📎 子任務（{searchResults.subtasks.length}）
                      </p>
                      {searchResults.subtasks.map((s: any) => (
                        <div key={s.id} style={{
                          padding: "10px 12px", borderRadius: 8, marginBottom: 4,
                          background: "#0f1117", border: "1px solid #ffffff08"
                        }}>
                          <span style={{ fontSize: 12, color: "#e2e8f0" }}>{s.title}</span>
                          {s.task && (
                            <span style={{ fontSize: 10, color: "#475569", marginLeft: 8 }}>
                              屬於「{s.task.title}」
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.risks?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: "#ef4444", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>
                        ⚠️ 風險（{searchResults.risks.length}）
                      </p>
                      {searchResults.risks.map((r: any) => (
                        <div key={r.id} style={{
                          padding: "10px 12px", borderRadius: 8, marginBottom: 4,
                          background: "#0f1117", border: "1px solid #ffffff08"
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{r.title}</span>
                            <span style={{
                              fontSize: 9, padding: "1px 6px", borderRadius: 99,
                              background: r.status === "occurred" ? "#ef444422" : r.status === "resolved" ? "#10b98122" : "#f59e0b22",
                              color: r.status === "occurred" ? "#ef4444" : r.status === "resolved" ? "#10b981" : "#f59e0b"
                            }}>{r.status === "monitoring" ? "監控中" : r.status === "occurred" ? "已發生" : "已解除"}</span>
                          </div>
                          {r.description && (
                            <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                              {r.description.slice(0, 80)}{r.description.length > 80 ? "..." : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.meetings?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: "#10b981", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>
                        📅 會議紀錄（{searchResults.meetings.length}）
                      </p>
                      {searchResults.meetings.map((m: any) => (
                        <div key={m.id} style={{
                          padding: "10px 12px", borderRadius: 8, marginBottom: 4,
                          background: "#0f1117", border: "1px solid #ffffff08"
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{m.series?.name || ""}</span>
                            <span style={{ fontSize: 10, color: "#475569" }}>{m.date}</span>
                          </div>
                          {m.summary && (
                            <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                              {m.summary.slice(0, 80)}{m.summary.length > 80 ? "..." : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {(!searchResults.tasks?.length && !searchResults.subtasks?.length &&
                    !searchResults.risks?.length && !searchResults.meetings?.length) && (
                    <p style={{ textAlign: "center", color: "#475569", padding: 20, fontSize: 13 }}>
                      找不到「{searchQuery}」的相關結果
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#f59e0b", color: "#000", fontSize: 13, fontWeight: 600,
          padding: "12px 24px", borderRadius: 10, zIndex: 200,
          boxShadow: "0 8px 24px #0006",
          animation: "toast-in .2s ease"
        }}>
          ⚠️ {toast}
        </div>
      )}
    </>
  );
}
