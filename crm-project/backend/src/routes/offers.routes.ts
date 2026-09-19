import { Router, type Request } from 'express';
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
  dualValue, getRateMap, shouldFreezeRate, SUPPORTED_CURRENCIES, toTryAt, type RateMap,
} from '../services/currency.service';
import { nextSequence } from '../services/sequence.service';
import { INCOTERM_CODES } from '../services/defenceTrade.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

export const OFFER_STATUSES = ['Taslak', 'Gönderildi', 'Revize', 'Kabul', 'Ret', 'Süresi Doldu'] as const;

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  quantity: z.number().min(0).max(1e9).default(1),
  unit: z.string().trim().max(20).default('Adet'),
  unitPrice: z.number().min(0).max(1e12).default(0),
  /** Birim başına tahmini maliyet (teklifin costCurrency'si cinsinden). */
  cost: z.number().min(0).max(1e12).default(0),
  taxRate: z.number().min(0).max(100).default(20),
  discountRate: z.number().min(0).max(100).default(0),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

const offerBodySchema = z.object({
  title: z.string().trim().min(2).max(300),
  /**
   * Kurum ZORUNLU DEĞİL: bağımsız danışman, aracı veya komisyoncuya
   * doğrudan teklif verilebilir. En az birinin (kurum ya da kişi) dolu
   * olması `superRefine` ile doğrulanır.
   */
  companyId: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.string().uuid().nullable(),
  ).optional(),
  contactId: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.string().uuid().nullable(),
  ).optional(),
  dealId: z.string().uuid().nullish(),
  offerNumber: z.string().trim().max(60).optional(),
  status: z.enum(OFFER_STATUSES).default('Taslak'),
  currency: z.enum(SUPPORTED_CURRENCIES).default('USD'),
  /** Maliyet para birimi satış para biriminden farklı olabilir. */
  costCurrency: z.enum(SUPPORTED_CURRENCIES).default('USD'),
  /** Teslim şekli — fiyatın navlun/sigortayı kapsayıp kapsamadığını belirler. */
  incoterm: z.enum(INCOTERM_CODES).nullish(),
  incotermPlace: z.string().trim().max(200).nullish(),
  validUntil: z.coerce.date().nullish(),
  notes: z.string().max(5000).nullish(),
  terms: z.string().max(50_000).nullish(),
  items: z.array(itemSchema).max(200).default([]),
});

/**
 * Teklif havada duramaz: ya bir kuruma ya bir kişiye kesilmelidir.
 *
 * Kural `superRefine` olarak AYRI uygulanır; şemaya doğrudan zincirlenseydi
 * ortaya çıkan `ZodEffects` `.partial()` desteklemez ve kısmi güncelleme
 * (PUT) şeması kurulamazdı.
 */
function checkOfferTarget(
  value: { companyId?: string | null; contactId?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (!value.companyId && !value.contactId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Teklif bir kuruma veya bir kişiye kesilmelidir.',
      path: ['companyId'],
    });
  }
}

const offerCreateSchema = offerBodySchema.superRefine(checkOfferTarget);
const offerUpdateSchema = offerBodySchema.partial();

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(OFFER_STATUSES).optional(),
  companyId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  sort: z.string().max(40).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const offerInclude = {
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, title: true, stage: true } },
} satisfies Prisma.OfferInclude;

/**
 * Kişiye erişimi doğrular.
 *
 * Bağımsız kişi hiçbir departmana ait değildir; kurum kapsamı ona
 * uygulanamaz. Kuruma bağlı kişide kurum kapsamı geçerlidir.
 */
async function assertContactAccess(user: Request['user'], contactId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      deletedAt: null,
      OR: [{ companyId: null }, { company: companyScope(user) }],
    },
    select: { id: true },
  });
  if (!contact) throw NotFound('Kişi bulunamadı.');
}

