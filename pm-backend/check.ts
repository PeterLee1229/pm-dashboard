import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const members = await prisma.projectMember.findMany({
    include: { user: { select: { name: true, email: true } }, project: { select: { name: true } } }
  });
  console.log('所有專案成員:', JSON.stringify(members, null, 2));

  const groups = await prisma.group.findMany({
    include: { users: { select: { name: true, memberId: true } } }
  });
  console.log('所有組別:', JSON.stringify(groups, null, 2));
}
main().finally(() => { prisma.$disconnect(); pool.end(); });
