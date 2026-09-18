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
import {
  dualValue, getRateMap, shouldFreezeRate, SUPPORTED_CURRENCIES, type RateMap,
} from '../services/currency.service';
import { nextSequence } from '../services/sequence.service';
import { deliveryInfo } from '../services/delivery.service';

/** Zaman tüneli notu için kısa tarih; boşsa "—". */
function formatDate(value: Date | null): string {
  return value ? value.toLocaleDateString('tr-TR') : '—';
}

const router = Router();
router.use(authenticate, requireMfaComplete);

export const CONTRACT_STATUSES = ['Taslak', 'Aktif', 'Askıda', 'Tamamlandı', 'Feshedildi'] as const;
export const MILESTONE_STATUSES = ['Bekliyor', 'Faturalandı', 'Tahsil Edildi', 'Gecikti'] as const;

const contractBodySchema = z.object({
  title: z.string().trim().min(2).max(300),
  companyId: z.string().uuid(),
  contractNumber: z.string().trim().max(60).optional(),
  offerId: z.string().uuid().nullish(),
  tenderId: z.string().uuid().nullish(),
  status: z.enum(CONTRACT_STATUSES).default('Aktif'),
  amount: z.number().min(0).max(1e15).default(0),
  currency: z.enum(SUPPORTED_CURRENCIES).default('USD'),
  startDate: z.coerce.date().nullish(),
  endDate: z.coerce.date().nullish(),
  renewalDate: z.coerce.date().nullish(),
  description: z.string().max(10_000).nullish(),
  terms: z.string().max(50_000).nullish(),

  // --- Termin (teslimat) ---
  deliveryDate: z.coerce.date().nullish(),
  deliveryNote: z.string().max(2000).nullish(),
  deliveredAt: z.coerce.date().nullish(),

  // --- Gerçekleşen maliyet ---
  cogs: z.number().min(0).max(1e15).nullish(),
  cogsCurrency: z.enum(SUPPORTED_CURRENCIES).default('USD'),
  cogsNote: z.string().max(2000).nullish(),
});

