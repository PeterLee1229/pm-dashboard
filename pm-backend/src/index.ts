import "dotenv/config";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

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

// 首頁
app.get("/", (req, res) => {
  res.json({ message: "PM Dashboard API 運作中" });
});

// ── Project API ────────────────────────────

// 取得所有專案
app.get("/api/projects", async (req, res) => {
  const projects = await prisma.project.findMany({
    include: { tasks: { include: { subtasks: true } } }
  });
  res.json(projects);
});

// 新增專案
app.post("/api/projects", async (req, res) => {
  const project = await prisma.project.create({
    data: {
      name: req.body.name,
      description: req.body.description || "",
      color: req.body.color || "#6366f1",
    }
  });
  res.status(201).json(project);
});

// 刪除專案（僅 PM）
app.delete("/api/projects/:id", authMiddleware, async (req: any, res) => {
  if (req.user.role !== "PM") {
    return res.status(403).json({ error: "權限不足" });
  }
  try {
    // 先刪該專案下所有任務的子工項，再刪任務，最後刪專案
    const tasks = await prisma.task.findMany({ where: { projectId: req.params.id } });
    for (const task of tasks) {
      await prisma.subTask.deleteMany({ where: { taskId: task.id } });
    }
    await prisma.task.deleteMany({ where: { projectId: req.params.id } });
    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到專案" });
  }
});

// ── Task API ───────────────────────────────

// 取得所有任務（可依專案篩選）
app.get("/api/tasks", authMiddleware, async (req, res) => {
  const where = req.query.projectId
    ? { projectId: req.query.projectId as string }
    : {};
  const tasks = await prisma.task.findMany({
    where,
    include: { subtasks: true }
  });
  res.json(tasks);
});

// 取得單一任務
app.get("/api/tasks/:id", authMiddleware, async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: { subtasks: true }
  });
  if (!task) return res.status(404).json({ error: "找不到任務" });
  res.json(task);
});

// 新增任務
app.post("/api/tasks", authMiddleware, async (req, res) => {
  const task = await prisma.task.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      priority: req.body.priority || "medium",
      assignee: req.body.assignee || "",
      groupId: req.body.groupId || "",
      startDate: req.body.startDate || "",
      endDate: req.body.endDate || "",
      columnId: req.body.columnId || "todo",
      projectId: req.body.projectId,
    }
  });
  res.status(201).json(task);
});

// 更新任務
app.put("/api/tasks/:id", authMiddleware, async (req, res) => {
  try {
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: req.body,
      include: { subtasks: true }
    });
    res.json(task);
  } catch {
    res.status(404).json({ error: "找不到任務" });
  }
});

// 刪除任務
app.delete("/api/tasks/:id", authMiddleware, async (req, res) => {
  try {
    // 先刪子工項
    await prisma.subTask.deleteMany({ where: { taskId: req.params.id } });
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到任務" });
  }
});

// ── SubTask API ────────────────────────────

// 新增子工項
app.post("/api/subtasks", authMiddleware, async (req, res) => {
  const subtask = await prisma.subTask.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      assignee: req.body.assignee || "",
      groupId: req.body.groupId || "",
      startDate: req.body.startDate || "",
      endDate: req.body.endDate || "",
      taskId: req.body.taskId,
    }
  });
  res.status(201).json(subtask);
});

// 更新子工項
app.put("/api/subtasks/:id", authMiddleware, async (req, res) => {
  try {
    const subtask = await prisma.subTask.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(subtask);
  } catch {
    res.status(404).json({ error: "找不到子工項" });
  }
});

// 刪除子工項
app.delete("/api/subtasks/:id", authMiddleware, async (req, res) => {
  try {
    await prisma.subTask.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到子工項" });
  }
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
