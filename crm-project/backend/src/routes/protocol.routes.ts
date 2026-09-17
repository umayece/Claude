import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { buildOrderBy, paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { auditAction } from '../middleware/audit';
import { nextSequence } from '../services/sequence.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

export const VISIT_TYPES = [
  'ATAŞE_ZİYARETİ', 'DELEGASYON', 'FABRİKA_GEZİSİ', 'POLİGON_TESTİ', 'DİĞER',
] as const;
export const VISIT_STATUSES = [
  'Planlandı', 'Onay Bekliyor', 'Devam Ediyor', 'Tamamlandı', 'İptal',
] as const;
export const CLASSIFICATIONS = ['Tasnif Dışı', 'Hizmete Özel', 'Gizli'] as const;
export const ACTIVITY_TYPES = [
  'KARŞILAMA', 'BRİFİNG', 'FABRİKA_GEZİSİ', 'POLİGON_TESTİ', 'YEMEK', 'TRANSFER', 'DİĞER',
] as const;
export const CHECKLIST_CATEGORIES = [
  'HEDİYELİK', 'ARAÇ', 'YEMEK', 'GÜVENLİK', 'KONAKLAMA', 'SUNUM', 'DİĞER',
] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const visitBodySchema = z.object({
  title: z.string().trim().min(3).max(300),
  visitType: z.enum(VISIT_TYPES).default('DELEGASYON'),
  status: z.enum(VISIT_STATUSES).default('Planlandı'),
  country: z.string().trim().min(2).max(80),
  countryCode: z.string().trim().length(2).toUpperCase().default('TR'),
  companyId: z.string().uuid().nullish(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish(),
  location: z.string().trim().max(200).nullish(),
  classification: z.enum(CLASSIFICATIONS).default('Hizmete Özel'),
  summary: z.string().max(10_000).nullish(),
  hostUserId: z.string().uuid().nullish(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(VISIT_STATUSES).optional(),
  visitType: z.enum(VISIT_TYPES).optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  /** true → yalnızca bugünden sonraki ziyaretler. */
  upcoming: z.coerce.boolean().optional(),
  sort: z.string().max(40).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const visitInclude = {
  company: { select: { id: true, name: true, type: true } },
  host: { select: { id: true, name: true, avatarUrl: true } },
  _count: { select: { agenda: true, participants: true, checklist: true, documents: true } },
} satisfies Prisma.ProtocolVisitInclude;

/** GET /api/v1/protocol-visits */
router.get(
  '/',
  requirePermission('protocol:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const orderBy = buildOrderBy(
      query.sort,
      ['startDate', 'createdAt', 'title', 'status'] as const,
      'startDate',
    );

    const and: Prisma.ProtocolVisitWhereInput[] = [{ deletedAt: null }];
    if (query.status) and.push({ status: query.status });
    if (query.visitType) and.push({ visitType: query.visitType });
    if (query.countryCode) and.push({ countryCode: query.countryCode });
    if (query.upcoming) and.push({ startDate: { gte: new Date() } });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { visitCode: { contains: query.q, mode: 'insensitive' } },
          { country: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.ProtocolVisitWhereInput = { AND: and };
    const [rows, total] = await prisma.$transaction([
      prisma.protocolVisit.findMany({
        where, include: visitInclude, orderBy, skip: page.skip, take: page.take,
      }),
      prisma.protocolVisit.count({ where }),
    ]);

    // Açık kontrol maddesi sayısı liste ekranında uyarı rozetini besler.
    const pendingCounts = await prisma.visitChecklistItem.groupBy({
      by: ['visitId'],
      where: { visitId: { in: rows.map((r) => r.id) }, isDone: false },
      _count: { _all: true },
    });
    const pendingByVisit = new Map(pendingCounts.map((c) => [c.visitId, c._count._all]));

    res.json(
      paginated(
        rows.map((row) => ({
          ...row,
          pendingChecklist: pendingByVisit.get(row.id) ?? 0,
          daysUntilStart: Math.ceil((row.startDate.getTime() - Date.now()) / 86_400_000),
        })),
        total,
        page,
      ),
    );
  }),
);

/** GET /api/v1/protocol-visits/:id — program, katılımcılar, kontrol listesi, evraklar. */
router.get(
  '/:id',
  requirePermission('protocol:read'),
  asyncHandler(async (req, res) => {
    const visit = await prisma.protocolVisit.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: {
        ...visitInclude,
        agenda: { orderBy: [{ day: 'asc' }, { startTime: 'asc' }, { sortOrder: 'asc' }] },
        participants: { orderBy: [{ side: 'asc' }, { sortOrder: 'asc' }, { fullName: 'asc' }] },
        checklist: { orderBy: [{ isDone: 'asc' }, { sortOrder: 'asc' }] },
        documents: {
          where: { deletedAt: null },
          // İçerik (Bytes) bilinçli olarak seçilmez: liste yanıtına
          // megabaytlarca dosya gövdesi koymak belleği ve ağı boğar.
          select: {
            id: true, title: true, fileName: true, mimeType: true, sizeBytes: true,
            category: true, classification: true, createdAt: true,
            uploadedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!visit) throw NotFound('Ziyaret kaydı bulunamadı.');

    const guests = visit.participants.filter((p) => p.side === 'MISAFIR');
    const hosts = visit.participants.filter((p) => p.side === 'EV_SAHIBI');

    res.json({
      ...visit,
      summaryStats: {
        guestCount: guests.length,
        guestAttending: guests.filter((p) => p.isAttending).length,
        hostCount: hosts.length,
        checklistDone: visit.checklist.filter((c) => c.isDone).length,
        checklistTotal: visit.checklist.length,
        agendaDays: new Set(visit.agenda.map((a) => a.day.toISOString().slice(0, 10))).size,
      },
    });
  }),
);

/** POST /api/v1/protocol-visits */
router.post(
  '/',
  requirePermission('protocol:write'),
  validate(visitBodySchema),
  auditAction('VISIT_CREATE', 'ProtocolVisit'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof visitBodySchema>;

    const visit = await prisma.protocolVisit.create({
      data: {
        visitCode: await nextSequence('ZYR'),
        title: body.title,
        visitType: body.visitType,
        status: body.status,
        country: body.country,
        countryCode: body.countryCode,
        companyId: body.companyId ?? null,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        location: body.location ?? null,
        classification: body.classification,
        summary: body.summary ?? null,
        hostUserId: body.hostUserId ?? req.user!.id,
      },
      include: visitInclude,
    });

    req.auditContext = { entityType: 'ProtocolVisit', entityId: visit.id };
    res.status(201).json(visit);
  }),
);

/** PUT /api/v1/protocol-visits/:id */
router.put(
  '/:id',
  requirePermission('protocol:write'),
  validate(visitBodySchema.partial()),
  auditAction('VISIT_UPDATE', 'ProtocolVisit'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.protocolVisit.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw NotFound('Ziyaret kaydı bulunamadı.');

    const body = req.body as Partial<z.infer<typeof visitBodySchema>>;
    const visit = await prisma.protocolVisit.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.visitType !== undefined ? { visitType: body.visitType } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.countryCode !== undefined ? { countryCode: body.countryCode } : {}),
        ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.classification !== undefined ? { classification: body.classification } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.hostUserId !== undefined ? { hostUserId: body.hostUserId } : {}),
      },
      include: visitInclude,
    });

    res.json(visit);
  }),
);

