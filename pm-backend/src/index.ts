import "dotenv/config";
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";
import cron from "node-cron";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "./db";
import { ConflictError, HttpError, parseInput } from "./errors";
import { checkDueTasks } from "./scheduler";
import { PreviewStore } from "./services/import/diff";
import {
  ImportPlan, ImportFormatError, parseTaskCsv, collectIds, loadImportContext,
  buildImportPlan, toPreviewResponse, commitImportPlan,
} from "./services/import/taskImport";
import { Ctx, PROJECT_ROLES, assertCan, assertCanRead, assertProjectWritable, can, isAdmin, loadLeaderGroupId } from "./services/permissions";
import { createNotification, listActivities, logActivity } from "./services/activity";
import * as projects from "./services/projects";
import * as tasks from "./services/tasks";
import * as meetings from "./services/meetings";
import * as risks from "./services/risks";
import * as okrs from "./services/okrs";
import * as reports from "./services/reports";
import { searchProject } from "./services/search";
import { mcpCors, mountMcp } from "./mcp/routes";

const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set. Set the JWT_SECRET environment variable.");
  process.exit(1);
}

export const app = express();
// Railway 前面有一層 proxy；rate limit 需要以 X-Forwarded-For 取得真實 IP
app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));

app.use(["/mcp", "/.well-known"], mcpCors);
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://pm-dashboard-delta-eight.vercel.app",
    /\.vercel\.app$/,
    /\.railway\.app$/,
  ],
  credentials: true,
}));

app.get("/", (_req, res) => {
  res.json({ message: "PM Dashboard API 運作中" });
});

// ── Auth middleware ────────────────────────────────────────────────────

async function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "未登入" });
  let payload: any;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "通行證無效" });
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: payload.userId }, select: { role: true, isActive: true }
  });
  if (!dbUser) return res.status(401).json({ error: "帳號不存在，請重新登入" });
  if (dbUser.isActive === false) return res.status(403).json({ error: "帳號已被停用" });
  req.user = payload;
  // 系統角色以 DB 為準，JWT 內的 role 可能已過時
  const ctx: Ctx = { userId: payload.userId, systemRole: dbUser.role };
  req.ctx = ctx;
  next();
}

async function requireAdmin(req: any, res: any, next: any) {
  if (!isAdmin(req.ctx)) return res.status(403).json({ error: "需要管理員權限" });
  next();
}

const projectRoleSchema = z.enum(PROJECT_ROLES);
const systemRoleSchema = z.enum(["admin", "user"]);

// ── 認證 API ──────────────────────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const user = await prisma.user.create({
      data: {
        email: req.body.email,
        password: hashedPassword,
        name: req.body.name,
        memberId: req.body.memberId,
        // 系統角色一律由管理員指派，註冊時不接受指定
        role: "user",
        groupId: req.body.groupId || null,
      },
      include: { group: { select: { id: true, name: true, color: true } } }
    });
    res.status(201).json({
      id: user.id, name: user.name, memberId: user.memberId,
      group: (user as any).group
    });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: "Email 或員工編號已被使用" });
    }
    res.status(500).json({ error: "註冊失敗" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    console.log("登入嘗試:", req.body.email);

    const user = await prisma.user.findUnique({
      where: { email: req.body.email },
      include: { group: true }
    });

    console.log("查到使用者:", user ? user.email : "找不到");

    if (!user) return res.status(401).json({ error: "帳號不存在" });

    const valid = await bcrypt.compare(req.body.password, user.password);
    console.log("密碼驗證:", valid);

    if (!valid) return res.status(401).json({ error: "密碼錯誤" });
    if (user.isActive === false) return res.status(403).json({ error: "此帳號已被停用，請聯繫管理員" });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        memberId: user.memberId,
        role: user.role,
        group: user.group ? { id: user.group.id, name: user.group.name, color: user.group.color } : null
      }
    });
  } catch (err) {
    console.error("登入錯誤完整訊息:", err);
    res.status(500).json({ error: "登入失敗" });
  }
});

// ── 使用者 API ────────────────────────────────────────────────────────

// 非 Admin 只回傳指派與邀請成員所需的欄位
app.get("/api/users", authMiddleware, async (req: any, res) => {
  const admin = isAdmin(req.ctx);
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, memberId: true,
      group: { select: { id: true, name: true, color: true } },
      ...(admin ? { email: true, role: true } : {}),
    }
  });
  res.json(users);
});

