import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcrypt";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString: url });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any) as any;

// ── 設定 ──────────────────────────────────────────────────────────────

const ADMIN_EMAIL    = "admin@pm.local";
const ADMIN_PASSWORD = "Admin@12345";
const ADMIN_NAME     = "系統管理員";
const ADMIN_MEMBERID = "ADMIN001";

// ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 開始 seed...\n");

  // 1. 建立或更新 admin 帳號
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

  if (existing) {
    await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { role: "admin" } });
    console.log(`✅ 已將 ${ADMIN_EMAIL} 的 role 更新為 admin`);
  } else {
    const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await prisma.user.create({
      data: {
        email:    ADMIN_EMAIL,
        password: hashed,
        name:     ADMIN_NAME,
        memberId: ADMIN_MEMBERID,
        role:     "admin",
      },
    });
    console.log(`✅ 已建立 admin 帳號：${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    console.log("   ⚠️  請登入後立即修改密碼！");
  }

  // 2. 為所有現有專案補齊 ProjectMember（owner 角色）
  const projects = await prisma.project.findMany({ where: { ownerId: { not: null } } });

  let fixed = 0;
  for (const project of projects) {
    const alreadyExists = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: project.ownerId } },
    });
    if (!alreadyExists) {
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: project.ownerId, role: "owner" },
      });
      fixed++;
    }
  }

  if (fixed > 0) {
    console.log(`\n✅ 已為 ${fixed} 個現有專案補齊 ProjectMember（owner）記錄`);
  } else {
    console.log("\nℹ️  所有專案的 ProjectMember 記錄均已存在，無需補齊");
  }

  // 3. 建立系統層級預設組別
  const defaultGroups = [
    { name: "專管組", color: "#6366f1" },
    { name: "美術組", color: "#f59e0b" },
    { name: "設計組", color: "#8b5cf6" },
    { name: "硬體組", color: "#10b981" },
    { name: "軟體組", color: "#06b6d4" },
    { name: "維運組", color: "#f43f5e" },
    { name: "費曼圖", color: "#facc15" },
  ];

  for (const g of defaultGroups) {
    await prisma.group.upsert({ where: { name: g.name }, update: {}, create: g });
  }
  console.log(`\n✅ 預設組別確認完成（共 ${defaultGroups.length} 個）`);

  console.log("\n✨ Seed 完成！");
}

main()
  .catch((e) => { console.error("❌ Seed 失敗:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