/** DELETE /api/v1/protocol-visits/:id */
router.delete(
  '/:id',
  requirePermission('protocol:delete'),
  auditAction('VISIT_DELETE', 'ProtocolVisit'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.protocolVisit.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw NotFound('Ziyaret kaydı bulunamadı.');
    await prisma.protocolVisit.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Program (agenda)
// ---------------------------------------------------------------------------

async function assertVisit(id: string): Promise<{ id: string }> {
  const visit = await prisma.protocolVisit.findFirst({
    where: { id, deletedAt: null }, select: { id: true },
  });
  if (!visit) throw NotFound('Ziyaret kaydı bulunamadı.');
  return visit;
}

const agendaSchema = z
  .object({
    day: z.coerce.date(),
    startTime: z.string().regex(TIME_PATTERN, 'Saat "SS:DD" biçiminde olmalıdır.'),
    endTime: z.string().regex(TIME_PATTERN, 'Saat "SS:DD" biçiminde olmalıdır.').nullish(),
    title: z.string().trim().min(2).max(200),
    activityType: z.enum(ACTIVITY_TYPES).default('DİĞER'),
    location: z.string().trim().max(200).nullish(),
    responsible: z.string().trim().max(160).nullish(),
    notes: z.string().max(4000).nullish(),
    sortOrder: z.number().int().min(0).max(999).default(0),
  })
  .refine((v) => !v.endTime || v.endTime > v.startTime, {
    message: 'Bitiş saati başlangıçtan sonra olmalıdır.',
    path: ['endTime'],
  });

router.post(
  '/:id/agenda',
  requirePermission('protocol:write'),
  validate(agendaSchema),
  auditAction('VISIT_AGENDA_CREATE', 'VisitAgendaItem'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));
    const body = req.body as z.infer<typeof agendaSchema>;

    const item = await prisma.visitAgendaItem.create({
      data: {
        visitId: visit.id,
        day: body.day,
        startTime: body.startTime,
        endTime: body.endTime ?? null,
        title: body.title,
        activityType: body.activityType,
        location: body.location ?? null,
        responsible: body.responsible ?? null,
        notes: body.notes ?? null,
        sortOrder: body.sortOrder,
      },
    });

    res.status(201).json(item);
  }),
);

