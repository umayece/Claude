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
import { nextSequence } from '../services/sequence.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

export const TENDER_STAGES = [
  'Takipte',
  'Şartname Alındı',
  'Teklif Hazırlanıyor',
  'Teklif Verildi',
  'Değerlendirmede',
  'Kazanıldı',
  'Kaybedildi',
  'İptal',
] as const;

const tenderBodySchema = z.object({
  title: z.string().trim().min(2).max(300),
  companyId: z.string().uuid(),
  tenderNumber: z.string().trim().max(60).optional(),
  status: z.enum(TENDER_STAGES).default('Takipte'),
  method: z.string().trim().max(120).nullish(),
  currency: z.enum(SUPPORTED_CURRENCIES).default('TRY'),
  estimatedValue: z.number().min(0).max(1e15).default(0),
  submissionDeadline: z.coerce.date().nullish(),
  announcementDate: z.coerce.date().nullish(),
  description: z.string().max(10_000).nullish(),
  specificationText: z.string().max(500_000).nullish(),
  lossReason: z.enum(LOSS_REASONS).nullish(),
  lossDetail: z.string().max(2000).nullish(),
  customFields: z.record(z.unknown()).nullish(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(TENDER_STAGES).optional(),
  companyId: z.string().uuid().optional(),
  sort: z.string().max(40).optional(),
  /** Son teslim tarihi bu kadar gün içinde olanlar. */
  dueWithinDays: z.coerce.number().int().min(1).max(365).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const tenderInclude = {
  company: { select: { id: true, name: true, type: true } },
  _count: { select: { contracts: true, tasks: true } },
} satisfies Prisma.TenderInclude;

async function computeTenderScore(tenderId: string): Promise<number> {
  const tender = await prisma.tender.findUniqueOrThrow({
    where: { id: tenderId },
    select: {
      companyId: true, status: true, estimatedValue: true, exchangeRate: true,
      submissionDeadline: true, specificationText: true,
    },
  });

  const [won, lost, activityCount] = await prisma.$transaction([
    prisma.tender.count({ where: { companyId: tender.companyId, status: 'Kazanıldı', deletedAt: null } }),
    prisma.tender.count({ where: { companyId: tender.companyId, status: 'Kaybedildi', deletedAt: null } }),
    prisma.activity.count({
      where: { tenderId, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
    }),
  ]);

  return calculateWinProbability({
    stage: tender.status === 'Değerlendirmede' ? 'Müzakere' : tender.status,
    daysToClose: tender.submissionDeadline
      ? Math.ceil((tender.submissionDeadline.getTime() - Date.now()) / 86_400_000)
      : null,
    wonDealCount: won,
    lostDealCount: lost,
    recentActivityCount: activityCount,
    amountTry: toTry(tender.estimatedValue, tender.exchangeRate),
    // Şartname yüklenmiş olması sürecin ciddiyetinin göstergesidir.
    hasOffer: Boolean(tender.specificationText),
    hasContact: true,
  });
}

/** GET /api/v1/tenders */
router.get(
  '/',
  requirePermission('tender:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const orderBy = buildOrderBy(
      query.sort,
      ['createdAt', 'submissionDeadline', 'estimatedValue', 'title'] as const,
      'submissionDeadline',
    );

    const and: Prisma.TenderWhereInput[] = [{ deletedAt: null }, { company: companyScope(req.user) }];
    if (query.status) and.push({ status: query.status });
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { tenderNumber: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.dueWithinDays) {
      and.push({
        submissionDeadline: {
          gte: new Date(),
          lte: new Date(Date.now() + query.dueWithinDays * 86_400_000),
        },
      });
    }

    const where: Prisma.TenderWhereInput = { AND: and };
    const [rows, total] = await prisma.$transaction([
      prisma.tender.findMany({
        where, include: tenderInclude,
        orderBy,
        skip: page.skip, take: page.take,
      }),
      prisma.tender.count({ where }),
    ]);

    res.json(
      paginated(
        rows.map((t) => ({
          ...t,
          // Liste yanıtında tam şartname taşınmaz; yalnızca varlığı bildirilir.
          specificationText: undefined,
          hasSpecification: Boolean(t.specificationText),
          estimatedValueTry: toTry(t.estimatedValue, t.exchangeRate),
          daysUntilDeadline: t.submissionDeadline
            ? Math.ceil((t.submissionDeadline.getTime() - Date.now()) / 86_400_000)
            : null,
        })),
        total,
        page,
      ),
    );
  }),
);

/** GET /api/v1/tenders/:id */
router.get(
  '/:id',
  requirePermission('tender:read'),
  asyncHandler(async (req, res) => {
    const tender = await prisma.tender.findFirst({
      where: { id: req.params.id, deletedAt: null, company: companyScope(req.user) },
      include: {
        ...tenderInclude,
        contracts: { where: { deletedAt: null } },
        tasks: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      },
    });
    if (!tender) throw NotFound('İhale bulunamadı.');
    res.json({ ...tender, estimatedValueTry: toTry(tender.estimatedValue, tender.exchangeRate) });
  }),
);

/** POST /api/v1/tenders */
router.post(
  '/',
  requirePermission('tender:write'),
  validate(tenderBodySchema),
  auditAction('TENDER_CREATE', 'Tender'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof tenderBodySchema>;
    await assertCompanyAccess(req.user, body.companyId);

    const created = await prisma.tender.create({
      data: {
        tenderNumber: body.tenderNumber || (await nextSequence('IHL')),
        title: body.title,
        companyId: body.companyId,
        status: body.status,
        method: body.method ?? null,
        currency: body.currency,
        exchangeRate: await resolveExchangeRate(body.currency),
        estimatedValue: body.estimatedValue,
        submissionDeadline: body.submissionDeadline ?? null,
        announcementDate: body.announcementDate ?? null,
        description: body.description ?? null,
        specificationText: body.specificationText ?? null,
        customFields: (body.customFields ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const tender = await prisma.tender.update({
      where: { id: created.id },
      data: { winProbabilityScore: await computeTenderScore(created.id) },
      include: tenderInclude,
    });

    req.auditContext = { entityType: 'Tender', entityId: tender.id };
    await logActivity({
      type: 'SYSTEM', title: `İhale kaydedildi: ${tender.tenderNumber}`,
      companyId: tender.companyId, tenderId: tender.id, userId: req.user!.id,
    });

    res.status(201).json(tender);
  }),
);

/** PUT /api/v1/tenders/:id */
router.put(
  '/:id',
  requirePermission('tender:write'),
  validate(tenderBodySchema.partial()),
  auditAction('TENDER_UPDATE', 'Tender'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.tender.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
    });
    if (!existing) throw NotFound('İhale bulunamadı.');

    const body = req.body as Partial<z.infer<typeof tenderBodySchema>>;
    if (body.companyId && body.companyId !== existing.companyId) {
      await assertCompanyAccess(req.user, body.companyId);
    }

    const exchangeRate =
      body.currency && body.currency !== existing.currency
        ? await resolveExchangeRate(body.currency)
        : existing.exchangeRate;

    await prisma.tender.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.tenderNumber !== undefined ? { tenderNumber: body.tenderNumber } : {}),
        ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.method !== undefined ? { method: body.method } : {}),
        ...(body.currency !== undefined ? { currency: body.currency, exchangeRate } : {}),
        ...(body.estimatedValue !== undefined ? { estimatedValue: body.estimatedValue } : {}),
        ...(body.submissionDeadline !== undefined ? { submissionDeadline: body.submissionDeadline } : {}),
        ...(body.announcementDate !== undefined ? { announcementDate: body.announcementDate } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.specificationText !== undefined ? { specificationText: body.specificationText } : {}),
        ...(body.lossReason !== undefined ? { lossReason: body.lossReason } : {}),
        ...(body.lossDetail !== undefined ? { lossDetail: body.lossDetail } : {}),
        ...(body.customFields !== undefined
          ? { customFields: (body.customFields ?? Prisma.DbNull) as Prisma.InputJsonValue }
          : {}),
      },
    });

    const tender = await prisma.tender.update({
      where: { id },
      data: { winProbabilityScore: await computeTenderScore(id) },
      include: tenderInclude,
    });

    if (body.status && body.status !== existing.status) {
      await logActivity({
        type: 'STAGE_CHANGE',
        title: `${tender.tenderNumber}: ${existing.status} → ${body.status}`,
        companyId: tender.companyId, tenderId: id, userId: req.user!.id,
        metadata: { from: existing.status, to: body.status },
      });
    }

    res.json(tender);
  }),
);

