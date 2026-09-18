/**
 * Aktivite havuzu — fuar, toplantı, saha ziyareti, fabrika gezisi.
 *
 * Kayıtlar kuruma/kişiye/fırsata bağlı olmak ZORUNDA DEĞİLDİR: IDEF gibi
 * bir fuar hiçbir müşteriye ait değildir, kendi başına bir etkinliktir.
 * Bu yüzden erişim kapsamı `contact:read` benzeri bir mantıkla çalışır:
 * kuruma bağlıysa kurum kapsamı, bağlı değilse yetkisi olan herkes.
 */
import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { BadRequest, NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { buildOrderBy, paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, assertCompanyAccess, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { auditAction } from '../middleware/audit';
import { logActivity } from '../services/activity.service';
import { SUPPORTED_CURRENCIES } from '../services/currency.service';
import { nextSequence } from '../services/sequence.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

export const ACTIVITY_TYPES = [
  'TOPLANTI', 'FUAR', 'SAHA_ZIYARETI', 'FABRIKA_GEZISI', 'DIGER',
] as const;
export const ACTIVITY_STATUSES = [
  'Planlandı', 'Devam Ediyor', 'Tamamlandı', 'İptal',
] as const;
export const INTEREST_LEVELS = ['Sıcak', 'Ilık', 'Soğuk'] as const;

const bodySchema = z.object({
  title: z.string().trim().min(2).max(300),
  type: z.enum(ACTIVITY_TYPES).default('TOPLANTI'),
  status: z.enum(ACTIVITY_STATUSES).default('Planlandı'),
  activityCode: z.string().trim().max(60).optional(),

  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish(),

  location: z.string().trim().max(200).nullish(),
  venue: z.string().trim().max(200).nullish(),
  country: z.string().trim().max(80).default('Türkiye'),
  countryCode: z.string().trim().length(2).toUpperCase().default('TR'),

  objective: z.string().max(5000).nullish(),
  summary: z.string().max(20_000).nullish(),
  outcomeNote: z.string().max(20_000).nullish(),
  leadCount: z.number().int().min(0).max(100_000).default(0),

  budgetAmount: z.number().min(0).max(1e12).nullish(),
  budgetCurrency: z.enum(SUPPORTED_CURRENCIES).default('USD'),

  ownerId: z.string().uuid().nullish(),
  companyId: z.string().uuid().nullish(),
  dealId: z.string().uuid().nullish(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  type: z.enum(ACTIVITY_TYPES).optional(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  companyId: z.string().uuid().optional(),
  /** Sonuç raporu henüz girilmemiş, bitmiş fuarlar. */
  awaitingReport: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.string().max(40).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const listInclude = {
  owner: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  _count: { select: { team: true, contacts: true, documents: true } },
} satisfies Prisma.BusinessActivityInclude;

/**
 * Erişim kapsamı.
 *
 * Kuruma bağlı aktivite kurum kapsamını izler; bağımsız aktivite
 * (companyId = null) yetkisi olan herkese görünür — hiçbir departmana ait
 * olmadığı için departman filtresi ona uygulanamaz.
 */
function activityScope(user: Request['user']): Prisma.BusinessActivityWhereInput {
  return { OR: [{ companyId: null }, { company: companyScope(user) }] };
}

/** GET /api/v1/activities */
router.get(
  '/',
  requirePermission('activity:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);

    const and: Prisma.BusinessActivityWhereInput[] = [
      { deletedAt: null },
      activityScope(req.user),
    ];
    if (query.type) and.push({ type: query.type });
    if (query.status) and.push({ status: query.status });
    if (query.countryCode) and.push({ countryCode: query.countryCode });
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.from) and.push({ startDate: { gte: query.from } });
    if (query.to) and.push({ startDate: { lte: query.to } });
    if (query.awaitingReport) {
      // Bitmiş ama raporu yazılmamış etkinlikler.
      and.push({ outcomeReportAt: null, startDate: { lt: new Date() } });
    }
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { activityCode: { contains: query.q, mode: 'insensitive' } },
          { location: { contains: query.q, mode: 'insensitive' } },
          { venue: { contains: query.q, mode: 'insensitive' } },
          { country: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.BusinessActivityWhereInput = { AND: and };
    const orderBy = buildOrderBy(
      query.sort, ['startDate', 'title', 'type', 'status', 'createdAt'] as const, 'startDate',
    );

    const [rows, total] = await prisma.$transaction([
      prisma.businessActivity.findMany({
        where, orderBy, skip: page.skip, take: page.take, include: listInclude,
      }),
      prisma.businessActivity.count({ where }),
    ]);

    res.json(paginated(rows, total, page));
  }),
);

/** GET /api/v1/activities/summary — üst şerit sayaçları. */
router.get(
  '/summary',
  requirePermission('activity:read'),
  asyncHandler(async (req, res) => {
    const base: Prisma.BusinessActivityWhereInput = {
      deletedAt: null,
      ...activityScope(req.user),
    };
    const now = new Date();

    const [total, upcoming, fairs, awaitingReport] = await prisma.$transaction([
      prisma.businessActivity.count({ where: base }),
      prisma.businessActivity.count({
        where: { ...base, startDate: { gte: now }, status: { notIn: ['İptal'] } },
      }),
      prisma.businessActivity.count({ where: { ...base, type: 'FUAR' } }),
      prisma.businessActivity.count({
        where: {
          ...base, type: 'FUAR', outcomeReportAt: null,
          startDate: { lt: now }, status: { notIn: ['İptal'] },
        },
      }),
    ]);

    res.json({ total, upcoming, fairs, awaitingReport });
  }),
);

/** GET /api/v1/activities/:id — detay: ekip, görüşülen kişiler, belgeler. */
router.get(
  '/:id',
  requirePermission('activity:read'),
  asyncHandler(async (req, res) => {
    const activity = await prisma.businessActivity.findFirst({
      where: { id: req.params.id, deletedAt: null, ...activityScope(req.user) },
      include: {
        owner: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true, stage: true } },
        team: { orderBy: [{ sortOrder: 'asc' }, { fullName: 'asc' }] },
        contacts: {
          orderBy: { createdAt: 'desc' },
          include: {
            contact: {
              select: {
                id: true, firstName: true, lastName: true, title: true, email: true,
                contactType: true, country: true, countryCode: true,
                company: { select: { id: true, name: true } },
              },
            },
          },
        },
        // Belge içeriği (Bytes) ASLA listeyle dönmez: tek bir sunum bile
        // yanıtı megabaytlara çıkarır. İndirme ayrı uç noktadan yapılır.
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, title: true, fileName: true, mimeType: true, sizeBytes: true,
            category: true, classification: true, createdAt: true,
          },
        },
      },
    });
    if (!activity) throw NotFound('Aktivite bulunamadı.');
    res.json(activity);
  }),
);

/** POST /api/v1/activities */
router.post(
  '/',
  requirePermission('activity:write'),
  validate(bodySchema),
  auditAction('ACTIVITY_CREATE', 'BusinessActivity'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof bodySchema>;
    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);

    const activity = await prisma.businessActivity.create({
      data: {
        activityCode: body.activityCode || (await nextSequence('AKT')),
        title: body.title,
        type: body.type,
        status: body.status,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        location: body.location ?? null,
        venue: body.venue ?? null,
        country: body.country,
        countryCode: body.countryCode,
        objective: body.objective ?? null,
        summary: body.summary ?? null,
        outcomeNote: body.outcomeNote ?? null,
        outcomeReportAt: body.outcomeNote ? new Date() : null,
        leadCount: body.leadCount,
        budgetAmount: body.budgetAmount ?? null,
        budgetCurrency: body.budgetCurrency,
        ownerId: body.ownerId ?? req.user!.id,
        companyId: body.companyId ?? null,
        dealId: body.dealId ?? null,
      },
      include: listInclude,
    });

    req.auditContext = { entityType: 'BusinessActivity', entityId: activity.id };
    await logActivity({
      type: 'SYSTEM',
      title: `Aktivite oluşturuldu: ${activity.title}`,
      companyId: activity.companyId, dealId: activity.dealId, userId: req.user!.id,
    });

    res.status(201).json(activity);
  }),
);