/** Satır ve toplam hesabı yalnızca sunucuda yapılır — istemciden gelen toplam kabul edilmez. */
function computeTotals(items: z.infer<typeof itemSchema>[]) {
  let subtotal = 0;
  let taxTotal = 0;
  let costTotal = 0;

  const lines = items.map((item) => {
    const gross = item.quantity * item.unitPrice;
    const net = gross * (1 - item.discountRate / 100);
    const tax = net * (item.taxRate / 100);
    subtotal += net;
    taxTotal += tax;
    costTotal += item.quantity * item.cost;
    return { ...item, lineTotal: Math.round((net + tax) * 100) / 100 };
  });

  return {
    lines,
    subtotal: Math.round(subtotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    total: Math.round((subtotal + taxTotal) * 100) / 100,
    costTotal: Math.round(costTotal * 100) / 100,
  };
}

/**
 * Brüt kâr ve marj.
 *
 * ANA RAPORLAMA TEKLİFİN KENDİ PARA BİRİMİNDEDİR. Teklif USD açıldıysa
 * kâr da USD gösterilir; zorunlu TL çevrimi ihracat ekibinin kafasını
 * karıştırıyordu ve kur oynadıkça aynı teklifin kârı değişiyormuş gibi
 * görünüyordu.
 *
 * Maliyet farklı bir para biriminde olabilir (hammadde USD, teklif EUR).
 * Bu durumda maliyet anlık kurla teklifin para birimine çevrilir — iki
 * farklı birimi doğrudan çıkarmak sessiz ve büyük bir hata olurdu.
 *
 * Formül: Kâr Oranı (%) = ((Satış - Maliyet) / Satış) * 100
 * KDV hariç net satış esas alınır: KDV devlete aittir, kâr değildir.
 *
 * TL karşılığı ayrıca döner (`grossProfitTry`) ama ikincil bilgidir.
 */
function computeMargin(
  subtotal: number, currency: string,
  costTotal: number, costCurrency: string,
  rates: RateMap,
) {
  // Maliyeti teklifin para birimine çevir: önce TL'ye, sonra hedefe.
  const costInOfferCurrency = costCurrency === currency
    ? costTotal
    : toTryAt(costTotal, costCurrency, rates) / (rates[currency as never] ?? 1);

  const grossProfit = Math.round((subtotal - costInOfferCurrency) * 100) / 100;

  return {
    /** Teklifin para birimi — arayüz bu simgeyi kullanır. */
    currency,
    revenue: Math.round(subtotal * 100) / 100,
    cost: Math.round(costInOfferCurrency * 100) / 100,
    grossProfit,
    // Ciro sıfırken marj tanımsızdır; 0 döndürmek "sıfır kâr" yanılgısı yaratır.
    marginPercent: subtotal > 0
      ? Math.round((grossProfit / subtotal) * 1000) / 10
      : null,
    // İkincil: TL karşılığı. Ana rapor teklifin dövizinde kalır.
    revenueTry: Math.round(toTryAt(subtotal, currency, rates) * 100) / 100,
    costTry: Math.round(toTryAt(costTotal, costCurrency, rates) * 100) / 100,
    grossProfitTry: Math.round(
      (toTryAt(subtotal, currency, rates) - toTryAt(costTotal, costCurrency, rates)) * 100,
    ) / 100,
  };
}

/** GET /api/v1/offers */
router.get(
  '/',
  requirePermission('offer:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const orderBy = buildOrderBy(
      query.sort,
      ['createdAt', 'total', 'validUntil', 'title'] as const,
      'createdAt',
    );

    const and: Prisma.OfferWhereInput[] = [{ deletedAt: null }, { company: companyScope(req.user) }];
    if (query.status) and.push({ status: query.status });
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.dealId) and.push({ dealId: query.dealId });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { offerNumber: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.OfferWhereInput = { AND: and };
    const rates = await getRateMap();
    const [rows, total] = await prisma.$transaction([
      prisma.offer.findMany({
        where, include: offerInclude,
        orderBy,
        skip: page.skip, take: page.take,
      }),
      prisma.offer.count({ where }),
    ]);

    // Taslak teklifler piyasayı izler; gönderilmiş/kabul edilmiş teklifler
    // kayıt anı kuruyla birlikte ÇİFT gösterilir.
    res.json(paginated(
      rows.map((offer) => ({
        ...offer,
        ...dualValue(offer.total, offer.currency, offer.exchangeRateAtCreation, rates),
        totalTry: dualValue(offer.total, offer.currency, offer.exchangeRateAtCreation, rates).amountTry,
        margin: computeMargin(
          offer.subtotal, offer.currency, offer.costTotal, offer.costCurrency, rates,
        ),
      })),
      total,
      page,
    ));
  }),
);

