// 各 REST endpoint 的測試案例（權限矩陣測試與封存測試共用）
import { prisma } from "../src/db";
import type { Fixture } from "./fixtures";

export type Case = {
  name: string;
  method: "get" | "post" | "put" | "delete";
  /** 每次請求前準備目標（刪除類需要新資料），回傳路徑與 body */
  prepare: (f: Fixture) => Promise<{ path: string; body?: unknown }> | { path: string; body?: unknown };
  /** 允許的專案角色；admin 一律允許，outsider 一律 404 */
  allowed: string[];
};

export const ALL_MEMBERS = ["owner", "pm", "group_leader", "member", "viewer"];
export const TESTED_ROLES = ["admin", "owner", "pm", "group_leader", "member", "viewer", "outsider"];

const read = (name: string, path: (f: Fixture) => string): Case =>
  ({ name, method: "get", prepare: (f) => ({ path: path(f) }), allowed: ALL_MEMBERS });

export const CASES: Case[] = [
  // ── 讀取 ──
  read("GET 任務列表", (f) => `/api/projects/${f.p1.id}/tasks`),
  read("GET 單一任務", (f) => `/api/tasks/${f.tasks.ofMember.id}`),
  read("GET 會議", (f) => `/api/projects/${f.p1.id}/meetings`),
  read("GET 單一會議紀錄", (f) => `/api/meeting-records/${f.record.id}`),
  read("GET 風險", (f) => `/api/projects/${f.p1.id}/risks`),
  read("GET 週報備註", (f) => `/api/projects/${f.p1.id}/weekly-reports`),
  read("GET 週報資料", (f) => `/api/projects/${f.p1.id}/weekly-report-data?weekStart=2026-09-28`),
  read("GET 專案摘要", (f) => `/api/projects/${f.p1.id}/summary`),
  read("GET OKR", (f) => `/api/projects/${f.p1.id}/okrs`),
  read("GET 搜尋", (f) => `/api/projects/${f.p1.id}/search?q=${encodeURIComponent("任務")}`),
  read("GET 評論", (f) => `/api/tasks/${f.tasks.ofMember.id}/comments`),
  read("GET 附件", (f) => `/api/tasks/${f.tasks.ofMember.id}/attachments`),
  read("GET 活動紀錄", (f) => `/api/projects/${f.p1.id}/activities`),
  read("GET 專案成員", (f) => `/api/projects/${f.p1.id}/members`),

  // ── 任務 ──
  { name: "POST 任務", method: "post", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/tasks`, body: { title: "新任務" } }) },
  { name: "PUT 自己負責的任務", method: "put", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMember.id}`, body: { description: "更新" } }) },
  { name: "PUT 別人負責的任務", method: "put", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMemberB.id}`, body: { description: "更新" } }) },
  // 裁決 #5：member 不能改派（即使是自己負責的任務）
  { name: "PUT 改派任務負責人（A組成員→A組組長）", method: "put", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => {
      await prisma.task.update({ where: { id: f.tasks.ofMember.id }, data: { assignee: f.users.member.memberId } });
      return { path: `/api/tasks/${f.tasks.ofMember.id}`, body: { assignee: f.users.leader.memberId } };
    } },
  // 裁決 #4：組長只能把未分組／自己組的任務改到自己的組
  { name: "PUT 任務組別（未分組→A組）", method: "put", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/tasks/${(await prisma.task.create({ data: { title: "未分組", projectId: f.p1.id } })).id}`, body: { groupId: f.groups.A.id } }) },
  { name: "PUT 任務組別（B組→A組）", method: "put", allowed: ["owner", "pm"],
    prepare: async (f) => ({ path: `/api/tasks/${(await prisma.task.create({ data: { title: "B組", groupId: f.groups.B.id, projectId: f.p1.id } })).id}`, body: { groupId: f.groups.A.id } }) },
  { name: "DELETE 任務", method: "delete", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/tasks/${(await prisma.task.create({ data: { title: "待刪", projectId: f.p1.id } })).id}` }) },

  // ── 會議 ──
  { name: "POST 會議系列", method: "post", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/meetings`, body: { name: "新會議" } }) },
  { name: "DELETE 會議系列", method: "delete", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/meetings/${(await prisma.meetingSeries.create({ data: { name: "待刪", projectId: f.p1.id } })).id}` }) },
  { name: "POST 會議紀錄", method: "post", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/meetings/${f.series.id}/records`, body: { date: "2026-09-10", summary: "新紀錄" } }) },
  { name: "PUT 會議紀錄", method: "put", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/meeting-records/${f.record.id}`, body: { summary: "修改" } }) },
  { name: "DELETE 會議紀錄", method: "delete", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/meeting-records/${(await prisma.meetingRecord.create({ data: { date: "2026-09-02", seriesId: f.series.id } })).id}` }) },

  // ── 風險 ──
  { name: "POST 風險", method: "post", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/risks`, body: { title: "新風險" } }) },
  { name: "PUT 風險", method: "put", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/risks/${f.risk.id}`, body: { countermeasure: "對策" } }) },
  { name: "DELETE 風險", method: "delete", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/risks/${(await prisma.risk.create({ data: { title: "待刪", projectId: f.p1.id } })).id}` }) },

  // 裁決 #6：組長只能指定自己組的成員為風險負責人，且不能更換別組成員負責的風險
  { name: "POST 風險（負責人為A組成員）", method: "post", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/risks`, body: { title: "x", ownerId: f.users.member.memberId } }) },
  { name: "POST 風險（負責人為B組成員）", method: "post", allowed: ["owner", "pm", "member"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/risks`, body: { title: "x", ownerId: f.users.memberB.memberId } }) },
  { name: "PUT 風險負責人（未指定→A組成員）", method: "put", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/risks/${(await prisma.risk.create({ data: { title: "x", projectId: f.p1.id } })).id}`, body: { ownerId: f.users.member.memberId } }) },
  { name: "PUT 風險負責人（B組成員→A組成員）", method: "put", allowed: ["owner", "pm"],
    prepare: async (f) => ({ path: `/api/risks/${(await prisma.risk.create({ data: { title: "x", ownerId: f.users.memberB.memberId, projectId: f.p1.id } })).id}`, body: { ownerId: f.users.member.memberId } }) },
  { name: "PUT 別組成員負責的風險（負責人不變）", method: "put", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/risks/${(await prisma.risk.create({ data: { title: "x", ownerId: f.users.memberB.memberId, projectId: f.p1.id } })).id}`, body: { ownerId: f.users.memberB.memberId, countermeasure: "對策" } }) },

  // ── 週報 ──
  { name: "PUT 週報備註", method: "put", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/weekly-reports`, body: { weekStart: "2026-09-28", weekEnd: "2026-10-04", notes: "備註" } }) },

  // ── OKR ──
  { name: "POST OKR", method: "post", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/okrs`, body: { title: "新目標" } }) },
  { name: "PUT OKR", method: "put", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/okrs/${f.objective.id}`, body: { description: "說明" } }) },
  { name: "DELETE OKR", method: "delete", allowed: ["owner", "pm"],
    prepare: async (f) => ({ path: `/api/okrs/${(await prisma.objective.create({ data: { title: "待刪", projectId: f.p1.id } })).id}` }) },
  { name: "POST KR", method: "post", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/okrs/${f.objective.id}/key-results`, body: { title: "新 KR", targetValue: 10 } }) },
  { name: "PUT KR", method: "put", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/key-results/${f.keyResult.id}`, body: { currentValue: 5 } }) },
  { name: "DELETE KR", method: "delete", allowed: ["owner", "pm"],
    prepare: async (f) => ({ path: `/api/key-results/${(await prisma.keyResult.create({ data: { title: "待刪", objectiveId: f.objective.id } })).id}` }) },

  // ── 評論與附件 ──
  { name: "POST 評論", method: "post", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMember.id}/comments`, body: { content: "新評論" } }) },
  { name: "DELETE 別人的評論（僅本人與 admin）", method: "delete", allowed: [],
    prepare: async (f) => ({ path: `/api/comments/${(await prisma.comment.create({ data: { content: "x", taskId: f.tasks.ofMember.id, userId: f.users.memberB.id } })).id}` }) },
  { name: "POST 附件到自己的任務", method: "post", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMember.id}/attachments`, body: { name: "文件", url: "https://example.com/a" } }) },
  { name: "POST 附件到別人的任務", method: "post", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMemberB.id}/attachments`, body: { name: "文件", url: "https://example.com/b" } }) },
  { name: "DELETE 別人上傳的附件", method: "delete", allowed: ["owner", "pm"],
    prepare: async (f) => ({
      path: `/api/attachments/${(await prisma.attachment.create({ data: { name: "x", url: "https://example.com/x", taskId: f.tasks.ofMember.id, uploaderId: f.users.memberB.id } })).id}`,
    }) },
];
