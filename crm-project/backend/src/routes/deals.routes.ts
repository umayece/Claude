import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { buildOrderBy, paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, assertCompanyAccess, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { auditAction } from '../middleware/audit';
import { logActivity } from '../services/activity.service';
import { resolveExchangeRate, SUPPORTED_CURRENCIES, toTry } from '../services/currency.service';
import { calculateWinProbability, LOSS_REASONS } from '../services/scoring.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

export const DEAL_STAGES = [
  'Potansiyel',
  'İletişime Geçildi',
  'Teklif Hazırlanıyor',
  'Teklif Verildi',
  'Müzakere',
  'Kazanıldı',
  'Kaybedildi',
] as const;

const dealBodySchema = z.object({
  title: z.string().trim().min(2).max(200),
  companyId: z.string().uuid(),
  contactId: z.string().uuid().nullish(),
  ownerId: z.string().uuid().nullish(),
  stage: z.enum(DEAL_STAGES).default('Potansiyel'),
  amount: z.number().min(0).max(1e15).default(0),
  currency: z.enum(SUPPORTED_CURRENCIES).default('TRY'),
  expectedCloseDate: z.coerce.date().nullish(),
  description: z.string().max(5000).nullish(),
  lossReason: z.enum(LOSS_REASONS).nullish(),
  lossDetail: z.string().max(2000).nullish(),
  customFields: z.record(z.unknown()).nullish(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  stage: z.enum(DEAL_STAGES).optional(),
  companyId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  /// Konum şirket üzerinde tutulur; kapsam ilişki üzerinden süzülür.
  scope: z.enum(['domestic', 'international']).optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  sort: z.string().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const dealInclude = {
  company: { select: { id: true, name: true, type: true, country: true, countryCode: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.DealInclude;

/** Skor girdilerini toplayıp deterministik olasılığı hesaplar. */
async function computeScore(dealId: string): Promise<number> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: {
      companyId: true, stage: true, amount: true, exchangeRate: true,
      expectedCloseDate: true, contactId: true,
    },
  });

  const [won, lost, recentActivity, offerCount] = await prisma.$transaction([
    prisma.deal.count({ where: { companyId: deal.companyId, stage: 'Kazanıldı', deletedAt: null } }),
    prisma.deal.count({ where: { companyId: deal.companyId, stage: 'Kaybedildi', deletedAt: null } }),
    prisma.activity.count({
      where: { dealId, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
    }),
    prisma.offer.count({ where: { dealId, deletedAt: null } }),
  ]);

  return calculateWinProbability({
    stage: deal.stage,
    daysToClose: deal.expectedCloseDate
      ? Math.ceil((deal.expectedCloseDate.getTime() - Date.now()) / 86_400_000)
      : null,
    wonDealCount: won,
    lostDealCount: lost,
    recentActivityCount: recentActivity,
    amountTry: toTry(deal.amount, deal.exchangeRate),
    hasOffer: offerCount > 0,
    hasContact: Boolean(deal.contactId),
  });
}

/** GET /api/v1/deals */
router.get(
  '/',
  requirePermission('deal:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const orderBy = buildOrderBy(
      query.sort,
      ['createdAt', 'amount', 'expectedCloseDate', 'title'] as const,
      'createdAt',
    );

    const and: Prisma.DealWhereInput[] = [{ deletedAt: null }, { company: companyScope(req.user) }];
    if (query.stage) and.push({ stage: query.stage });
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.ownerId) and.push({ ownerId: query.ownerId });
    if (query.countryCode) and.push({ company: { countryCode: query.countryCode } });
    if (query.scope === 'domestic') and.push({ company: { countryCode: 'TR' } });
    if (query.scope === 'international') and.push({ company: { countryCode: { not: 'TR' } } });
    if (query.q) and.push({ title: { contains: query.q, mode: 'insensitive' } });
    if (query.from || query.to) {
      and.push({ createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } });
    }

    const where: Prisma.DealWhereInput = { AND: and };
    const [rows, total, aggregate] = await prisma.$transaction([
      prisma.deal.findMany({
        where, include: dealInclude,
        orderBy,
        skip: page.skip, take: page.take,
      }),
      prisma.deal.count({ where }),
      prisma.deal.aggregate({ where, _sum: { amount: true } }),
    ]);

    res.json({
      ...paginated(rows.map((d) => ({ ...d, amountTry: toTry(d.amount, d.exchangeRate) })), total, page),
      summary: { rawAmountSum: aggregate._sum.amount ?? 0 },
    });
  }),
);

/** GET /api/v1/deals/pipeline — huni verisi (aşama bazlı toplam ve adet). */
router.get(
  '/pipeline',
  requirePermission('deal:read'),
  asyncHandler(async (req, res) => {
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const where: Prisma.DealWhereInput = {
      AND: [
        { deletedAt: null },
        { company: companyScope(req.user) },
        ...(from || to ? [{ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }] : []),
      ],
    };

    // Aşama toplamları TL bazında olmalı; kur kayıt üstünde donmuş olduğu için
    // gruplamayı bellekte, dondurulmuş kurla yapıyoruz.
    const rows = await prisma.deal.findMany({
      where,
      select: { stage: true, amount: true, exchangeRate: true },
    });

    const buckets = DEAL_STAGES.map((stage) => {
      const items = rows.filter((r) => r.stage === stage);
      return {
        stage,
        count: items.length,
        totalTry: Math.round(items.reduce((s, r) => s + toTry(r.amount, r.exchangeRate), 0) * 100) / 100,
      };
    });

    // Dönüşüm oranı: bir sonraki aşamaya geçen kayıt yüzdesi.
    const withConversion = buckets.map((bucket, index) => {
      const previous = buckets[index - 1];
      return {
        ...bucket,
        conversionRate:
          previous && previous.count > 0
            ? Math.round((bucket.count / previous.count) * 1000) / 10
            : null,
      };
    });

    const lossRows = await prisma.deal.groupBy({
      by: ['lossReason'],
      where: { ...where, stage: 'Kaybedildi', lossReason: { not: null } },
      _count: { _all: true },
    });

    res.json({
      stages: withConversion,
      lossReasons: lossRows.map((r) => ({ reason: r.lossReason, count: r._count._all })),
    });
  }),
);

/** GET /api/v1/deals/:id */
router.get(
  '/:id',
  requirePermission('deal:read'),
  asyncHandler(async (req, res) => {
    const deal = await prisma.deal.findFirst({
      where: { id: req.params.id, deletedAt: null, company: companyScope(req.user) },
      include: {
        ...dealInclude,
        offers: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        tasks: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      },
    });
    if (!deal) throw NotFound('Fırsat bulunamadı.');
    res.json({ ...deal, amountTry: toTry(deal.amount, deal.exchangeRate) });
  }),
);

/** POST /api/v1/deals */
router.post(
  '/',
  requirePermission('deal:write'),
  validate(dealBodySchema),
  auditAction('DEAL_CREATE', 'Deal'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof dealBodySchema>;
    await assertCompanyAccess(req.user, body.companyId);

    const created = await prisma.deal.create({
      data: {
        title: body.title,
        companyId: body.companyId,
        contactId: body.contactId ?? null,
        ownerId: body.ownerId ?? req.user!.id,
        stage: body.stage,
        amount: body.amount,
        currency: body.currency,
        // Kur kayıt anında dondurulur; sonraki kur hareketleri geçmişi bozmaz.
        exchangeRate: await resolveExchangeRate(body.currency),
        expectedCloseDate: body.expectedCloseDate ?? null,
        description: body.description ?? null,
        customFields: (body.customFields ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const deal = await prisma.deal.update({
      where: { id: created.id },
      data: { winProbabilityScore: await computeScore(created.id) },
      include: dealInclude,
    });

    req.auditContext = { entityType: 'Deal', entityId: deal.id };
    await logActivity({
      type: 'SYSTEM', title: `Fırsat oluşturuldu: ${deal.title}`,
      companyId: deal.companyId, dealId: deal.id, contactId: deal.contactId, userId: req.user!.id,
    });

    res.status(201).json({ ...deal, amountTry: toTry(deal.amount, deal.exchangeRate) });
  }),
);

/** PUT /api/v1/deals/:id */
router.put(
  '/:id',
  requirePermission('deal:write'),
  validate(dealBodySchema.partial()),
  auditAction('DEAL_UPDATE', 'Deal'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.deal.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
    });
    if (!existing) throw NotFound('Fırsat bulunamadı.');

    const body = req.body as Partial<z.infer<typeof dealBodySchema>>;
    if (body.companyId && body.companyId !== existing.companyId) {
      await assertCompanyAccess(req.user, body.companyId);
    }

    // Para birimi değiştiyse kur yeniden çözülür; aksi halde donmuş kur korunur.
    const exchangeRate =
      body.currency && body.currency !== existing.currency
        ? await resolveExchangeRate(body.currency)
        : existing.exchangeRate;

    await prisma.deal.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
        ...(body.stage !== undefined ? { stage: body.stage } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.currency !== undefined ? { currency: body.currency, exchangeRate } : {}),
        ...(body.expectedCloseDate !== undefined ? { expectedCloseDate: body.expectedCloseDate } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.lossReason !== undefined ? { lossReason: body.lossReason } : {}),
        ...(body.lossDetail !== undefined ? { lossDetail: body.lossDetail } : {}),
        ...(body.customFields !== undefined
          ? { customFields: (body.customFields ?? Prisma.DbNull) as Prisma.InputJsonValue }
          : {}),
        ...(body.stage === 'Kazanıldı' || body.stage === 'Kaybedildi' ? { closedAt: new Date() } : {}),
      },
    });

    const deal = await prisma.deal.update({
      where: { id },
      data: { winProbabilityScore: await computeScore(id) },
      include: dealInclude,
    });

    if (body.stage && body.stage !== existing.stage) {
      await logActivity({
        type: 'STAGE_CHANGE',
        title: `${deal.title}: ${existing.stage} → ${body.stage}`,
        companyId: deal.companyId, dealId: id, userId: req.user!.id,
        metadata: { from: existing.stage, to: body.stage },
      });
    }

    res.json({ ...deal, amountTry: toTry(deal.amount, deal.exchangeRate) });
  }),
);