const milestoneBodySchema = z.object({
  title: z.string().trim().min(2).max(200),
  amount: z.number().min(0).max(1e15),
  currency: z.enum(SUPPORTED_CURRENCIES).default('TRY'),
  dueDate: z.coerce.date(),
  status: z.enum(MILESTONE_STATUSES).default('Bekliyor'),
  invoiceNumber: z.string().trim().max(60).nullish(),
  paidAt: z.coerce.date().nullish(),
  note: z.string().max(2000).nullish(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  companyId: z.string().uuid().optional(),
  sort: z.string().max(40).optional(),
  /** Yenileme tarihi bu kadar gün içinde olanlar. */
  renewalWithinDays: z.coerce.number().int().min(1).max(365).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const contractInclude = {
  company: { select: { id: true, name: true, type: true } },
  offer: { select: { id: true, offerNumber: true, title: true, total: true, currency: true } },
  tender: { select: { id: true, tenderNumber: true, title: true } },
  _count: { select: { milestones: true } },
} satisfies Prisma.ContractInclude;

/** Vadesi geçmiş, henüz tahsil edilmemiş hakedişleri "Gecikti" olarak işaretler. */
function decorateMilestone(
  m: {
    status: string; dueDate: Date; paidAt: Date | null;
    amount: number; currency: string; exchangeRateAtCreation: number | null;
  },
  rates: RateMap,
) {
  const overdue = m.status !== 'Tahsil Edildi' && m.paidAt === null && m.dueDate < new Date();
  return {
    ...m,
    effectiveStatus: overdue ? 'Gecikti' : m.status,
    isOverdue: overdue,
    daysOverdue: overdue ? Math.floor((Date.now() - m.dueDate.getTime()) / 86_400_000) : 0,
    ...dualValue(m.amount, m.currency, m.exchangeRateAtCreation, rates),
  };
}

/** GET /api/v1/contracts */
router.get(
  '/',
  requirePermission('contract:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const orderBy = buildOrderBy(
      query.sort,
      ['createdAt', 'startDate', 'endDate', 'amount', 'title'] as const,
      'createdAt',
    );

    const and: Prisma.ContractWhereInput[] = [{ deletedAt: null }, { company: companyScope(req.user) }];
    if (query.status) and.push({ status: query.status });
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { contractNumber: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.renewalWithinDays) {
      and.push({
        renewalDate: {
          gte: new Date(),
          lte: new Date(Date.now() + query.renewalWithinDays * 86_400_000),
        },
      });
    }

    const where: Prisma.ContractWhereInput = { AND: and };
    const rates = await getRateMap();
    const [rows, total] = await prisma.$transaction([
      prisma.contract.findMany({
        where, include: contractInclude,
        orderBy,
        skip: page.skip, take: page.take,
      }),
      prisma.contract.count({ where }),
    ]);

    res.json(
      paginated(
        rows.map((contract) => ({
          ...contract,
          ...dualValue(contract.amount, contract.currency, contract.exchangeRateAtCreation, rates),
          delivery: deliveryInfo({
            deliveryDate: contract.deliveryDate,
            originalDeliveryDate: contract.originalDeliveryDate,
            deliveredAt: contract.deliveredAt,
          }),
        })),
        total,
        page,
      ),
    );
  }),
);

/** GET /api/v1/contracts/:id — detay + hakedişler. */
router.get(
  '/:id',
  requirePermission('contract:read'),
  asyncHandler(async (req, res) => {
    const contract = await prisma.contract.findFirst({
      where: { id: req.params.id, deletedAt: null, company: companyScope(req.user) },
      include: {
        ...contractInclude,
        offer: {
          include: {
            items: {
              orderBy: { sortOrder: 'asc' },
              // Sipariş açıldığında ilgili ürünün ANLIK fabrika/depo stoğu
              // görünmeli: taahhüt edilen adet stokta var mı?
              include: {
                product: {
                  select: {
                    id: true, sku: true, name: true, unit: true,
                    stockQuantity: true, minStockLevel: true,
                  },
                },
              },
            },
          },
        },
        milestones: { orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }] },
      },
    });
    if (!contract) throw NotFound('Sözleşme bulunamadı.');

    const rates = await getRateMap();
    const milestones = contract.milestones.map((m) => decorateMilestone(m, rates));
    const collectedTry = milestones
      .filter((m) => m.effectiveStatus === 'Tahsil Edildi')
      .reduce((sum, m) => sum + m.amountTry, 0);
    const pendingTry = milestones
      .filter((m) => m.effectiveStatus !== 'Tahsil Edildi')
      .reduce((sum, m) => sum + m.amountTry, 0);

    // Sipariş kalemleri: taahhüt edilen adet ile depodaki adet yan yana.
    const stockLines = (contract.offer?.items ?? [])
      .filter((item) => item.product !== null)
      .map((item) => {
        const product = item.product!;
        const shortage = Math.max(0, item.quantity - product.stockQuantity);
        return {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: item.unit || product.unit,
          orderedQuantity: item.quantity,
          stockQuantity: product.stockQuantity,
          minStockLevel: product.minStockLevel,
          shortage,
          // Üretim/tedarik gerekiyor mu?
          isSufficient: shortage === 0,
        };
      });

    res.json({
      ...contract,
      milestones,
      delivery: deliveryInfo({
        deliveryDate: contract.deliveryDate,
        originalDeliveryDate: contract.originalDeliveryDate,
        deliveredAt: contract.deliveredAt,
      }),
      stockLines,
      // İmza tarihindeki değer ile güncel piyasa değeri birlikte döner.
      ...dualValue(contract.amount, contract.currency, contract.exchangeRateAtCreation, rates),
      milestoneSummary: {
        total: milestones.length,
        collectedTry: Math.round(collectedTry * 100) / 100,
        pendingTry: Math.round(pendingTry * 100) / 100,
        overdueCount: milestones.filter((m) => m.isOverdue).length,
      },
    });
  }),
);

/** POST /api/v1/contracts */
router.post(
  '/',
  requirePermission('contract:write'),
  validate(contractBodySchema),
  auditAction('CONTRACT_CREATE', 'Contract'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof contractBodySchema>;
    await assertCompanyAccess(req.user, body.companyId);

    const contract = await prisma.contract.create({
      data: {
        contractNumber: body.contractNumber || (await nextSequence('SZL')),
        title: body.title,
        companyId: body.companyId,
        offerId: body.offerId ?? null,
        tenderId: body.tenderId ?? null,
        status: body.status,
        amount: body.amount,
        currency: body.currency,
        // Taslak olmayan sözleşmede imza tarihi kuru dondurulur.
        exchangeRateAtCreation: shouldFreezeRate('contract', body.status)
          ? (await getRateMap())[body.currency] ?? 1
          : null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        renewalDate: body.renewalDate ?? null,
        description: body.description ?? null,
        terms: body.terms ?? null,
        deliveryDate: body.deliveryDate ?? null,
        // İlk taahhüt saklanır: gecikme ölçümü revize tarihe göre değil
        // ORİJİNAL termine göre yapılmalı, aksi halde her revizyon
        // gecikmeyi sıfırlar ve tedarik performansı ölçülemez hâle gelir.
        originalDeliveryDate: body.deliveryDate ?? null,
        deliveryNote: body.deliveryNote ?? null,
        deliveredAt: body.deliveredAt ?? null,
        cogs: body.cogs ?? null,
        cogsCurrency: body.cogsCurrency,
        cogsNote: body.cogsNote ?? null,
      },
      include: contractInclude,
    });

    req.auditContext = { entityType: 'Contract', entityId: contract.id };
    await logActivity({
      type: 'SYSTEM', title: `Sözleşme oluşturuldu: ${contract.contractNumber}`,
      companyId: contract.companyId, contractId: contract.id, userId: req.user!.id,
    });

    res.status(201).json(contract);
  }),
);