/** PUT /api/v1/activities/:id */
router.put(
  '/:id',
  requirePermission('activity:write'),
  validate(bodySchema.partial()),
  auditAction('ACTIVITY_UPDATE', 'BusinessActivity'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.businessActivity.findFirst({
      where: { id, deletedAt: null, ...activityScope(req.user) },
      select: { id: true, companyId: true, outcomeReportAt: true },
    });
    if (!existing) throw NotFound('Aktivite bulunamadı.');

    const body = req.body as Partial<z.infer<typeof bodySchema>>;
    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);

    // Sonuç raporu ilk kez yazıldığında damga vurulur; sonraki
    // düzeltmeler damgayı ileri taşımaz — rapor tarihi raporun
    // teslim tarihidir, son düzenleme tarihi değil.
    const stampReport = body.outcomeNote !== undefined
      && body.outcomeNote !== null
      && body.outcomeNote.trim() !== ''
      && existing.outcomeReportAt === null;

    const activity = await prisma.businessActivity.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.venue !== undefined ? { venue: body.venue } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.countryCode !== undefined ? { countryCode: body.countryCode } : {}),
        ...(body.objective !== undefined ? { objective: body.objective } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.outcomeNote !== undefined ? { outcomeNote: body.outcomeNote } : {}),
        ...(stampReport ? { outcomeReportAt: new Date() } : {}),
        ...(body.leadCount !== undefined ? { leadCount: body.leadCount } : {}),
        ...(body.budgetAmount !== undefined ? { budgetAmount: body.budgetAmount } : {}),
        ...(body.budgetCurrency !== undefined ? { budgetCurrency: body.budgetCurrency } : {}),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
        ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        ...(body.dealId !== undefined ? { dealId: body.dealId } : {}),
      },
      include: listInclude,
    });

    res.json(activity);
  }),
);