const stageSchema = z.object({
  status: z.enum(TENDER_STAGES),
  lossReason: z.enum(LOSS_REASONS).nullish(),
  lossDetail: z.string().max(2000).nullish(),
});

/** PUT /api/v1/tenders/:id/stage */
router.put(
  '/:id/stage',
  requirePermission('tender:write'),
  validate(stageSchema),
  auditAction('TENDER_STAGE_CHANGE', 'Tender'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.tender.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
      select: { id: true, status: true, tenderNumber: true, companyId: true },
    });
    if (!existing) throw NotFound('İhale bulunamadı.');

    const body = req.body as z.infer<typeof stageSchema>;
    const isLost = body.status === 'Kaybedildi' || body.status === 'İptal';

    await prisma.tender.update({
      where: { id },
      data: {
        status: body.status,
        lossReason: isLost ? body.lossReason ?? null : null,
        lossDetail: isLost ? body.lossDetail ?? null : null,
      },
    });

    const tender = await prisma.tender.update({
      where: { id },
      data: { winProbabilityScore: await computeTenderScore(id) },
      include: tenderInclude,
    });

    await logActivity({
      type: 'STAGE_CHANGE',
      title: `${existing.tenderNumber}: ${existing.status} → ${body.status}`,
      companyId: existing.companyId, tenderId: id, userId: req.user!.id,
      metadata: { from: existing.status, to: body.status },
    });

    res.json(tender);
  }),
);

/** DELETE /api/v1/tenders/:id */
router.delete(
  '/:id',
  requirePermission('tender:delete'),
  auditAction('TENDER_DELETE', 'Tender'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.tender.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
      select: { id: true },
    });
    if (!existing) throw NotFound('İhale bulunamadı.');
    await prisma.tender.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  }),
);

export default router;