router.put(
  '/:id/agenda/:itemId',
  requirePermission('protocol:write'),
  validate(agendaSchema.innerType().partial()),
  auditAction('VISIT_AGENDA_UPDATE', 'VisitAgendaItem'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));
    const itemId = String(req.params.itemId);

    const existing = await prisma.visitAgendaItem.findFirst({
      where: { id: itemId, visitId: visit.id },
    });
    if (!existing) throw NotFound('Program maddesi bulunamadı.');

    const item = await prisma.visitAgendaItem.update({
      where: { id: itemId },
      data: req.body as Prisma.VisitAgendaItemUpdateInput,
    });
    res.json(item);
  }),
);

router.delete(
  '/:id/agenda/:itemId',
  requirePermission('protocol:write'),
  auditAction('VISIT_AGENDA_DELETE', 'VisitAgendaItem'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));
    const result = await prisma.visitAgendaItem.deleteMany({
      where: { id: String(req.params.itemId), visitId: visit.id },
    });
    if (result.count === 0) throw NotFound('Program maddesi bulunamadı.');
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Katılımcılar
// ---------------------------------------------------------------------------

const participantSchema = z.object({
  side: z.enum(['MISAFIR', 'EV_SAHIBI']).default('MISAFIR'),
  fullName: z.string().trim().min(2).max(160),
  title: z.string().trim().max(120).nullish(),
  rank: z.string().trim().max(120).nullish(),
  organization: z.string().trim().max(160).nullish(),
  nationality: z.string().trim().max(80).nullish(),
  passportNo: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().max(255).nullish().or(z.literal('')),
  phone: z.string().trim().max(40).nullish(),
  isAttending: z.boolean().default(true),
  absenceReason: z.string().trim().max(300).nullish(),
  contactId: z.string().uuid().nullish(),
  userId: z.string().uuid().nullish(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

router.post(
  '/:id/participants',
  requirePermission('protocol:write'),
  validate(participantSchema),
  auditAction('VISIT_PARTICIPANT_CREATE', 'VisitParticipant'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));
    const body = req.body as z.infer<typeof participantSchema>;

    const participant = await prisma.visitParticipant.create({
      data: {
        visitId: visit.id,
        side: body.side,
        fullName: body.fullName,
        title: body.title ?? null,
        rank: body.rank ?? null,
        organization: body.organization ?? null,
        nationality: body.nationality ?? null,
        passportNo: body.passportNo ?? null,
        email: body.email || null,
        phone: body.phone ?? null,
        isAttending: body.isAttending,
        absenceReason: body.isAttending ? null : body.absenceReason ?? null,
        contactId: body.contactId ?? null,
        userId: body.userId ?? null,
        sortOrder: body.sortOrder,
      },
    });

    res.status(201).json(participant);
  }),
);

router.put(
  '/:id/participants/:participantId',
  requirePermission('protocol:write'),
  validate(participantSchema.partial()),
  auditAction('VISIT_PARTICIPANT_UPDATE', 'VisitParticipant'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));
    const participantId = String(req.params.participantId);

    const existing = await prisma.visitParticipant.findFirst({
      where: { id: participantId, visitId: visit.id },
    });
    if (!existing) throw NotFound('Katılımcı bulunamadı.');

    const body = req.body as Partial<z.infer<typeof participantSchema>>;
    const participant = await prisma.visitParticipant.update({
      where: { id: participantId },
      data: {
        ...(body.side !== undefined ? { side: body.side } : {}),
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.rank !== undefined ? { rank: body.rank } : {}),
        ...(body.organization !== undefined ? { organization: body.organization } : {}),
        ...(body.nationality !== undefined ? { nationality: body.nationality } : {}),
        ...(body.passportNo !== undefined ? { passportNo: body.passportNo } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
        ...(body.userId !== undefined ? { userId: body.userId } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        // Katılmayan kişi listeden SİLİNMEZ, işaretlenir: heyet listesi
        // resmî bir belgedir ve kimin gelmediği de bilgidir.
        ...(body.isAttending !== undefined
          ? {
              isAttending: body.isAttending,
              absenceReason: body.isAttending ? null : body.absenceReason ?? existing.absenceReason,
            }
          : body.absenceReason !== undefined
            ? { absenceReason: body.absenceReason }
            : {}),
      },
    });

    res.json(participant);
  }),
);

