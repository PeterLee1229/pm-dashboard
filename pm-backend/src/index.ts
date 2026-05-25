import "dotenv/config";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";

const pool = new pg.Pool({
  connectionString: "postgresql://postgres:mysecret@localhost:5432/postgres",
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any) as any;
const JWT_SECRET = process.env.JWT_SECRET!; // 正式環境要用環境變數
if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set. Set the JWT_SECRET environment variable.");
  process.exit(1);
}

const app = express();
app.use(express.json());

//前端呼叫後端的 CORS 設定，允許來自特定來源的請求，並允許攜帶 Cookie（credentials: true）
app.use(cors({
  origin: ["http://localhost:5173", "https://pm-dashboard-delta-eight.vercel.app"],
  credentials: true,
}));

// 首頁
app.get("/", (req, res) => {
  res.json({ message: "PM Dashboard API 運作中" });
});

// ── Project API ────────────────────────────

// 取得目前使用者的所有專案（自己建的 + 被加入的）
app.get("/api/projects", authMiddleware, async (req: any, res) => {
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { ownerId: req.user.userId },
        { groups: { some: { members: { some: { userId: req.user.userId } } } } }
      ]
    },
    include: {
      groups: {
        include: {
          members: {
            include: { user: { select: { id: true, name: true, memberId: true, email: true } } }
          }
        }
      }
    }
  });
  res.json(projects);
});

// 建立專案（自動設為 owner）
app.post("/api/projects", authMiddleware, async (req: any, res) => {
  const project = await prisma.project.create({
    data: {
      name: req.body.name,
      description: req.body.description || "",
      color: req.body.color || "#6366f1",
      ownerId: req.user.userId,
    }
  });
  res.status(201).json(project);
});

// 更新專案
app.put("/api/projects/:id", authMiddleware, async (req: any, res) => {
  try {
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        description: req.body.description,
        color: req.body.color,
      }
    });
    res.json(project);
  } catch {
    res.status(404).json({ error: "找不到專案" });
  }
});

// 刪除專案（Cascade 會自動清除 tasks、subtasks、groups）
app.delete("/api/projects/:id", authMiddleware, async (req: any, res) => {
  try {
    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到專案" });
  }
});

// ── Task API ───────────────────────────────

// 取得專案的所有任務（含子任務）
app.get("/api/projects/:projectId/tasks", authMiddleware, async (req: any, res) => {
  const tasks = await prisma.task.findMany({
    where: { projectId: req.params.projectId },
    include: { subtasks: true },
    orderBy: { createdAt: "asc" }
  });
  res.json(tasks);
});

// 建立任務
app.post("/api/projects/:projectId/tasks", authMiddleware, async (req: any, res) => {
  const task = await prisma.task.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      priority: req.body.priority || "medium",
      assignee: req.body.assignee || "",
      groupId: req.body.groupId || "",
      columnId: req.body.columnId || "todo",
      startDate: req.body.startDate || "",
      endDate: req.body.endDate || "",
      completion: req.body.completion || 0,
      timeLogs: req.body.timeLogs || [],
      projectId: req.params.projectId,
    },
    include: { subtasks: true }
  });
  res.status(201).json(task);
});

// 更新任務（含子任務同步）
app.put("/api/tasks/:id", authMiddleware, async (req: any, res) => {
  try {
    const { subtasks, ...taskData } = req.body;

    await prisma.task.update({
      where: { id: req.params.id },
      data: taskData,
    });

    if (subtasks && Array.isArray(subtasks)) {
      await prisma.subTask.deleteMany({ where: { taskId: req.params.id } });
      for (const sub of subtasks) {
        await prisma.subTask.create({
          data: {
            title: sub.title || "",
            description: sub.description || "",
            assignee: sub.assignee || "",
            groupId: sub.groupId || "",
            startDate: sub.startDate || "",
            endDate: sub.endDate || "",
            completion: sub.completion || 0,
            timeLogs: sub.timeLogs || [],
            taskId: req.params.id,
          }
        });
      }
    }

    const updated = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { subtasks: true }
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "找不到任務" });
  }
});

// 刪除任務（Cascade 會自動清除子任務）
app.delete("/api/tasks/:id", authMiddleware, async (req: any, res) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到任務" });
  }
});


// ── Group API ──────────────────────────────

// 取得專案的所有組別（含成員）
app.get("/api/projects/:projectId/groups", authMiddleware, async (req: any, res) => {
  const groups = await prisma.group.findMany({
    where: { projectId: req.params.projectId },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, memberId: true, email: true } } }
      }
    }
  });
  res.json(groups);
});

// 建立組別
app.post("/api/projects/:projectId/groups", authMiddleware, async (req: any, res) => {
  const group = await prisma.group.create({
    data: {
      name: req.body.name,
      color: req.body.color || "#6366f1",
      projectId: req.params.projectId,
    }
  });
  res.status(201).json(group);
});

// 把成員加入組別
app.post("/api/groups/:groupId/members", authMiddleware, async (req: any, res) => {
  const member = await prisma.groupMember.create({
    data: {
      groupId: req.params.groupId,
      userId: req.body.userId,
    },
    include: { user: { select: { id: true, name: true, memberId: true } } }
  });
  res.status(201).json(member);
});

// 從組別移除成員
app.delete("/api/groups/:groupId/members/:userId", authMiddleware, async (req: any, res) => {
  await prisma.groupMember.deleteMany({
    where: {
      groupId: req.params.groupId,
      userId: req.params.userId,
    }
  });
  res.json({ success: true });
});

// 更新組別
app.put("/api/groups/:id", authMiddleware, async (req: any, res) => {
  try {
    const group = await prisma.group.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        color: req.body.color,
      }
    });
    res.json(group);
  } catch {
    res.status(404).json({ error: "找不到組別" });
  }
});