const stageSchema = z.object({
  stage: z.enum(DEAL_STAGES),
  lossReason: z.enum(LOSS_REASONS).nullish(),
  lossDetail: z.string().max(2000).nullish(),
});

/** PUT /api/v1/deals/:id/stage — süreç çubuğu. */
router.put(
  '/:id/stage',
  requirePermission('deal:write'),
  validate(stageSchema),
  auditAction('DEAL_STAGE_CHANGE', 'Deal'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.deal.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
      select: { id: true, stage: true, title: true, companyId: true },
    });
    if (!existing) throw NotFound('Fırsat bulunamadı.');

    const body = req.body as z.infer<typeof stageSchema>;
    await prisma.deal.update({
      where: { id },
      data: {
        stage: body.stage,
        lossReason: body.stage === 'Kaybedildi' ? body.lossReason ?? null : null,
        lossDetail: body.stage === 'Kaybedildi' ? body.lossDetail ?? null : null,
        closedAt: body.stage === 'Kazanıldı' || body.stage === 'Kaybedildi' ? new Date() : null,
      },
    });

    const deal = await prisma.deal.update({
      where: { id },
      data: { winProbabilityScore: await computeScore(id) },
      include: dealInclude,
    });

    await logActivity({
      type: 'STAGE_CHANGE',
      title: `${existing.title}: ${existing.stage} → ${body.stage}`,
      companyId: existing.companyId, dealId: id, userId: req.user!.id,
      metadata: { from: existing.stage, to: body.stage, lossReason: body.lossReason ?? null },
    });

    res.json({ ...deal, amountTry: toTry(deal.amount, deal.exchangeRate) });
  }),
);

/** DELETE /api/v1/deals/:id */
router.delete(
  '/:id',
  requirePermission('deal:delete'),
  auditAction('DEAL_DELETE', 'Deal'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.deal.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
      select: { id: true },
    });
    if (!existing) throw NotFound('Fırsat bulunamadı.');
    await prisma.deal.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  }),
);

export default router;