router.delete(
  '/:id/participants/:participantId',
  requirePermission('protocol:write'),
  auditAction('VISIT_PARTICIPANT_DELETE', 'VisitParticipant'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));
    const result = await prisma.visitParticipant.deleteMany({
      where: { id: String(req.params.participantId), visitId: visit.id },
    });
    if (result.count === 0) throw NotFound('Katılımcı bulunamadı.');
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Kontrol listesi
// ---------------------------------------------------------------------------

const checklistSchema = z.object({
  title: z.string().trim().min(2).max(200),
  category: z.enum(CHECKLIST_CATEGORIES).default('DİĞER'),
  isDone: z.boolean().default(false),
  dueDate: z.coerce.date().nullish(),
  assignedUserId: z.string().uuid().nullish(),
  note: z.string().max(2000).nullish(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

/** Yeni ziyaretlerde hazır gelen standart karşılama maddeleri. */
const DEFAULT_CHECKLIST: { title: string; category: string }[] = [
  { title: 'Hediyelikler hazırlandı', category: 'HEDİYELİK' },
  { title: 'Araç tahsisi ve şoför görevlendirmesi', category: 'ARAÇ' },
  { title: 'VIP yemek rezervasyonu', category: 'YEMEK' },
  { title: 'Tesis güvenlik izinleri alındı', category: 'GÜVENLİK' },
  { title: 'Misafir pasaport/kimlik listesi teslim alındı', category: 'GÜVENLİK' },
  { title: 'Konaklama rezervasyonu', category: 'KONAKLAMA' },
  { title: 'Brifing sunumu hazırlandı', category: 'SUNUM' },
  { title: 'Tercüman görevlendirmesi', category: 'DİĞER' },
];

router.post(
  '/:id/checklist',
  requirePermission('protocol:write'),
  validate(checklistSchema),
  auditAction('VISIT_CHECKLIST_CREATE', 'VisitChecklistItem'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));
    const body = req.body as z.infer<typeof checklistSchema>;

    const item = await prisma.visitChecklistItem.create({
      data: {
        visitId: visit.id,
        title: body.title,
        category: body.category,
        isDone: body.isDone,
        dueDate: body.dueDate ?? null,
        assignedUserId: body.assignedUserId ?? null,
        note: body.note ?? null,
        sortOrder: body.sortOrder,
        completedAt: body.isDone ? new Date() : null,
      },
    });

    res.status(201).json(item);
  }),
);

/** POST /:id/checklist/seed — standart karşılama maddelerini toplu ekler. */
router.post(
  '/:id/checklist/seed',
  requirePermission('protocol:write'),
  auditAction('VISIT_CHECKLIST_SEED', 'VisitChecklistItem'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));

    const existingTitles = new Set(
      (await prisma.visitChecklistItem.findMany({
        where: { visitId: visit.id }, select: { title: true },
      })).map((i) => i.title),
    );

    // Aynı maddeyi ikinci kez eklemez; düğmeye tekrar basmak zararsızdır.
    const toCreate = DEFAULT_CHECKLIST.filter((item) => !existingTitles.has(item.title));
    if (toCreate.length > 0) {
      await prisma.visitChecklistItem.createMany({
        data: toCreate.map((item, index) => ({
          visitId: visit.id, title: item.title, category: item.category, sortOrder: index,
        })),
      });
    }

    res.json({ success: true, created: toCreate.length, skipped: DEFAULT_CHECKLIST.length - toCreate.length });
  }),
);

router.put(
  '/:id/checklist/:itemId',
  requirePermission('protocol:write'),
  validate(checklistSchema.partial()),
  auditAction('VISIT_CHECKLIST_UPDATE', 'VisitChecklistItem'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));
    const itemId = String(req.params.itemId);

    const existing = await prisma.visitChecklistItem.findFirst({
      where: { id: itemId, visitId: visit.id },
    });
    if (!existing) throw NotFound('Kontrol maddesi bulunamadı.');

    const body = req.body as Partial<z.infer<typeof checklistSchema>>;
    const item = await prisma.visitChecklistItem.update({
      where: { id: itemId },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
        ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.isDone !== undefined
          ? { isDone: body.isDone, completedAt: body.isDone ? new Date() : null }
          : {}),
      },
    });

    res.json(item);
  }),
);

router.delete(
  '/:id/checklist/:itemId',
  requirePermission('protocol:write'),
  auditAction('VISIT_CHECKLIST_DELETE', 'VisitChecklistItem'),
  asyncHandler(async (req, res) => {
    const visit = await assertVisit(String(req.params.id));
    const result = await prisma.visitChecklistItem.deleteMany({
      where: { id: String(req.params.itemId), visitId: visit.id },
    });
    if (result.count === 0) throw NotFound('Kontrol maddesi bulunamadı.');
    res.json({ success: true });
  }),
);

export default router;