/** PUT /api/v1/contracts/:id */
router.put(
  '/:id',
  requirePermission('contract:write'),
  validate(contractBodySchema.partial()),
  auditAction('CONTRACT_UPDATE', 'Contract'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.contract.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
    });
    if (!existing) throw NotFound('Sözleşme bulunamadı.');

    const body = req.body as Partial<z.infer<typeof contractBodySchema>>;
    if (body.companyId && body.companyId !== existing.companyId) {
      await assertCompanyAccess(req.user, body.companyId);
    }

    // Termin gerçekten değişti mi? Aynı tarihin tekrar gönderilmesi
    // revizyon sayılmaz, aksi halde her kayıtta sahte bir revizyon oluşur.
    const deliveryChanged = body.deliveryDate !== undefined
      && (existing.deliveryDate?.getTime() ?? null) !== (body.deliveryDate?.getTime() ?? null);

    // Sözleşme taslaktan çıktığında o anki kur imza kuru olarak dondurulur.
    const nextStatus = body.status ?? existing.status;
    const nextCurrency = body.currency ?? existing.currency;
    const exchangeRateAtCreation = shouldFreezeRate('contract', nextStatus)
      ? existing.exchangeRateAtCreation ?? (await getRateMap())[nextCurrency as never] ?? 1
      : null;

    const contract = await prisma.contract.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.contractNumber !== undefined ? { contractNumber: body.contractNumber } : {}),
        ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        ...(body.offerId !== undefined ? { offerId: body.offerId } : {}),
        ...(body.tenderId !== undefined ? { tenderId: body.tenderId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        exchangeRateAtCreation,
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
        ...(body.renewalDate !== undefined ? { renewalDate: body.renewalDate } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.terms !== undefined ? { terms: body.terms } : {}),
        ...(body.deliveryDate !== undefined
          ? {
            deliveryDate: body.deliveryDate,
            // İlk kez termin giriliyorsa aynı tarih orijinal taahhüt olur.
            ...(existing.originalDeliveryDate === null
              ? { originalDeliveryDate: body.deliveryDate }
              : {}),
            // Gerçekten değiştiyse revizyon damgası vurulur.
            ...(deliveryChanged ? { deliveryRevisedAt: new Date() } : {}),
          }
          : {}),
        ...(body.deliveryNote !== undefined ? { deliveryNote: body.deliveryNote } : {}),
        ...(body.deliveredAt !== undefined ? { deliveredAt: body.deliveredAt } : {}),
        ...(body.cogs !== undefined ? { cogs: body.cogs } : {}),
        ...(body.cogsCurrency !== undefined ? { cogsCurrency: body.cogsCurrency } : {}),
        ...(body.cogsNote !== undefined ? { cogsNote: body.cogsNote } : {}),
      },
      include: contractInclude,
    });

    // Termin revizyonu zaman tüneline düşer: kimin ne zaman hangi tarihe
    // çektiği kayıt altında olmalı.
    if (deliveryChanged) {
      await logActivity({
        type: 'SYSTEM',
        title: `Termin tarihi revize edildi: ${contract.contractNumber}`,
        body: `${formatDate(existing.deliveryDate)} → ${formatDate(contract.deliveryDate)}`
          + (body.deliveryNote ? ` — ${body.deliveryNote}` : ''),
        companyId: contract.companyId, contractId: contract.id, userId: req.user!.id,
      });
    }

    res.json(contract);
  }),
);

/** DELETE /api/v1/contracts/:id */
router.delete(
  '/:id',
  requirePermission('contract:delete'),
  auditAction('CONTRACT_DELETE', 'Contract'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.contract.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
      select: { id: true, contractNumber: true, companyId: true },
    });
    if (!existing) throw NotFound('Sözleşme bulunamadı.');

    await prisma.contract.update({ where: { id }, data: { deletedAt: new Date() } });
    await logActivity({
      type: 'SYSTEM', title: `Sözleşme silindi: ${existing.contractNumber}`,
      companyId: existing.companyId, userId: req.user!.id,
    });

    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Hakediş / ödeme kilometre taşları
