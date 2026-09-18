import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { getRateMap, toTryAt } from '../services/currency.service';
import { DEAL_STAGES } from './deals.routes';

const router = Router();
router.use(authenticate, requireMfaComplete);

const RANGES = ['7d', '30d', 'quarter', 'year', 'custom'] as const;

const querySchema = z.object({
  range: z.enum(RANGES).default('30d'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
type Query = z.infer<typeof querySchema>;

function resolveRange(query: Query): { from: Date; to: Date } {
  const to = query.to ?? new Date();
  if (query.range === 'custom' && query.from) return { from: query.from, to };

  const now = new Date();
  switch (query.range) {
    case '7d':
      return { from: new Date(now.getTime() - 7 * 86_400_000), to };
    case 'quarter': {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return { from: new Date(now.getFullYear(), quarterStartMonth, 1), to };
    }
    case 'year':
      return { from: new Date(now.getFullYear(), 0, 1), to };
    case '30d':
    default:
      return { from: new Date(now.getTime() - 30 * 86_400_000), to };
  }
}

/** GET /api/v1/dashboard */
router.get(
  '/',
  requirePermission('company:read'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<Query>(req);
    const { from, to } = resolveRange(query);
    const scope = companyScope(req.user);
    const period = { gte: from, lte: to };

    const dealWhere: Prisma.DealWhereInput = {
      AND: [{ deletedAt: null }, { company: scope }, { createdAt: period }],
    };

    const [
      companyCount, newCompanyCount, contactCount,
      deals, openTenders, activeContracts,
      openTickets, overdueTasks, lossRows,
    ] = await prisma.$transaction([
      prisma.company.count({ where: { AND: [{ deletedAt: null }, scope] } }),
      prisma.company.count({ where: { AND: [{ deletedAt: null }, scope, { createdAt: period }] } }),
      prisma.contact.count({
        where: {
          AND: [
            { deletedAt: null },
            // Bağımsız kişiler de sayılır; hiçbir departmana ait olmadıkları
            // için kurum kapsamı onlara uygulanamaz.
            { OR: [{ companyId: null }, { company: scope }] },
          ],
        },
      }),
      prisma.deal.findMany({
        where: dealWhere,
        select: { stage: true, amount: true, currency: true, createdAt: true },
      }),
      prisma.tender.count({
        where: {
          AND: [
            { deletedAt: null }, { company: scope },
            { status: { notIn: ['Kazanıldı', 'Kaybedildi', 'İptal'] } },
          ],
        },
      }),
      prisma.contract.count({
        where: { AND: [{ deletedAt: null }, { company: scope }, { status: 'Aktif' }] },
      }),
      prisma.ticket.count({
        where: {
          AND: [
            { deletedAt: null }, { company: scope },
            { status: { notIn: ['Çözüldü', 'İptal'] } },
          ],
        },
      }),
      prisma.task.count({
        where: {
          AND: [
            { deletedAt: null },
            { OR: [{ company: scope }, { companyId: null, assignedUserId: req.user!.id }] },
            { dueDate: { lt: new Date() } },
            { status: { notIn: ['Tamamlandı', 'İptal'] } },
          ],
        },
      }),
      prisma.deal.groupBy({
        by: ['lossReason'],
        where: { ...dealWhere, stage: 'Kaybedildi', lossReason: { not: null } },
        _count: { _all: true },
      }),
    ]);

    // Tüm tutarlar İSTEK ANINDAKİ kurla değerlenir; dondurulmuş kur yok.
    const rates = await getRateMap();

    // Huni: aşama bazlı adet, TL toplam ve bir önceki aşamadan dönüşüm.
    const funnel = DEAL_STAGES.filter((s) => s !== 'Kaybedildi').map((stage, index, list) => {
      const items = deals.filter((d) => d.stage === stage);
      const previousStage = list[index - 1];
      const previousCount = previousStage
        ? deals.filter((d) => d.stage === previousStage).length
        : null;
      return {
        stage,
        count: items.length,
        totalTry: Math.round(items.reduce((s, d) => s + toTryAt(d.amount, d.currency, rates), 0) * 100) / 100,
        conversionRate:
          previousCount && previousCount > 0
            ? Math.round((items.length / previousCount) * 1000) / 10
            : null,
      };
    });

    const won = deals.filter((d) => d.stage === 'Kazanıldı');
    const lost = deals.filter((d) => d.stage === 'Kaybedildi');
    const open = deals.filter((d) => d.stage !== 'Kazanıldı' && d.stage !== 'Kaybedildi');

    const sumTry = (rows: typeof deals) =>
      Math.round(rows.reduce((s, d) => s + toTryAt(d.amount, d.currency, rates), 0) * 100) / 100;
    const sumUsd = (rows: typeof deals) =>
      Math.round((sumTry(rows) / (rates.USD || 1)) * 100) / 100;

    // Zaman serisi: aralığı günlük kovalara böler (grafik ekseni için).
    const dayCount = Math.min(180, Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000)));
    const series = Array.from({ length: dayCount }, (_, i) => {
      const dayStart = new Date(from.getTime() + i * 86_400_000);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const inDay = deals.filter((d) => d.createdAt >= dayStart && d.createdAt < dayEnd);
      return {
        date: dayStart.toISOString().slice(0, 10),
        count: inDay.length,
        totalTry: sumTry(inDay),
      };
    });

    res.json({
      range: { from, to, preset: query.range },
      kpis: {
        companyCount,
        newCompanyCount,
        contactCount,
        openTenders,
        activeContracts,
        openTickets,
        overdueTasks,
        dealCount: deals.length,
        wonCount: won.length,
        lostCount: lost.length,
        wonAmountTry: sumTry(won),
        wonAmountUsd: sumUsd(won),
        openAmountTry: sumTry(open),
        openAmountUsd: sumUsd(open),
        winRate: won.length + lost.length > 0
          ? Math.round((won.length / (won.length + lost.length)) * 1000) / 10
          : null,
      },
      // Değerlemenin hangi kurla yapıldığı arayüzde gösterilir.
      valuation: { valuedAt: new Date().toISOString(), rates },
      funnel,
      lossReasons: lossRows
        .map((r) => ({ reason: r.lossReason ?? 'Belirtilmemiş', count: r._count._all }))
        .sort((a, b) => b.count - a.count),
      series,
    });
  }),
);

export default router;
