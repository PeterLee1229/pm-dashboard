import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcrypt";
import "dotenv/config";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // 建立預設組別
  const groups = [
    { name: "專管組", color: "#6366f1" },
    { name: "美術組", color: "#f59e0b" },
    { name: "設計組", color: "#8b5cf6" },
    { name: "硬體組", color: "#10b981" },
    { name: "軟體組", color: "#06b6d4" },
    { name: "維運組", color: "#f43f5e" },
    { name: "費曼圖", color: "#facc15" },
  ];

  for (const g of groups) {
    await prisma.group.upsert({
      where: { name: g.name },
      update: {},
      create: g,
    });
  }
  console.log("預設組別建立完成");

  // 建立 admin 帳號
  const adminPassword = await bcrypt.hash("Admin@12345", 10);
  await prisma.user.upsert({
    where: { email: "admin@pm.local" },
    update: {},
    create: {
      email: "admin@pm.local",
      password: adminPassword,
      name: "系統管理員",
      memberId: "ADMIN",
      role: "admin",
    },
  });
  console.log("Admin 帳號建立完成");
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});