async function listGroupsWithUsers(ctx: Ctx) {
  return prisma.group.findMany({
    orderBy: { name: "asc" },
    include: {
      users: { select: { id: true, name: true, memberId: true, ...(isAdmin(ctx) ? { email: true } : {}) } }
    }
  });
}

app.get("/api/groups", authMiddleware, async (req: any, res) => {
  res.json(await listGroupsWithUsers(req.ctx));
});

// 註冊頁（尚未登入）選擇組別用，只回傳組別名稱。
// 商業化改成邀請制註冊後，移除這支 endpoint（連同前端 getGroupOptions）
const groupOptionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "請求過於頻繁，請稍後再試" },
});
app.get("/api/groups/options", groupOptionsLimiter, async (_req, res) => {
  const groups = await prisma.group.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });
  res.json(groups);
});

// ── 專案 API ──────────────────────────────────────────────────────────

app.get("/api/projects", authMiddleware, async (req: any, res) => {
  res.json(await projects.listProjects(req.ctx));
});

app.post("/api/projects", authMiddleware, async (req: any, res) => {
  res.status(201).json(await projects.createProject(req.ctx, req.body));
});

app.put("/api/projects/:id", authMiddleware, async (req: any, res) => {
  res.json(await projects.updateProject(req.ctx, req.params.id, req.body));
});

app.post("/api/projects/:id/archive", authMiddleware, async (req: any, res) => {
  res.json(await projects.archiveProject(req.ctx, req.params.id));
});

app.post("/api/projects/:id/unarchive", authMiddleware, async (req: any, res) => {
  res.json(await projects.unarchiveProject(req.ctx, req.params.id));
});

app.delete("/api/projects/:id", authMiddleware, async (req: any, res) => {
  await projects.deleteProject(req.ctx, req.params.id);
  res.json({ success: true });
});

app.get("/api/projects/:projectId/summary", authMiddleware, async (req: any, res) => {
  res.json(await reports.getProjectSummary(req.ctx, req.params.projectId));
});

// ── 專案成員 API ──────────────────────────────────────────────────────

app.get("/api/projects/:projectId/members", authMiddleware, async (req: any, res) => {
  const { projectId } = req.params;
  const role = await assertCanRead(req.ctx, projectId);
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: {
      user: {
        select: {
          id: true, name: true, memberId: true, email: can(role, "member.view_email"),
          group: { select: { id: true, name: true, color: true } }
        }
      }
    },
    orderBy: { id: "asc" }
  });
  res.json(members);
});

app.post("/api/projects/:projectId/members", authMiddleware, async (req: any, res) => {
  const { projectId } = req.params;
  const { userId, role: targetRole } = parseInput(z.object({
    userId: z.string().min(1),
    role: projectRoleSchema.default("member"),
  }), req.body);

  const role = await assertCanRead(req.ctx, projectId);
  await assertProjectWritable(projectId);
  if (role !== "admin") {
    if (role === "pm" && ["owner", "pm"].includes(targetRole)) {
      return res.status(403).json({ error: "PM 不能指定 Owner 或 PM 角色" });
    }
    if (role === "group_leader" && ["owner", "pm", "group_leader"].includes(targetRole)) {
      return res.status(403).json({ error: "組長只能邀請 Member 或 Viewer" });
    }
    if (!["owner", "pm", "group_leader"].includes(role)) {
      return res.status(403).json({ error: "權限不足" });
    }
  }

  try {
    const member = await prisma.projectMember.create({
      data: { projectId, userId, role: targetRole },
      include: { user: { select: { id: true, name: true, memberId: true, email: true } } }
    });

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    await createNotification(
      userId, "project_invited", "專案邀請",
      `你被邀請加入專案「${project?.name || ""}」，角色為 ${targetRole}`,
      projectId
    );

    const invitedUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await logActivity(req.ctx.userId, "invite", "member", invitedUser?.name || userId, projectId, userId);
    res.status(201).json(member);
  } catch {
    res.status(400).json({ error: "新增成員失敗（可能已是成員）" });
  }
});