/** GET /api/v1/offers/:id */
router.get(
  '/:id',
  requirePermission('offer:read'),
  asyncHandler(async (req, res) => {
    const offer = await prisma.offer.findFirst({
      where: { id: req.params.id, deletedAt: null, company: companyScope(req.user) },
      include: { ...offerInclude, items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!offer) throw NotFound('Teklif bulunamadı.');
    const rates = await getRateMap();
    const valuation = dualValue(offer.total, offer.currency, offer.exchangeRateAtCreation, rates);
    const margin = computeMargin(
      offer.subtotal, offer.currency, offer.costTotal, offer.costCurrency, rates,
    );
    res.json({ ...offer, ...valuation, totalTry: valuation.amountTry, margin });
  }),
);

/** POST /api/v1/offers */
router.post(
  '/',
  requirePermission('offer:write'),
  validate(offerCreateSchema),
  auditAction('OFFER_CREATE', 'Offer'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof offerCreateSchema>;
    // Kurum verildiyse erişim doğrulanır; verilmediyse teklif kişiye kesilir.
    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);
    if (body.contactId) await assertContactAccess(req.user, body.contactId);

    const totals = computeTotals(body.items);
    const offer = await prisma.offer.create({
      data: {
        offerNumber: body.offerNumber || (await nextSequence('TKL')),
        title: body.title,
        companyId: body.companyId ?? null,
        contactId: body.contactId ?? null,
        dealId: body.dealId ?? null,
        status: body.status,
        currency: body.currency,
        // Yalnızca resmiyet kazanmış teklifte kur dondurulur.
        exchangeRateAtCreation: shouldFreezeRate('offer', body.status)
          ? (await getRateMap())[body.currency] ?? 1
          : null,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        costTotal: totals.costTotal,
        costCurrency: body.costCurrency,
        incoterm: body.incoterm ?? null,
        incotermPlace: body.incotermPlace ?? null,
        total: totals.total,
        validUntil: body.validUntil ?? null,
        notes: body.notes ?? null,
        terms: body.terms ?? null,
        items: {
          create: totals.lines.map((line) => ({
            productId: line.productId ?? null,
            name: line.name,
            description: line.description ?? null,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            cost: line.cost,
            taxRate: line.taxRate,
            discountRate: line.discountRate,
            lineTotal: line.lineTotal,
            sortOrder: line.sortOrder,
          })),
        },
      },
      include: { ...offerInclude, items: { orderBy: { sortOrder: 'asc' } } },
    });

    req.auditContext = { entityType: 'Offer', entityId: offer.id };
    await logActivity({
      type: 'SYSTEM', title: `Teklif oluşturuldu: ${offer.offerNumber}`,
      companyId: offer.companyId, dealId: offer.dealId, contactId: offer.contactId,
      userId: req.user!.id,
    });

    res.status(201).json(offer);
  }),
);

/** PUT /api/v1/offers/:id */
router.put(
  '/:id',
  requirePermission('offer:write'),
  validate(offerUpdateSchema),
  auditAction('OFFER_UPDATE', 'Offer'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.offer.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
    });
    if (!existing) throw NotFound('Teklif bulunamadı.');

    const body = req.body as Partial<z.infer<typeof offerBodySchema>>;
    if (body.companyId && body.companyId !== existing.companyId) {
      await assertCompanyAccess(req.user, body.companyId);
    }

    // Teklif taslaktan çıkıp gönderildiğinde/kabul edildiğinde o anki kur
    // dondurulur; geri taslağa dönerse dondurma kalkar ve piyasayı izler.
    const nextStatus = body.status ?? existing.status;
    const nextCurrency = body.currency ?? existing.currency;
    const shouldFreeze = shouldFreezeRate('offer', nextStatus);
    const exchangeRateAtCreation = shouldFreeze
      ? existing.exchangeRateAtCreation ?? (await getRateMap())[nextCurrency as never] ?? 1
      : null;

    const offer = await prisma.$transaction(async (tx) => {
      if (body.items !== undefined) {
        const totals = computeTotals(body.items);
        // Satırlar tam değiştirilir; kısmi birleştirme fiyat tutarsızlığı doğurur.
        await tx.offerItem.deleteMany({ where: { offerId: id } });
        await tx.offerItem.createMany({
          data: totals.lines.map((line) => ({
            offerId: id,
            productId: line.productId ?? null,
            name: line.name,
            description: line.description ?? null,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            cost: line.cost,
            taxRate: line.taxRate,
            discountRate: line.discountRate,
            lineTotal: line.lineTotal,
            sortOrder: line.sortOrder,
          })),
        });
        await tx.offer.update({
          where: { id },
          data: {
            subtotal: totals.subtotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            costTotal: totals.costTotal,
            ...(body.costCurrency !== undefined ? { costCurrency: body.costCurrency } : {}),
            ...(body.incoterm !== undefined ? { incoterm: body.incoterm } : {}),
            ...(body.incotermPlace !== undefined ? { incotermPlace: body.incotermPlace } : {}),
          },
        });
      }

      await tx.offer.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.offerNumber !== undefined ? { offerNumber: body.offerNumber } : {}),
          ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
          ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
          ...(body.dealId !== undefined ? { dealId: body.dealId } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          exchangeRateAtCreation,
          ...(body.validUntil !== undefined ? { validUntil: body.validUntil } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.terms !== undefined ? { terms: body.terms } : {}),
        },
      });

      return tx.offer.findUniqueOrThrow({
        where: { id },
        include: { ...offerInclude, items: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    res.json(offer);
  }),
);

/** DELETE /api/v1/offers/:id */
router.delete(
  '/:id',
  requirePermission('offer:delete'),
  auditAction('OFFER_DELETE', 'Offer'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.offer.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
      select: { id: true },
    });
    if (!existing) throw NotFound('Teklif bulunamadı.');
    await prisma.offer.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  }),
);

export default router;