/** DELETE /api/v1/activities/:id — yumuşak silme. */
router.delete(
  '/:id',
  requirePermission('activity:delete'),
  auditAction('ACTIVITY_DELETE', 'BusinessActivity'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.businessActivity.findFirst({
      where: { id, deletedAt: null, ...activityScope(req.user) },
      select: { id: true, title: true },
    });
    if (!existing) throw NotFound('Aktivite bulunamadı.');

    await prisma.businessActivity.update({
      where: { id }, data: { deletedAt: new Date() },
    });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Katılımcı ekibi (MKE personeli)
// ---------------------------------------------------------------------------

const teamSchema = z.object({
  userId: z.string().uuid().nullish(),
  fullName: z.string().trim().min(2).max(160),
  role: z.string().trim().max(120).nullish(),
  isAttending: z.boolean().default(true),
  absenceReason: z.string().trim().max(400).nullish(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

/** Aktiviteye erişimi doğrular; yoksa 404. */
async function assertActivity(user: Request['user'], id: string): Promise<void> {
  const found = await prisma.businessActivity.findFirst({
    where: { id, deletedAt: null, ...activityScope(user) },
    select: { id: true },
  });
  if (!found) throw NotFound('Aktivite bulunamadı.');
}

/** POST /api/v1/activities/:id/team */
router.post(
  '/:id/team',
  requirePermission('activity:write'),
  validate(teamSchema),
  asyncHandler(async (req, res) => {
    const activityId = String(req.params.id);
    await assertActivity(req.user, activityId);
    const body = req.body as z.infer<typeof teamSchema>;

    const member = await prisma.activityParticipant.create({
      data: {
        activityId,
        userId: body.userId ?? null,
        fullName: body.fullName,
        role: body.role ?? null,
        isAttending: body.isAttending,
        absenceReason: body.absenceReason ?? null,
        sortOrder: body.sortOrder,
      },
    });
    res.status(201).json(member);
  }),
);

/** PUT /api/v1/activities/:id/team/:memberId — katılım durumu dahil. */
router.put(
  '/:id/team/:memberId',
  requirePermission('activity:write'),
  validate(teamSchema.partial()),
  asyncHandler(async (req, res) => {
    const activityId = String(req.params.id);
    await assertActivity(req.user, activityId);

    const existing = await prisma.activityParticipant.findFirst({
      where: { id: String(req.params.memberId), activityId },
      select: { id: true },
    });
    if (!existing) throw NotFound('Katılımcı bulunamadı.');

    const body = req.body as Partial<z.infer<typeof teamSchema>>;
    const member = await prisma.activityParticipant.update({
      where: { id: existing.id },
      data: {
        ...(body.userId !== undefined ? { userId: body.userId } : {}),
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.isAttending !== undefined ? { isAttending: body.isAttending } : {}),
        ...(body.absenceReason !== undefined ? { absenceReason: body.absenceReason } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      },
    });
    res.json(member);
  }),
);

/** DELETE /api/v1/activities/:id/team/:memberId */
router.delete(
  '/:id/team/:memberId',
  requirePermission('activity:write'),
  asyncHandler(async (req, res) => {
    const activityId = String(req.params.id);
    await assertActivity(req.user, activityId);

    const existing = await prisma.activityParticipant.findFirst({
      where: { id: String(req.params.memberId), activityId },
      select: { id: true },
    });
    if (!existing) throw NotFound('Katılımcı bulunamadı.');

    await prisma.activityParticipant.delete({ where: { id: existing.id } });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Görüşülen kişiler / toplanan kartvizitler
// ---------------------------------------------------------------------------

/**
 * Var olan bir kişiyi bağla ya da yeni bir kişi açıp bağla.
 *
 * Fuarda tanışılan bir ataşenin kurumu genellikle sistemde yoktur; bu
 * yüzden `newContact` bloğu şirketsiz kişi açar (Contact.companyId null).
 */
const linkContactSchema = z.object({
  contactId: z.string().uuid().optional(),
  newContact: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    title: z.string().trim().max(120).nullish(),
    email: z.string().trim().email().max(255).nullish().or(z.literal('')),
    phone: z.string().trim().max(40).nullish(),
    contactType: z.string().trim().max(40).default('Diğer'),
    companyName: z.string().trim().max(200).nullish(),
    country: z.string().trim().max(80).optional(),
    countryCode: z.string().trim().length(2).toUpperCase().optional(),
  }).optional(),
  note: z.string().max(4000).nullish(),
  interest: z.enum(INTEREST_LEVELS).default('Ilık'),
  followedUp: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (!value.contactId && !value.newContact) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Ya mevcut bir kişi seçin ya da yeni kişi bilgisi girin.',
      path: ['contactId'],
    });
  }
});

/** Telefonu arama için sadeleştirir (boşluk/sembol atılır). */
function normalizePhone(value: string): string {
  return value.replace(/\D+/g, '');
}

/** POST /api/v1/activities/:id/contacts */
router.post(
  '/:id/contacts',
  requirePermission('activity:write'),
  validate(linkContactSchema),
  auditAction('ACTIVITY_CONTACT_LINK', 'BusinessActivity'),
  asyncHandler(async (req, res) => {
    const activityId = String(req.params.id);
    const activity = await prisma.businessActivity.findFirst({
      where: { id: activityId, deletedAt: null, ...activityScope(req.user) },
      select: { id: true, country: true, countryCode: true },
    });
    if (!activity) throw NotFound('Aktivite bulunamadı.');

    const body = req.body as z.infer<typeof linkContactSchema>;

    const link = await prisma.$transaction(async (tx) => {
      let contactId = body.contactId ?? null;

      if (!contactId && body.newContact) {
        const draft = body.newContact;
        const created = await tx.contact.create({
          data: {
            companyId: null,
            contactType: draft.contactType,
            firstName: draft.firstName,
            lastName: draft.lastName,
            title: draft.title ?? null,
            email: draft.email || null,
            // Kurum adı serbest metin olarak notlara düşer: sistemde
            // olmayan bir kurum için sahte şirket kaydı AÇILMAZ.
            notes: draft.companyName ? `Kurum: ${draft.companyName}` : null,
            // Ülke verilmediyse etkinliğin ülkesi devralınır — fuarda
            // tanışılan kişi varsayılan olarak o ülkeye bağlanır.
            country: draft.country ?? activity.country,
            countryCode: draft.countryCode ?? activity.countryCode,
            ...(draft.phone
              ? {
                phones: {
                  create: [{
                    number: draft.phone,
                    normalizedNumber: normalizePhone(draft.phone),
                    label: 'Cep',
                    isPrimary: true,
                  }],
                },
              }
              : {}),
          },
          select: { id: true },
        });
        contactId = created.id;
      }

      if (!contactId) throw BadRequest('Kişi belirlenemedi.');

      // Aynı kişi aynı etkinliğe iki kez bağlanmaz; tekrar gönderim
      // notu günceller (upsert), hata vermez.
      return tx.activityContact.upsert({
        where: { activityId_contactId: { activityId, contactId } },
        create: {
          activityId,
          contactId,
          note: body.note ?? null,
          interest: body.interest,
          followedUp: body.followedUp,
        },
        update: {
          note: body.note ?? undefined,
          interest: body.interest,
          followedUp: body.followedUp,
        },
        include: {
          contact: {
            select: {
              id: true, firstName: true, lastName: true, title: true, email: true,
              contactType: true, country: true, countryCode: true,
              company: { select: { id: true, name: true } },
            },
          },
        },
      });
    });

    req.auditContext = { entityType: 'BusinessActivity', entityId: activityId };
    res.status(201).json(link);
  }),
);

/** DELETE /api/v1/activities/:id/contacts/:linkId */
router.delete(
  '/:id/contacts/:linkId',
  requirePermission('activity:write'),
  asyncHandler(async (req, res) => {
    const activityId = String(req.params.id);
    await assertActivity(req.user, activityId);

    const existing = await prisma.activityContact.findFirst({
      where: { id: String(req.params.linkId), activityId },
      select: { id: true },
    });
    if (!existing) throw NotFound('Bağlantı bulunamadı.');

    // Bağlantı silinir, KİŞİ SİLİNMEZ: kartvizit sisteme girdikten sonra
    // fuar kaydından kopması kişiyi yok saymayı gerektirmez.
    await prisma.activityContact.delete({ where: { id: existing.id } });
    res.json({ success: true });
  }),
);

export default router;
