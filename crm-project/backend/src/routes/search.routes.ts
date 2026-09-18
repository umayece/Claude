import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { phoneSearchFragment } from '../utils/phone';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';

const router = Router();
router.use(authenticate, requireMfaComplete);

const SEARCH_TYPES = ['company', 'contact', 'deal', 'tender', 'contract', 'offer', 'product', 'ticket'] as const;
type SearchType = (typeof SEARCH_TYPES)[number];

const querySchema = z.object({
  q: z.string().trim().min(2, 'Arama için en az 2 karakter girin.').max(200),
  /** Virgülle ayrılmış tür listesi; boşsa hepsi taranır. */
  types: z.string().max(200).optional(),
  /** Tür başına dönecek kayıt sayısı. */
  limit: z.coerce.number().int().min(1).max(25).default(8),
});
type Query = z.infer<typeof querySchema>;

export interface SearchHit {
  id: string;
  type: SearchType;
  title: string;
  subtitle: string | null;
  /** Eşleşmenin neden bulunduğunu gösterir (ör. "Kullanım dışı telefon"). */
  matchReason: string | null;
  companyId: string | null;
  url: string;
}

/**
 * GET /api/v1/search — global arama.
 *
 * Her tür için ayrı ve SINIRLI sorgu çalıştırılır; tek bir dev UNION
 * yerine tür başına `take: limit` kullanmak yanıt boyutunu ve sorgu
 * maliyetini öngörülebilir kılar. Sonuçlar hiçbir koşulda sayfasız
 * dönmez — `limit` sunucu tarafında 25 ile sınırlıdır.
 */
