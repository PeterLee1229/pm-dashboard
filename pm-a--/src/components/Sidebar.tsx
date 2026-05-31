import { t, type Language } from "../i18n";
import { Plus, X, Circle, Clock, CheckCircle2, AlertCircle, User, AlignLeft, Calendar, BarChart2 } from "lucide-react";
import type { Project } from "../types";
import { hasPermission } from "../helpers";

export default function Sidebar({ view, setView, projects, activeProjectId, setActiveProjectId, onAddProject, onDeleteProject, onManageGroups, onLogout, currentUser, currentProjectRole, language, onLanguageChange, sidebarOpen, onClose }: {
  view: "kanban" | "gantt" | "dashboard" | "meetings" | "risks" | "weekly" | "admin" | "project_members" | "activities" | "calendar" | "okr";
  setView: (v: "kanban" | "gantt" | "dashboard" | "meetings" | "risks" | "weekly" | "admin" | "project_members" | "activities" | "calendar" | "okr") => void;
  projects: Project[];
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  onAddProject: () => void;
  onDeleteProject: (id: string) => void;
  onManageGroups: () => void;
  onLogout: () => void;
  currentUser: any;
  currentProjectRole: string;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  sidebarOpen: boolean;
  onClose: () => void;
}) {
  const nav = (id: typeof view, label: string, icon: React.ReactNode) => {
    const active = view === id;
    return (
      <button key={id} onClick={() => { setView(id); onClose(); }} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px", borderRadius: 8, border: "none",
        background: active ? "#6366f122" : "transparent",
        color: active ? "#6366f1" : "#64748b",
        fontSize: 13, fontWeight: active ? 600 : 400,
        cursor: "pointer", textAlign: "left",
        borderLeft: active ? "3px solid #6366f1" : "3px solid transparent",
        width: "100%",
      }}>
        {icon}{label}
      </button>
    );
  };

  return (
    <div className={`sidebar${sidebarOpen ? " open" : ""}`} style={{
      width: 200, height: "100vh", background: "#111827",
      borderRight: "1px solid #ffffff08",
      display: "flex", flexDirection: "column",
      position: "fixed", top: 0, left: 0, zIndex: 50,
    }}>
      {/* 上半部：可滾動 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 12px 12px" }}>
        {/* Logo */}
        <div style={{ padding: "0 8px 20px" }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", letterSpacing: -0.5 }}>{t("app.title")}</p>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{t("app.subtitle")}</p>
        </div>

        {/* 專案列表 */}
        <div style={{ paddingBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 10px" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: ".05em" }}>{t("sidebar.projects")}</span>
            <button onClick={onAddProject} style={{
              background: "none", border: "none", color: "#475569", cursor: "pointer",
              padding: 2, display: "flex", borderRadius: 4,
            }}><Plus size={14} /></button>
          </div>

          {projects.map((p) => {
            const active = p.id === activeProjectId;
            return (
              <div key={p.id} style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <button onClick={() => { setActiveProjectId(p.id); onClose(); }} style={{
                  flex: 1, display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", borderRadius: 8, border: "none",
                  background: active ? p.color + "18" : "transparent",
                  color: active ? p.color : "#64748b",
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  cursor: "pointer", textAlign: "left",
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
        {nav("kanban",    t("sidebar.kanban"),    <Circle size={16} />)}
        {nav("gantt",     t("sidebar.gantt"),     <Clock size={16} />)}
        {nav("dashboard", t("sidebar.dashboard"), <BarChart2 size={16} />)}
        {hasPermission(currentProjectRole, "manage_meetings") && nav("meetings", t("sidebar.meetings"), <AlignLeft size={16} />)}
        {hasPermission(currentProjectRole, "view_risks")       && nav("risks",    t("sidebar.risks"),    <AlertCircle size={16} />)}
        {hasPermission(currentProjectRole, "manage_weekly")   && nav("weekly",   t("sidebar.weekly"),   <CheckCircle2 size={16} />)}
        <button onClick={() => { setView("okr"); onClose(); }} style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 8, border: "none",
          background: view === "okr" ? "#6366f122" : "transparent",
          color: view === "okr" ? "#6366f1" : "#64748b",
          fontSize: 13, fontWeight: view === "okr" ? 600 : 400,
          cursor: "pointer", textAlign: "left", width: "100%",
          borderLeft: view === "okr" ? "3px solid #6366f1" : "3px solid transparent"
        }}>
          🎯 {t("sidebar.okr")}
        </button>

        {/* 專案成員 + 管理功能 */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #ffffff08" }}>
          {hasPermission(currentProjectRole, "manage_members") && (
            <button onClick={() => { setView("project_members"); onClose(); }} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 8, border: "none",
              background: view === "project_members" ? "#6366f122" : "transparent",
              color: view === "project_members" ? "#6366f1" : "#64748b",
              fontSize: 13, fontWeight: view === "project_members" ? 600 : 400,
              cursor: "pointer", textAlign: "left", width: "100%",
              borderLeft: view === "project_members" ? "3px solid #6366f1" : "3px solid transparent"
            }}>
              <User size={16} /> {t("sidebar.projectMembers")}
            </button>
          )}
          <button onClick={() => { setView("activities"); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 8, border: "none",
            background: view === "activities" ? "#6366f122" : "transparent",
            color: view === "activities" ? "#6366f1" : "#64748b",
            fontSize: 13, fontWeight: view === "activities" ? 600 : 400,
            cursor: "pointer", textAlign: "left", width: "100%",
            borderLeft: view === "activities" ? "3px solid #6366f1" : "3px solid transparent"
          }}>
            <Clock size={16} /> {t("sidebar.activities")}
          </button>
          <button onClick={() => { setView("calendar"); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 8, border: "none",
            background: view === "calendar" ? "#6366f122" : "transparent",
            color: view === "calendar" ? "#6366f1" : "#64748b",
            fontSize: 13, fontWeight: view === "calendar" ? 600 : 400,
            cursor: "pointer", textAlign: "left", width: "100%",
            borderLeft: view === "calendar" ? "3px solid #6366f1" : "3px solid transparent"
          }}>
            <Calendar size={16} /> {t("sidebar.calendar")}
          </button>
        </div>

        {/* 系統管理（僅 admin） */}
        {currentUser?.role === "admin" && (
          <div style={{ marginTop: 4 }}>
            <button onClick={onManageGroups} style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "10px 12px", borderRadius: 8, border: "none",
              background: "transparent", color: "#64748b",
              fontSize: 13, cursor: "pointer", textAlign: "left",
              borderLeft: "3px solid transparent"
            }}>
              <User size={16} /> {t("sidebar.manageGroups")}
            </button>
            <button onClick={() => { setView("admin"); onClose(); }} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 8, border: "none",
              background: view === "admin" ? "#ef444422" : "transparent",
              color: view === "admin" ? "#ef4444" : "#64748b",
              fontSize: 13, fontWeight: view === "admin" ? 600 : 400,
              cursor: "pointer", textAlign: "left", width: "100%",
              borderLeft: view === "admin" ? "3px solid #ef4444" : "3px solid transparent"
            }}>
              ⚙️ {t("sidebar.admin")}
            </button>
          </div>
        )}
      </div>

      {/* 下半部：固定底部 */}
      <div style={{ padding: "12px", borderTop: "1px solid #ffffff08" }}>
        {/* 語言切換 */}
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          <button onClick={() => onLanguageChange("zh")} style={{
            flex: 1, background: language === "zh" ? "#6366f122" : "transparent",
            border: `1px solid ${language === "zh" ? "#6366f1" : "#ffffff15"}`,
            color: language === "zh" ? "#6366f1" : "#64748b",
            borderRadius: 6, padding: "4px", fontSize: 11, cursor: "pointer"
          }}>中文</button>
          <button onClick={() => onLanguageChange("en")} style={{
            flex: 1, background: language === "en" ? "#6366f122" : "transparent",
            border: `1px solid ${language === "en" ? "#6366f1" : "#ffffff15"}`,
            color: language === "en" ? "#6366f1" : "#64748b",
            borderRadius: 6, padding: "4px", fontSize: 11, cursor: "pointer"
          }}>EN</button>
        </div>
        <button onClick={onLogout} style={{
          display: "flex", alignItems: "center", gap: 8,
          width: "100%", padding: "10px 12px", borderRadius: 8, border: "none",
          background: "transparent", color: "#ef4444",
          fontSize: 12, cursor: "pointer", textAlign: "left",
        }}>
          <X size={14} /> {t("app.logout")}
        </button>
      </div>
    </div>
  );
}