// 刪除組別（Cascade 會自動清除成員關聯）
app.delete("/api/groups/:id", authMiddleware, async (req: any, res) => {
  try {
    await prisma.group.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到組別" });
  }
});

// 取得所有已註冊的使用者（管理者用，用來選人加入組別）
app.get("/api/users", authMiddleware, async (_req: any, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, memberId: true, email: true, role: true }
  });
  res.json(users);
});

// 註冊
app.post("/api/auth/register", async (req, res) => {
  const hashedPassword = await bcrypt.hash(req.body.password, 10);
  const user = await prisma.user.create({
    data: {
      email: req.body.email,
      password: hashedPassword,
      name: req.body.name,
      memberId: req.body.memberId,
      role: req.body.role || "member",
    }
  });
  res.status(201).json({ id: user.id, name: user.name });
});

// 登入
app.post("/api/auth/login", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { email: req.body.email }
  });
  if (!user) return res.status(401).json({ error: "帳號不存在" });

  const valid = await bcrypt.compare(req.body.password, user.password);
  if (!valid) return res.status(401).json({ error: "密碼錯誤" });

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// 驗證通行證的中間件
function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "未登入" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;  // 把使用者資訊放進 request
    next();              // 放行
  } catch {
    res.status(401).json({ error: "通行證無效" });
  }
}

// 啟動伺服器
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
}).on("error", (err) => {
  console.error("Server error:", err);
});

// ══ 會議系列 API ══════════════════════════════════════

// 取得專案的所有會議系列（含紀錄）
app.get("/api/projects/:projectId/meetings", authMiddleware, async (req: any, res) => {
  const series = await prisma.meetingSeries.findMany({
    where: { projectId: req.params.projectId },
    include: {
      records: { orderBy: { date: "desc" } }
    },
    orderBy: { createdAt: "asc" }
  });
  res.json(series);
});

// 建立會議系列
app.post("/api/projects/:projectId/meetings", authMiddleware, async (req: any, res) => {
  const series = await prisma.meetingSeries.create({
    data: {
      name: req.body.name,
      type: req.body.type || "regular",
      projectId: req.params.projectId,
    },
    include: { records: true }
  });
  res.status(201).json(series);
});

// 刪除會議系列
app.delete("/api/meetings/:id", authMiddleware, async (req: any, res) => {
  await prisma.meetingRecord.deleteMany({ where: { seriesId: req.params.id } });
  await prisma.meetingSeries.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// 新增會議紀錄
app.post("/api/meetings/:seriesId/records", authMiddleware, async (req: any, res) => {
  const record = await prisma.meetingRecord.create({
    data: {
      date: req.body.date,
      attendees: req.body.attendees || [],
      summary: req.body.summary || "",
      externalLink: req.body.externalLink || "",
      seriesId: req.params.seriesId,
    }
  });
  res.status(201).json(record);
});

// 更新會議紀錄
app.put("/api/meeting-records/:id", authMiddleware, async (req: any, res) => {
  const record = await prisma.meetingRecord.update({
    where: { id: req.params.id },
    data: {
      summary: req.body.summary,
      attendees: req.body.attendees,
      externalLink: req.body.externalLink,
    }
  });
  res.json(record);
});

// 刪除會議紀錄
app.delete("/api/meeting-records/:id", authMiddleware, async (req: any, res) => {
  await prisma.meetingRecord.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ══ 風險 API ══════════════════════════════════════════

// 取得專案的所有風險
app.get("/api/projects/:projectId/risks", authMiddleware, async (req: any, res) => {
  const risks = await prisma.risk.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: "asc" }
  });
  res.json(risks);
});

// 建立風險
app.post("/api/projects/:projectId/risks", authMiddleware, async (req: any, res) => {
  const risk = await prisma.risk.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      probability: req.body.probability || "medium",
      impact: req.body.impact || "medium",
      countermeasure: req.body.countermeasure || "",
      ownerId: req.body.ownerId || "",
      ownerGroupId: req.body.ownerGroupId || "",
      status: req.body.status || "monitoring",
      createdDate: req.body.createdDate || new Date().toISOString().split("T")[0],
      projectId: req.params.projectId,
    }
  });
  res.status(201).json(risk);
});

// 更新風險
app.put("/api/risks/:id", authMiddleware, async (req: any, res) => {
  const risk = await prisma.risk.update({
    where: { id: req.params.id },
    data: {
      title: req.body.title,
      description: req.body.description,
      probability: req.body.probability,
      impact: req.body.impact,
      countermeasure: req.body.countermeasure,
      ownerId: req.body.ownerId,
      ownerGroupId: req.body.ownerGroupId,
      status: req.body.status,
    }
  });
  res.json(risk);
});

// 刪除風險
app.delete("/api/risks/:id", authMiddleware, async (req: any, res) => {
  await prisma.risk.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ══ 週報 API ══════════════════════════════════════════

// 取得專案的所有週報
app.get("/api/projects/:projectId/weekly-reports", authMiddleware, async (req: any, res) => {
  const reports = await prisma.weeklyReport.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { weekStart: "desc" }
  });
  res.json(reports);
});

// 建立或更新週報備註
app.put("/api/projects/:projectId/weekly-reports", authMiddleware, async (req: any, res) => {
  const report = await prisma.weeklyReport.upsert({
    where: {
      projectId_weekStart: {
        projectId: req.params.projectId,
        weekStart: req.body.weekStart,
      }
    },
    update: {
      notes: req.body.notes,
    },
    create: {
      weekStart: req.body.weekStart,
      weekEnd: req.body.weekEnd,
      notes: req.body.notes || "",
      projectId: req.params.projectId,
    }
  });
  res.json(report);
});