router.get(
  '/',
  requirePermission('company:read'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<Query>(req);
    const term = query.q;
    const digits = phoneSearchFragment(term);
    const limit = query.limit;

    const requested = query.types
      ? query.types.split(',').map((t) => t.trim()).filter((t): t is SearchType =>
          (SEARCH_TYPES as readonly string[]).includes(t))
      : [...SEARCH_TYPES];

    const scope = companyScope(req.user);
    const insensitive = { contains: term, mode: 'insensitive' as const };
    const hits: SearchHit[] = [];
    const wants = (type: SearchType) => requested.includes(type);

    const [companies, contacts, deals, tenders, contracts, offers, products, tickets] =
      await Promise.all([
        wants('company')
          ? prisma.company.findMany({
              where: {
                AND: [
                  { deletedAt: null },
                  scope,
                  { OR: [{ name: insensitive }, { taxNumber: insensitive }, { email: insensitive }, { phone: insensitive }] },
                ],
              },
              take: limit,
              select: { id: true, name: true, type: true, status: true, sector: true },
            })
          : Promise.resolve([]),

        wants('contact')
          ? prisma.contact.findMany({
              where: {
                AND: [
                  { deletedAt: null },
                  // Bağımsız kişiler de aranabilmeli: kuruma bağlı olmayan
                  // ataşe/danışman kayıtları kapsam dışında kalırsa
                  // genel arama onları hiç bulamaz.
                  { OR: [{ companyId: null }, { company: scope }] },
                  {
                    OR: [
                      { firstName: insensitive },
                      { lastName: insensitive },
                      { email: insensitive },
                      { title: insensitive },
                      { departmentName: insensitive },
                      // Kullanım dışı numaralar da eşleşir: eski bir numaradan
                      // gelen aramada kişiyi bulabilmek gerekir.
                      ...(digits.length >= 3
                        ? [{ phones: { some: { normalizedNumber: { contains: digits } } } }]
                        : []),
                    ],
                  },
                ],
              },
              take: limit,
              select: {
                id: true, firstName: true, lastName: true, title: true, companyId: true,
                company: { select: { name: true } },
                phones: {
                  where: digits.length >= 3 ? { normalizedNumber: { contains: digits } } : undefined,
                  select: { number: true, label: true, isInactive: true },
                  take: 3,
                },
              },
            })
          : Promise.resolve([]),

        wants('deal')
          ? prisma.deal.findMany({
              where: { AND: [{ deletedAt: null }, { company: scope }, { title: insensitive }] },
              take: limit,
              select: {
                id: true, title: true, stage: true, amount: true, currency: true,
                companyId: true, company: { select: { name: true } },
              },
            })
          : Promise.resolve([]),

        wants('tender')
          ? prisma.tender.findMany({
              where: {
                AND: [
                  { deletedAt: null }, { company: scope },
                  { OR: [{ title: insensitive }, { tenderNumber: insensitive }] },
                ],
              },
              take: limit,
              select: {
                id: true, title: true, tenderNumber: true, status: true,
                companyId: true, company: { select: { name: true } },
              },
            })
          : Promise.resolve([]),

        wants('contract')
          ? prisma.contract.findMany({
              where: {
                AND: [
                  { deletedAt: null }, { company: scope },
                  { OR: [{ title: insensitive }, { contractNumber: insensitive }] },
                ],
              },
              take: limit,
              select: {
                id: true, title: true, contractNumber: true, status: true,
                companyId: true, company: { select: { name: true } },
              },
            })
          : Promise.resolve([]),

        wants('offer')
          ? prisma.offer.findMany({
              where: {
                AND: [
                  { deletedAt: null }, { company: scope },
                  { OR: [{ title: insensitive }, { offerNumber: insensitive }] },
                ],
              },
              take: limit,
              select: {
                id: true, title: true, offerNumber: true, status: true,
                companyId: true, company: { select: { name: true } },
              },
            })
          : Promise.resolve([]),

        wants('product')
          ? prisma.product.findMany({
              where: {
                AND: [
                  { deletedAt: null },
                  { OR: [{ name: insensitive }, { sku: insensitive }] },
                ],
              },
              take: limit,
              select: { id: true, name: true, sku: true, category: true, stockQuantity: true },
            })
          : Promise.resolve([]),

        wants('ticket')
          ? prisma.ticket.findMany({
              where: {
                AND: [
                  { deletedAt: null }, { company: scope },
                  { OR: [{ title: insensitive }, { ticketNumber: insensitive }] },
                ],
              },
              take: limit,
              select: {
                id: true, title: true, ticketNumber: true, status: true, priority: true,
                companyId: true, company: { select: { name: true } },
              },
            })
          : Promise.resolve([]),
      ]);

    for (const c of companies) {
      hits.push({
        id: c.id, type: 'company', title: c.name,
        subtitle: [c.type, c.sector, c.status].filter(Boolean).join(' · '),
        matchReason: null, companyId: c.id, url: `/companies/${c.id}`,
      });
    }

    for (const c of contacts) {
      const inactiveMatch = c.phones.find((p) => p.isInactive);
      hits.push({
        id: c.id, type: 'contact',
        title: `${c.firstName} ${c.lastName}`,
        subtitle: [c.title, c.company.name].filter(Boolean).join(' · '),
        matchReason: inactiveMatch
          ? `Kullanım dışı numara ile eşleşti: ${inactiveMatch.number}`
          : c.phones[0]
            ? `${c.phones[0].label}: ${c.phones[0].number}`
            : null,
        companyId: c.companyId, url: `/contacts/${c.id}`,
      });
    }

    for (const d of deals) {
      hits.push({
        id: d.id, type: 'deal', title: d.title,
        subtitle: `${d.company.name} · ${d.stage} · ${d.amount} ${d.currency}`,
        matchReason: null, companyId: d.companyId, url: `/deals/${d.id}`,
      });
    }

    for (const t of tenders) {
      hits.push({
        id: t.id, type: 'tender', title: t.title,
        subtitle: `${t.tenderNumber} · ${t.company.name} · ${t.status}`,
        matchReason: null, companyId: t.companyId, url: `/tenders/${t.id}`,
      });
    }

    for (const c of contracts) {
      hits.push({
        id: c.id, type: 'contract', title: c.title,
        subtitle: `${c.contractNumber} · ${c.company.name} · ${c.status}`,
        matchReason: null, companyId: c.companyId, url: `/contracts/${c.id}`,
      });
    }

    for (const o of offers) {
      hits.push({
        id: o.id, type: 'offer', title: o.title,
        subtitle: `${o.offerNumber} · ${o.company.name} · ${o.status}`,
        matchReason: null, companyId: o.companyId, url: `/offers/${o.id}`,
      });
    }

    for (const p of products) {
      hits.push({
        id: p.id, type: 'product', title: p.name,
        subtitle: `${p.sku} · ${p.category} · Stok: ${p.stockQuantity}`,
        matchReason: null, companyId: null, url: `/products/${p.id}`,
      });
    }

    for (const t of tickets) {
      hits.push({
        id: t.id, type: 'ticket', title: t.title,
        subtitle: `${t.ticketNumber} · ${t.company.name} · ${t.status}`,
        matchReason: null, companyId: t.companyId, url: `/tickets/${t.id}`,
      });
    }

    res.json({
      data: hits,
      meta: {
        query: term,
        total: hits.length,
        byType: hits.reduce<Record<string, number>>((acc, h) => {
          acc[h.type] = (acc[h.type] ?? 0) + 1;
          return acc;
        }, {}),
      },
    });
  }),
);

export default router;