app.delete("/api/projects/:projectId/members/:userId", authMiddleware, async (req: any, res) => {
  const { projectId, userId } = req.params;

  const role = await assertCanRead(req.ctx, projectId);
  await assertProjectWritable(projectId);
  if (role !== "admin") {
    const target = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } }
    });
    if (!target) return res.status(404).json({ error: "找不到成員" });

    if (target.role === "owner") return res.status(403).json({ error: "不能移除專案擁有者" });
    if (role === "pm" && target.role === "pm") return res.status(403).json({ error: "PM 不能移除其他 PM" });
    if (role === "group_leader" && !["member", "viewer"].includes(target.role)) {
      return res.status(403).json({ error: "組長只能移除 Member 或 Viewer" });
    }
    if (["member", "viewer"].includes(role)) return res.status(403).json({ error: "權限不足" });
  }

  const removedUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await logActivity(req.ctx.userId, "remove", "member", removedUser?.name || userId, projectId, userId);
  await prisma.projectMember.deleteMany({ where: { projectId, userId } });
  res.json({ success: true });
});

app.put("/api/projects/:projectId/members/:userId", authMiddleware, async (req: any, res) => {
  const { projectId, userId } = req.params;
  const { role: newRole } = parseInput(z.object({ role: projectRoleSchema }), req.body);

  const role = await assertCanRead(req.ctx, projectId);
  await assertProjectWritable(projectId);
  if (role !== "admin" && role !== "owner") return res.status(403).json({ error: "只有專案擁有者可以變更角色" });

  await prisma.projectMember.updateMany({
    where: { projectId, userId },
    data: { role: newRole }
  });
  res.json({ success: true });
});

app.post("/api/projects/:projectId/transfer-owner", authMiddleware, async (req: any, res) => {
  const { projectId } = req.params;
  const { newOwnerId } = parseInput(z.object({ newOwnerId: z.string().min(1) }), req.body);

  const role = await assertCanRead(req.ctx, projectId);
  await assertProjectWritable(projectId);
  if (role !== "admin" && role !== "owner") return res.status(403).json({ error: "只有專案擁有者可以轉移權限" });

  const newOwnerMembership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: newOwnerId } }
  });
  if (!newOwnerMembership) return res.status(400).json({ error: "該使用者不是專案成員" });

  await prisma.projectMember.updateMany({ where: { projectId, role: "owner" }, data: { role: "pm" } });
  await prisma.projectMember.updateMany({ where: { projectId, userId: newOwnerId }, data: { role: "owner" } });
  await prisma.project.update({ where: { id: projectId }, data: { ownerId: newOwnerId } });

  res.json({ success: true });
});

// ── 任務 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/tasks", authMiddleware, async (req: any, res) => {
  res.json(await tasks.listTasks(req.ctx, req.params.projectId));
});

app.post("/api/projects/:projectId/tasks", authMiddleware, async (req: any, res) => {
  res.status(201).json(await tasks.createTask(req.ctx, req.params.projectId, req.body));
});

app.get("/api/tasks/:id", authMiddleware, async (req: any, res) => {
  res.json(await tasks.getTask(req.ctx, req.params.id));
});

app.put("/api/tasks/:id", authMiddleware, async (req: any, res) => {
  res.json(await tasks.updateTask(req.ctx, req.params.id, req.body));
});

app.delete("/api/tasks/:id", authMiddleware, async (req: any, res) => {
  await tasks.deleteTask(req.ctx, req.params.id);
  res.json({ success: true });
});

// ── 組別 API ──────────────────────────────────────────────────────────

// 回傳所有系統組別（含組員），projectId 保留在 URL 路徑以維持前端相容
app.get("/api/projects/:projectId/groups", authMiddleware, async (req: any, res) => {
  res.json(await listGroupsWithUsers(req.ctx));
});

// 建立系統組別（Admin 或 owner/pm 可操作）
app.post("/api/projects/:projectId/groups", authMiddleware, async (req: any, res) => {
  const role = await assertCanRead(req.ctx, req.params.projectId);
  if (!["admin", "owner", "pm"].includes(role)) return res.status(403).json({ error: "權限不足" });
  const data = parseInput(z.object({
    name: z.string().trim().min(1).max(100),
    color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  }), req.body);
  try {
    const group = await prisma.group.create({
      data: { name: data.name, color: data.color || "#6366f1" }
    });
    res.status(201).json(group);
  } catch (err: any) {
    if (err.code === "P2002") return res.status(400).json({ error: "組別名稱已存在" });
    res.status(500).json({ error: "建立失敗" });
  }
});

