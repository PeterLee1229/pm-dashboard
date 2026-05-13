import { toPng } from "html-to-image";

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

// ── PDF 匯出（用 HTML 渲染再列印）─────────────────────────────────

function printPDF(title: string, htmlContent: string) {
  const win = window.open("", "_blank");
  if (!win) {
    alert("請允許彈出視窗以匯出 PDF");
    return;
  }
  win.document.open();
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif; color: #1a1a1a; padding: 24px; font-size: 12px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .subtitle { color: #666; font-size: 11px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { background: #6366f1; color: #fff; text-align: left; padding: 8px 10px; font-size: 11px; }
        td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
        tr:nth-child(even) { background: #f8fafc; }
        .subtask { padding-left: 24px; color: #64748b; }
        .section-title { font-size: 14px; font-weight: 700; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #6366f1; }
        .green-header th { background: #10b981; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 600; }
        @media print {
          body { padding: 0; }
          @page { margin: 15mm; }
        }
      </style>
    </head>
    <body>
      ${htmlContent}
      <script>
        window.onload = function() {
          setTimeout(function() { window.print(); window.close(); }, 300);
        };
      </script>
    </body>
    </html>
  `);
  win.document.close();
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
  let rows = "";
  tasks.forEach((task) => {
    rows += `<tr>
      <td><strong>${task.title}</strong></td>
      <td>${task.group}</td>
      <td>${task.assignee}</td>
      <td>${task.priority}</td>
      <td>${task.startDate || "-"}</td>
      <td>${task.endDate || "-"}</td>
      <td style="text-align:center">${task.completion}%</td>
    </tr>`;
    task.subtasks.forEach((sub) => {
      rows += `<tr>
        <td class="subtask">↳ ${sub.title}</td>
        <td>${sub.group}</td>
        <td>${sub.assignee}</td>
        <td></td>
        <td>${sub.startDate || "-"}</td>
        <td>${sub.endDate || "-"}</td>
        <td style="text-align:center">${sub.completion}%</td>
      </tr>`;
    });
  });

  const html = `
    <h1>${projectName} — 任務清單</h1>
    <p class="subtitle">匯出日期：${new Date().toLocaleDateString()}</p>
    <table>
      <thead>
        <tr>
          <th style="width:25%">任務名稱</th>
          <th>組別</th>
          <th>指派人</th>
          <th>優先級</th>
          <th>開始日期</th>
          <th>結束日期</th>
          <th style="text-align:center">完成度</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  printPDF(`${projectName} - 任務清單`, html);
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
  let summaryRows = "";
  memberHours.forEach((m) => {
    summaryRows += `<tr>
      <td>${m.name}</td>
      <td>${m.memberId}</td>
      <td>${m.group}</td>
      <td style="text-align:right"><strong>${m.totalHours} h</strong></td>
    </tr>`;
  });

  let detailSections = "";
  memberHours.forEach((m) => {
    if (m.logs.length === 0) return;
    let logRows = "";
    m.logs.forEach((l) => {
      logRows += `<tr>
        <td>${l.task}</td>
        <td>${l.date}</td>
        <td style="text-align:right">${l.hours} h</td>
      </tr>`;
    });

    detailSections += `
      <p class="section-title">${m.name}（${m.memberId}）— ${m.group}</p>
      <table>
        <thead class="green-header">
          <tr><th style="width:50%">任務</th><th>日期</th><th style="text-align:right">工時</th></tr>
        </thead>
        <tbody>${logRows}</tbody>
      </table>
    `;
  });

  const html = `
    <h1>${projectName} — 工時報表</h1>
    <p class="subtitle">匯出日期：${new Date().toLocaleDateString()}</p>

    <p class="section-title">彙總</p>
    <table>
      <thead>
        <tr><th>姓名</th><th>員工編號</th><th>組別</th><th style="text-align:right">總工時</th></tr>
      </thead>
      <tbody>${summaryRows}</tbody>
    </table>

    ${detailSections}
  `;

  printPDF(`${projectName} - 工時報表`, html);
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

// ── PDF 匯出（週報）─────────────────────────────────────────────

export function exportWeeklyReportPDF(
  projectName: string,
  weekLabel: string,
  data: {
    completedTasks: { title: string; group: string }[];
    inProgressTasks: { title: string; group: string; completion: number }[];
    weekHours: { name: string; hours: number }[];
    totalHours: number;
    activeRisks: { title: string; status: string }[];
    nextWeekTasks: { title: string; group: string; assignee: string }[];
    notes: string;
  }
) {
  let completedRows = "";
  if (data.completedTasks.length === 0) {
    completedRows = `<tr><td colspan="2" style="color:#999">無</td></tr>`;
  } else {
    data.completedTasks.forEach((t) => {
      completedRows += `<tr><td>${t.group}</td><td>${t.title}</td></tr>`;
    });
  }

  let progressRows = "";
  if (data.inProgressTasks.length === 0) {
    progressRows = `<tr><td colspan="3" style="color:#999">無</td></tr>`;
  } else {
    data.inProgressTasks.forEach((t) => {
      progressRows += `<tr><td>${t.group}</td><td>${t.title}</td><td style="text-align:center">${t.completion}%</td></tr>`;
    });
  }

  let hoursRows = "";
  if (data.weekHours.length === 0) {
    hoursRows = `<tr><td colspan="2" style="color:#999">本週無工時紀錄</td></tr>`;
  } else {
    data.weekHours.forEach((h) => {
      hoursRows += `<tr><td>${h.name}</td><td style="text-align:right">${h.hours} h</td></tr>`;
    });
    hoursRows += `<tr style="border-top:2px solid #6366f1"><td><strong>合計</strong></td><td style="text-align:right"><strong>${data.totalHours} h</strong></td></tr>`;
  }

  let riskRows = "";
  if (data.activeRisks.length === 0) {
    riskRows = `<tr><td colspan="2" style="color:#999">無活躍風險</td></tr>`;
  } else {
    data.activeRisks.forEach((r) => {
      const color = r.status === "已發生" ? "#ef4444" : "#f59e0b";
      riskRows += `<tr><td><span class="badge" style="background:${color}20;color:${color}">${r.status}</span></td><td>${r.title}</td></tr>`;
    });
  }

  let nextRows = "";
  if (data.nextWeekTasks.length === 0) {
    nextRows = `<tr><td colspan="3" style="color:#999">無</td></tr>`;
  } else {
    data.nextWeekTasks.forEach((t) => {
      nextRows += `<tr><td>${t.group}</td><td>${t.title}</td><td>${t.assignee}</td></tr>`;
    });
  }

  const html = `
    <h1>${projectName} — 週報</h1>
    <p class="subtitle">${weekLabel}　｜　匯出日期：${new Date().toLocaleDateString()}</p>

    <p class="section-title" style="border-color:#10b981">✅ 本週完成</p>
    <table>
      <thead><tr><th style="background:#10b981">組別</th><th style="background:#10b981">任務</th></tr></thead>
      <tbody>${completedRows}</tbody>
    </table>

    <p class="section-title" style="border-color:#f59e0b">🔄 進行中</p>
    <table>
      <thead><tr><th style="background:#f59e0b">組別</th><th style="background:#f59e0b">任務</th><th style="background:#f59e0b;text-align:center">完成度</th></tr></thead>
      <tbody>${progressRows}</tbody>
    </table>

    <p class="section-title" style="border-color:#6366f1">⏱ 工時統計</p>
    <table>
      <thead><tr><th style="background:#6366f1">成員</th><th style="background:#6366f1;text-align:right">工時</th></tr></thead>
      <tbody>${hoursRows}</tbody>
    </table>

    <p class="section-title" style="border-color:#ef4444">⚠️ 風險狀態</p>
    <table>
      <thead><tr><th style="background:#ef4444">狀態</th><th style="background:#ef4444">風險</th></tr></thead>
      <tbody>${riskRows}</tbody>
    </table>

    <p class="section-title" style="border-color:#8b5cf6">📅 下週預計工作</p>
    <table>
      <thead><tr><th style="background:#8b5cf6">組別</th><th style="background:#8b5cf6">任務</th><th style="background:#8b5cf6">負責人</th></tr></thead>
      <tbody>${nextRows}</tbody>
    </table>

    ${data.notes ? `
      <p class="section-title" style="border-color:#64748b">📝 PM 備註</p>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:12px;line-height:1.8;white-space:pre-wrap">${data.notes}</div>
    ` : ""}
  `;

  printPDF(`${projectName} - 週報`, html);
}

// ── 甘特圖匯出 PNG ──────────────────────────────────────────────

export async function exportGanttPNG(elementId: string, projectName: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    alert("請先切換到甘特圖視圖再匯出");
    return;
  }

  const scrollContainer = element.querySelector('[style*="overflow-x"]') as HTMLElement ||
    element.querySelector('[style*="overflow"]') as HTMLElement;

  let originalOverflow = "";
  let originalWidth = "";

  if (scrollContainer) {
    originalOverflow = scrollContainer.style.overflow;
    originalWidth = scrollContainer.style.width;
    scrollContainer.style.overflow = "visible";
    scrollContainer.style.width = "auto";
  }

  const originalElementOverflow = element.style.overflow;
  element.style.overflow = "visible";

  try {
    await new Promise((r) => setTimeout(r, 100));

    const dataUrl = await toPng(element, {
      backgroundColor: "#161b27",
      pixelRatio: 2,
      cacheBust: true,
      width: element.scrollWidth,
      height: element.scrollHeight,
    });

    const link = document.createElement("a");
    link.download = `${projectName}_Gantt.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error("Gantt export failed:", error);
    alert("甘特圖匯出失敗，請確認甘特圖有資料");
  } finally {
    if (scrollContainer) {
      scrollContainer.style.overflow = originalOverflow;
      scrollContainer.style.width = originalWidth;
    }
    element.style.overflow = originalElementOverflow;
  }
}
