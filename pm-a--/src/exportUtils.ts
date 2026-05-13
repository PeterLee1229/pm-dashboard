import jsPDF from "jspdf";
import "jspdf-autotable";
import { toPng } from "html-to-image";

// 讓 TypeScript 認識 autoTable
declare module "jspdf" {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

// ── CSV 匯出 ──────────────────────────────────────────────────────

export function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = "﻿";
  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${(cell || "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");

  const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ── PDF 匯出（任務清單）──────────────────────────────────────────

export function exportTaskListPDF(
  projectName: string,
  tasks: {
    title: string;
    group: string;
    assignee: string;
    priority: string;
    startDate: string;
    endDate: string;
    completion: number;
    subtasks: {
      title: string;
      group: string;
      assignee: string;
      startDate: string;
      endDate: string;
      completion: number;
    }[];
  }[]
) {
  const doc = new jsPDF({ orientation: "landscape" });

  // 載入中文字型支援 - 使用內建 helvetica 搭配 unicode
  doc.setFont("helvetica");

  // 標題
  doc.setFontSize(16);
  doc.text(`${projectName} - Task List`, 14, 15);
  doc.setFontSize(10);
  doc.text(`Export Date: ${new Date().toLocaleDateString()}`, 14, 22);

  // 表格資料
  const tableRows: any[] = [];

  tasks.forEach((task) => {
    tableRows.push([
      task.title,
      task.group,
      task.assignee,
      task.priority,
      task.startDate || "-",
      task.endDate || "-",
      `${task.completion}%`,
    ]);

    task.subtasks.forEach((sub) => {
      tableRows.push([
        `  ↳ ${sub.title}`,
        sub.group,
        sub.assignee,
        "",
        sub.startDate || "-",
        sub.endDate || "-",
        `${sub.completion}%`,
      ]);
    });
  });

  doc.autoTable({
    startY: 28,
    head: [["Task", "Group", "Assignee", "Priority", "Start", "End", "Completion"]],
    body: tableRows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 60 },
      6: { halign: "center" },
    },
  });

  doc.save(`${projectName}_TaskList.pdf`);
}

// ── PDF 匯出（工時報表）──────────────────────────────────────────

export function exportTimeReportPDF(
  projectName: string,
  memberHours: {
    name: string;
    memberId: string;
    group: string;
    totalHours: number;
    logs: { task: string; date: string; hours: number }[];
  }[]
) {
  const doc = new jsPDF();

  doc.setFont("helvetica");
  doc.setFontSize(16);
  doc.text(`${projectName} - Time Report`, 14, 15);
  doc.setFontSize(10);
  doc.text(`Export Date: ${new Date().toLocaleDateString()}`, 14, 22);

  // 彙總表
  const summaryRows = memberHours.map((m) => [
    m.name,
    m.memberId,
    m.group,
    `${m.totalHours} h`,
  ]);

  doc.autoTable({
    startY: 28,
    head: [["Name", "ID", "Group", "Total Hours"]],
    body: summaryRows,
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  // 明細表
  let startY = (doc as any).lastAutoTable.finalY + 12;

  memberHours.forEach((m) => {
    if (m.logs.length === 0) return;

    if (startY > 250) {
      doc.addPage();
      startY = 15;
    }

    doc.setFontSize(11);
    doc.text(`${m.name} (${m.memberId}) - ${m.group}`, 14, startY);
    startY += 4;

    doc.autoTable({
      startY,
      head: [["Task", "Date", "Hours"]],
      body: m.logs.map((l) => [l.task, l.date, `${l.hours} h`]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [100, 116, 139], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    startY = (doc as any).lastAutoTable.finalY + 10;
  });

  doc.save(`${projectName}_TimeReport.pdf`);
}

// ── 甘特圖匯出 PNG ──────────────────────────────────────────────

export async function exportGanttPNG(elementId: string, projectName: string) {
  const element = document.getElementById(elementId);
  if (!element) return;

  try {
    const dataUrl = await toPng(element, {
      backgroundColor: "#161b27",
      pixelRatio: 2,
    });
    const link = document.createElement("a");
    link.download = `${projectName}_Gantt.png`;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.error("Gantt export failed:", error);
  }
}

// ── CSV 匯出任務清單 ─────────────────────────────────────────────

export function exportTaskListCSV(
  projectName: string,
  tasks: {
    title: string;
    group: string;
    assignee: string;
    priority: string;
    startDate: string;
    endDate: string;
    completion: number;
    subtasks: {
      title: string;
      group: string;
      assignee: string;
      startDate: string;
      endDate: string;
      completion: number;
    }[];
  }[]
) {
  const headers = ["類型", "任務名稱", "組別", "指派人", "優先級", "開始日期", "結束日期", "完成度"];
  const rows: string[][] = [];

  tasks.forEach((task) => {
    rows.push(["主工項", task.title, task.group, task.assignee, task.priority, task.startDate || "", task.endDate || "", `${task.completion}%`]);
    task.subtasks.forEach((sub) => {
      rows.push(["子工項", sub.title, sub.group, sub.assignee, "", sub.startDate || "", sub.endDate || "", `${sub.completion}%`]);
    });
  });

  downloadCSV(`${projectName}_TaskList.csv`, headers, rows);
}

// ── CSV 匯出工時報表 ─────────────────────────────────────────────

export function exportTimeReportCSV(
  projectName: string,
  memberHours: {
    name: string;
    memberId: string;
    group: string;
    totalHours: number;
    logs: { task: string; date: string; hours: number }[];
  }[]
) {
  const headers = ["姓名", "員工編號", "組別", "任務", "日期", "工時（小時）"];
  const rows: string[][] = [];

  memberHours.forEach((m) => {
    if (m.logs.length === 0) {
      rows.push([m.name, m.memberId, m.group, "", "", "0"]);
    } else {
      m.logs.forEach((l) => {
        rows.push([m.name, m.memberId, m.group, l.task, l.date, `${l.hours}`]);
      });
    }
  });

  downloadCSV(`${projectName}_TimeReport.csv`, headers, rows);
}