app.put("/api/groups/:id", authMiddleware, requireAdmin, async (req: any, res) => {
  try {
    const updated = await prisma.group.update({
      where: { id: req.params.id },
      data: { name: req.body.name, color: req.body.color }
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "找不到組別" });
  }
});

app.delete("/api/groups/:id", authMiddleware, requireAdmin, async (req: any, res) => {
  try {
    await prisma.group.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到組別" });
  }
});

// ── 會議 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/meetings", authMiddleware, async (req: any, res) => {
  res.json(await meetings.listMeetings(req.ctx, req.params.projectId));
});

app.post("/api/projects/:projectId/meetings", authMiddleware, async (req: any, res) => {
  res.status(201).json(await meetings.createSeries(req.ctx, req.params.projectId, req.body));
});

app.delete("/api/meetings/:id", authMiddleware, async (req: any, res) => {
  await meetings.deleteSeries(req.ctx, req.params.id);
  res.json({ success: true });
});

app.post("/api/meetings/:seriesId/records", authMiddleware, async (req: any, res) => {
  res.status(201).json(await meetings.createRecord(req.ctx, req.params.seriesId, req.body));
});

app.get("/api/meeting-records/:id", authMiddleware, async (req: any, res) => {
  res.json(await meetings.getMeetingRecord(req.ctx, req.params.id));
});

app.put("/api/meeting-records/:id", authMiddleware, async (req: any, res) => {
  res.json(await meetings.updateRecord(req.ctx, req.params.id, req.body));
});

app.delete("/api/meeting-records/:id", authMiddleware, async (req: any, res) => {
  await meetings.deleteRecord(req.ctx, req.params.id);
  res.json({ success: true });
});

// ── 風險 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/risks", authMiddleware, async (req: any, res) => {
  res.json(await risks.listRisks(req.ctx, req.params.projectId));
});

app.post("/api/projects/:projectId/risks", authMiddleware, async (req: any, res) => {
  res.status(201).json(await risks.createRisk(req.ctx, req.params.projectId, req.body));
});

app.put("/api/risks/:id", authMiddleware, async (req: any, res) => {
  res.json(await risks.updateRisk(req.ctx, req.params.id, req.body));
});

app.delete("/api/risks/:id", authMiddleware, async (req: any, res) => {
  await risks.deleteRisk(req.ctx, req.params.id);
  res.json({ success: true });
});

// ── 週報 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/weekly-reports", authMiddleware, async (req: any, res) => {
  res.json(await reports.listWeeklyReports(req.ctx, req.params.projectId));
});

app.put("/api/projects/:projectId/weekly-reports", authMiddleware, async (req: any, res) => {
  res.json(await reports.saveWeeklyNotes(req.ctx, req.params.projectId, req.body));
});

app.get("/api/projects/:projectId/weekly-report-data", authMiddleware, async (req: any, res) => {
  res.json(await reports.getWeeklyReportData(req.ctx, req.params.projectId, req.query.weekStart));
});

// ── Admin API ─────────────────────────────────────────────────────────

app.get("/api/admin/users", authMiddleware, requireAdmin, async (_req: any, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, memberId: true, email: true, role: true, isActive: true, createdAt: true,
      _count: { select: { projectMemberships: true } }
    }
  });
  res.json(users);
});

app.put("/api/admin/users/:id/toggle-active", authMiddleware, requireAdmin, async (req: any, res) => {
  if (req.params.id === req.ctx.userId) {
    return res.status(400).json({ error: "不能停用自己的帳號" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "使用者不存在" });
  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: !user.isActive },
    select: { id: true, isActive: true },
  });
  res.json(updated);
});

app.put("/api/admin/users/:id", authMiddleware, requireAdmin, async (req: any, res) => {
  const { role } = parseInput(z.object({ role: systemRoleSchema }), req.body);
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role },
    select: { id: true, name: true, memberId: true, email: true, role: true }
  });
  res.json(user);
});

// ── Admin 組別管理 ────────────────────────────────────────────────────

app.post("/api/admin/groups", authMiddleware, requireAdmin, async (req: any, res) => {
  try {
    const group = await prisma.group.create({
      data: { name: req.body.name, color: req.body.color || "#6366f1" }
    });
    res.status(201).json(group);
  } catch (err: any) {
    if (err.code === "P2002") return res.status(400).json({ error: "組別名稱已存在" });
    res.status(500).json({ error: "建立失敗" });
  }
});

