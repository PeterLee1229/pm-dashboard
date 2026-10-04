import { z } from "zod";
import { prisma } from "../db";
import { NotFoundError, parseInput } from "../errors";
import { Ctx, assertCan, assertCanRead } from "./permissions";
import { logActivity } from "./activity";

const optionalHttpUrl = z.string().trim().max(2000).refine((v) => {
  if (v === "") return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}, "連結必須是 http 或 https 網址");

const seriesSchema = z.object({
  name: z.string().trim().min(1, "會議名稱不可空白").max(200),
  type: z.enum(["regular", "adhoc"]).optional(),
});

const recordCreateSchema = z.object({
  date: z.string().trim().min(1, "會議日期不可空白").max(30),
  attendees: z.array(z.string().max(100)).max(500).optional(),
  summary: z.string().max(100000).optional(),
  externalLink: optionalHttpUrl.optional(),
});

const recordUpdateSchema = recordCreateSchema.omit({ date: true });

export async function listMeetings(ctx: Ctx, projectId: string) {
  await assertCanRead(ctx, projectId);
  return prisma.meetingSeries.findMany({
    where: { projectId },
    include: { records: { orderBy: { date: "desc" } } },
    orderBy: { createdAt: "asc" },
  });
}

/** 單筆會議紀錄完整內容（含所屬系列） */
export async function getMeetingRecord(ctx: Ctx, recordId: string) {
  const record = await prisma.meetingRecord.findUnique({
    where: { id: recordId },
    include: { series: { select: { id: true, name: true, type: true, projectId: true } } },
  });
  if (!record) throw new NotFoundError("找不到會議紀錄");
  await assertCanRead(ctx, record.series.projectId, "找不到會議紀錄");
  return record;
}

export async function createSeries(ctx: Ctx, projectId: string, input: unknown) {
  const data = parseInput(seriesSchema, input);
  await assertCan(ctx, projectId, "meeting.manage");
  const series = await prisma.meetingSeries.create({
    data: { name: data.name, type: data.type || "regular", projectId },
    include: { records: true },
  });
  await logActivity(ctx.userId, "create", "meeting_series", series.name, projectId, series.id);
  return series;
}

async function findSeriesOr404(seriesId: string) {
  const series = await prisma.meetingSeries.findUnique({ where: { id: seriesId } });
  if (!series) throw new NotFoundError("找不到會議系列");
  return series;
}

export async function deleteSeries(ctx: Ctx, seriesId: string) {
  const series = await findSeriesOr404(seriesId);
  await assertCan(ctx, series.projectId, "meeting.manage", "權限不足", "找不到會議系列");
  await prisma.meetingRecord.deleteMany({ where: { seriesId } });
  await prisma.meetingSeries.delete({ where: { id: seriesId } });
}

export async function createRecord(ctx: Ctx, seriesId: string, input: unknown) {
  const data = parseInput(recordCreateSchema, input);
  const series = await findSeriesOr404(seriesId);
  await assertCan(ctx, series.projectId, "meeting.manage", "權限不足", "找不到會議系列");
  const record = await prisma.meetingRecord.create({
    data: {
      date: data.date,
      attendees: data.attendees || [],
      summary: data.summary || "",
      externalLink: data.externalLink || "",
      seriesId,
    },
  });
  await logActivity(ctx.userId, "create", "meeting_record", record.date, series.projectId, record.id);
  return record;
}

async function findRecordOr404(recordId: string) {
  const record = await prisma.meetingRecord.findUnique({
    where: { id: recordId },
    include: { series: { select: { projectId: true } } },
  });
  if (!record) throw new NotFoundError("找不到會議紀錄");
  return record;
}

export async function updateRecord(ctx: Ctx, recordId: string, input: unknown) {
  const data = parseInput(recordUpdateSchema, input);
  const record = await findRecordOr404(recordId);
  await assertCan(ctx, record.series.projectId, "meeting.manage", "權限不足", "找不到會議紀錄");
  return prisma.meetingRecord.update({ where: { id: recordId }, data });
}

export async function deleteRecord(ctx: Ctx, recordId: string) {
  const record = await findRecordOr404(recordId);
  await assertCan(ctx, record.series.projectId, "meeting.manage", "權限不足", "找不到會議紀錄");
  await prisma.meetingRecord.delete({ where: { id: recordId } });
}