// ---------------------------------------------------------------------------

async function assertContractAccess(user: Express.Request['user'], contractId: string) {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null, company: companyScope(user) },
    select: {
      id: true, companyId: true, contractNumber: true,
      status: true, exchangeRateAtCreation: true,
    },
  });
  if (!contract) throw NotFound('Sözleşme bulunamadı.');
  return contract;
}

/** GET /api/v1/contracts/:id/milestones */
router.get(
  '/:id/milestones',
  requirePermission('contract:read'),
  asyncHandler(async (req, res) => {
    await assertContractAccess(req.user, String(req.params.id));
    const rows = await prisma.paymentMilestone.findMany({
      where: { contractId: String(req.params.id) },
      orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }],
    });
    const rates = await getRateMap();
    res.json({ data: rows.map((m) => decorateMilestone(m, rates)) });
  }),
);

/** POST /api/v1/contracts/:id/milestones */
router.post(
  '/:id/milestones',
  requirePermission('contract:write'),
  validate(milestoneBodySchema),
  auditAction('MILESTONE_CREATE', 'PaymentMilestone'),
  asyncHandler(async (req, res) => {
    const contract = await assertContractAccess(req.user, String(req.params.id));
    const body = req.body as z.infer<typeof milestoneBodySchema>;

    const milestone = await prisma.paymentMilestone.create({
      data: {
        contractId: contract.id,
        title: body.title,
        amount: body.amount,
        currency: body.currency,
        // Hakediş, bağlı olduğu sözleşmenin kur mantığını izler: sözleşme
        // imzalanmışsa o anki kur dondurulur, taslaksa piyasayı izler.
        exchangeRateAtCreation: shouldFreezeRate('contract', contract.status)
          ? (await getRateMap())[body.currency] ?? 1
          : null,
        dueDate: body.dueDate,
        status: body.status,
        invoiceNumber: body.invoiceNumber ?? null,
        paidAt: body.paidAt ?? null,
        note: body.note ?? null,
        sortOrder: body.sortOrder,
      },
    });

    req.auditContext = { entityType: 'PaymentMilestone', entityId: milestone.id };
    res.status(201).json(decorateMilestone(milestone, await getRateMap()));
  }),
);

/** PUT /api/v1/contracts/:id/milestones/:milestoneId */
router.put(
  '/:id/milestones/:milestoneId',
  requirePermission('contract:write'),
  validate(milestoneBodySchema.partial()),
  auditAction('MILESTONE_UPDATE', 'PaymentMilestone'),
  asyncHandler(async (req, res) => {
    const contract = await assertContractAccess(req.user, String(req.params.id));
    const milestoneId = String(req.params.milestoneId);

    const existing = await prisma.paymentMilestone.findFirst({
      where: { id: milestoneId, contractId: contract.id },
    });
    if (!existing) throw NotFound('Hakediş kaydı bulunamadı.');

    const body = req.body as Partial<z.infer<typeof milestoneBodySchema>>;
    const rates = await getRateMap();
    const nextCurrency = body.currency ?? existing.currency;
    const milestoneRate = shouldFreezeRate('contract', contract.status)
      ? existing.exchangeRateAtCreation ?? rates[nextCurrency as never] ?? 1
      : null;

    const milestone = await prisma.paymentMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        exchangeRateAtCreation: milestoneRate,
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
        ...(body.invoiceNumber !== undefined ? { invoiceNumber: body.invoiceNumber } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.status !== undefined
          ? {
              status: body.status,
              // "Tahsil Edildi" işaretlendiğinde tarih verilmemişse bugün yazılır.
              paidAt:
                body.status === 'Tahsil Edildi'
                  ? body.paidAt ?? existing.paidAt ?? new Date()
                  : body.paidAt ?? null,
            }
          : body.paidAt !== undefined
            ? { paidAt: body.paidAt }
            : {}),
      },
    });

    res.json(decorateMilestone(milestone, rates));
  }),
);

/** DELETE /api/v1/contracts/:id/milestones/:milestoneId */
router.delete(
  '/:id/milestones/:milestoneId',
  requirePermission('contract:write'),
  auditAction('MILESTONE_DELETE', 'PaymentMilestone'),
  asyncHandler(async (req, res) => {
    const contract = await assertContractAccess(req.user, String(req.params.id));
    const result = await prisma.paymentMilestone.deleteMany({
      where: { id: String(req.params.milestoneId), contractId: contract.id },
    });
    if (result.count === 0) throw NotFound('Hakediş kaydı bulunamadı.');
    res.json({ success: true });
  }),
);

export default router;