app.put("/api/admin/groups/:id", authMiddleware, requireAdmin, async (req: any, res) => {
  try {
    const group = await prisma.group.update({
      where: { id: req.params.id },
      data: { name: req.body.name, color: req.body.color }
    });
    res.json(group);
  } catch (err: any) {
    if (err.code === "P2002") return res.status(400).json({ error: "組別名稱已存在" });
    res.status(500).json({ error: "更新失敗" });
  }
});

app.delete("/api/admin/groups/:id", authMiddleware, requireAdmin, async (req: any, res) => {
  await prisma.group.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── 附件 API ──────────────────────────────────────────────────────────

app.get("/api/tasks/:taskId/attachments", authMiddleware, async (req: any, res) => {
  res.json(await tasks.listAttachments(req.ctx, req.params.taskId));
});

app.post("/api/tasks/:taskId/attachments", authMiddleware, async (req: any, res) => {
  res.status(201).json(await tasks.createAttachment(req.ctx, req.params.taskId, req.body));
});

app.delete("/api/attachments/:id", authMiddleware, async (req: any, res) => {
  await tasks.deleteAttachment(req.ctx, req.params.id);
  res.json({ success: true });
});

// ── 評論 API ──────────────────────────────────────────────────────────

app.get("/api/tasks/:taskId/comments", authMiddleware, async (req: any, res) => {
  res.json(await tasks.listComments(req.ctx, req.params.taskId));
});

app.post("/api/tasks/:taskId/comments", authMiddleware, async (req: any, res) => {
  res.status(201).json(await tasks.createComment(req.ctx, req.params.taskId, req.body));
});

app.delete("/api/comments/:id", authMiddleware, async (req: any, res) => {
  await tasks.deleteComment(req.ctx, req.params.id);
  res.json({ success: true });
});

// ── 通知 API ──────────────────────────────────────────────────────────

app.get("/api/notifications", authMiddleware, async (req: any, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(notifications);
});

app.get("/api/notifications/unread-count", authMiddleware, async (req: any, res) => {
  const count = await prisma.notification.count({
    where: { userId: req.ctx.userId, isRead: false }
  });
  res.json({ count });
});

app.put("/api/notifications/read-all", authMiddleware, async (req: any, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.ctx.userId, isRead: false },
    data: { isRead: true }
  });
  res.json({ success: true });
});

app.put("/api/notifications/:id/read", authMiddleware, async (req: any, res) => {
  // 只能標記自己的通知；別人的通知與不存在的通知回應相同
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.ctx.userId },
    data: { isRead: true }
  });
  if (result.count === 0) return res.status(404).json({ error: "找不到通知" });
  res.json({ success: true });
});

// ── 活動紀錄 API ──────────────────────────────────────────────────────

app.get("/api/projects/:projectId/activities", authMiddleware, async (req: any, res) => {
  res.json(await listActivities(req.ctx, req.params.projectId));
});

// ── 搜尋 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/search", authMiddleware, async (req: any, res) => {
  res.json(await searchProject(req.ctx, req.params.projectId, String(req.query.q ?? "")));
});

// ── OKR API ───────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/okrs", authMiddleware, async (req: any, res) => {
  res.json(await okrs.listOkrs(req.ctx, req.params.projectId));
});

app.post("/api/projects/:projectId/okrs", authMiddleware, async (req: any, res) => {
  res.status(201).json(await okrs.createObjective(req.ctx, req.params.projectId, req.body));
});

app.put("/api/okrs/:id", authMiddleware, async (req: any, res) => {
  res.json(await okrs.updateObjective(req.ctx, req.params.id, req.body));
});

app.delete("/api/okrs/:id", authMiddleware, async (req: any, res) => {
  await okrs.deleteObjective(req.ctx, req.params.id);
  res.json({ success: true });
});

app.post("/api/okrs/:objectiveId/key-results", authMiddleware, async (req: any, res) => {
  res.status(201).json(await okrs.createKeyResult(req.ctx, req.params.objectiveId, req.body));
});

app.put("/api/key-results/:id", authMiddleware, async (req: any, res) => {
  res.json(await okrs.updateKeyResult(req.ctx, req.params.id, req.body));
});

app.delete("/api/key-results/:id", authMiddleware, async (req: any, res) => {
  await okrs.deleteKeyResult(req.ctx, req.params.id);
  res.json({ success: true });
});

// ── 匯入 API ──────────────────────────────────────────────────────────
// 兩段式：preview 只比對不寫入，commit 依使用者決定寫入（單一 transaction）

const importPreviews = new PreviewStore<ImportPlan>(30 * 60 * 1000);

app.post("/api/projects/:projectId/tasks/import/preview", authMiddleware, async (req: any, res) => {
  const { projectId } = req.params;
  const role = await assertCan(req.ctx, projectId, "task.import");
  try {
    const csvText = req.body.csv;
    if (!csvText) return res.status(400).json({ error: "缺少 CSV 資料" });

    const parsed = parseTaskCsv(csvText);
    const ctx = await loadImportContext(prisma, projectId, collectIds(parsed));
    const plan = buildImportPlan(parsed, ctx, { projectId, userId: req.ctx.userId }, {
      // 與 PUT /api/tasks/:id 一致：只有 PM 以上可以將任務標記為已完成
      canMarkDone: can(role, "task.move_done"),
      // 與 PUT /api/tasks/:id 一致：組長人力調整規則
      leader: role === "group_leader" ? { groupId: await loadLeaderGroupId(req.ctx) } : undefined,
    });
    const token = importPreviews.put(plan);
    res.json(toPreviewResponse(plan, token));
  } catch (err: any) {
    if (err instanceof ImportFormatError) return res.status(400).json({ error: err.message });
    console.error("匯入預覽錯誤:", err);
    res.status(500).json({ error: "匯入預覽失敗" });
  }
});

app.post("/api/projects/:projectId/tasks/import/commit", authMiddleware, async (req: any, res) => {
  const { projectId } = req.params;
  await assertCan(req.ctx, projectId, "task.import");
  const { previewToken, decisions } = req.body;
  const plan = previewToken ? importPreviews.get(previewToken) : null;
  if (!plan || plan.projectId !== projectId || plan.userId !== req.ctx.userId) {
    return res.status(410).json({ error: "預覽已過期或無效，請重新上傳檔案" });
  }
  try {
    const result = await commitImportPlan(prisma, plan, decisions || {}, req.ctx.userId);
    importPreviews.delete(previewToken);
    res.json(result);
  } catch (err: any) {
    console.error("匯入寫入錯誤:", err);
    res.status(500).json({ error: "匯入失敗，本次所有變更已回滾：" + (err.message || "") });
  }
});

app.get("/api/templates/tasks", (_req, res) => {
  const BOM = "﻿";
  const csv = BOM + "工項ID（新增工項時留空）,父工項ID（新增工項時留空）,類型,任務名稱,組別,指派人,優先級,狀態,開始日期,結束日期,完成度\n" +
    ",,主工項,買電腦,,,高優先,待處理,2026-06-01,2026-07-01,0%\n" +
    ",,子工項,估價,,,,,2026-06-01,2026-06-10,0%\n" +
    ",,子工項,採購,,,,,2026-06-11,2026-06-20,0%\n" +
    ",,子工項,驗收,,,,,2026-06-21,2026-07-01,0%\n" +
    ",,主工項,網路建置,,,中優先,待處理,2026-06-10,2026-07-15,0%\n";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=task_import_template.csv");
  res.send(csv);
});

// ── MCP connector（OAuth 授權伺服器、/mcp、同意頁與管理 API） ──────────

mountMcp(app, { authMiddleware, requireAdmin });

// ── 錯誤處理：service 丟出的錯誤統一轉成 HTTP 回應 ─────────────────────

app.use((err: any, _req: any, res: any, _next: any) => {
  if (err instanceof ConflictError) return res.status(409).json({ error: err.message, details: err.details });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.code === "P2025") return res.status(404).json({ error: "找不到資料" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "JSON 格式錯誤" });
  console.error("未預期的錯誤:", err);
  res.status(500).json({ error: "伺服器錯誤" });
});

// ── 排程與啟動（測試環境不啟動） ──────────────────────────────────────

if (!process.env.VITEST) {
  // 每天早上 8 點（台灣時間 UTC+8 = UTC 0 點）
  cron.schedule("0 0 * * *", () => {
    checkDueTasks().catch(console.error);
  });
  checkDueTasks().catch(console.error); // 啟動時也跑一次

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  }).on("error", (err) => {
    console.error("Server error:", err);
  });
}
