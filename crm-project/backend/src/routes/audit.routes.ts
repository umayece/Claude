import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';

const router = Router();
router.use(authenticate, requireMfaComplete);

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  userId: z.string().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(200).optional(),
});
type Query = z.infer<typeof querySchema>;

/**
 * GET /api/v1/audit-logs
 *
 * Denetim tablosu en hızlı büyüyen tablodur; sayfalama zorunlu ve üst
 * sınır 100'dür. Varsayılan sıralama `createdAt desc` olup bileşik
 * (createdAt) ve (userId, createdAt) indeksleri bu erişim desenini karşılar.
 */
router.get(
  '/',
  requirePermission('audit:read'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<Query>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);

    const and: Prisma.AuditLogWhereInput[] = [];
    if (query.userId) and.push({ userId: query.userId });
    if (query.action) and.push({ action: query.action });
    if (query.entityType) and.push({ entityType: query.entityType });
    if (query.entityId) and.push({ entityId: query.entityId });
    if (query.from || query.to) {
      and.push({ createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } });
    }
    if (query.q) {
      and.push({
        OR: [
          { userEmail: { contains: query.q, mode: 'insensitive' } },
          { action: { contains: query.q, mode: 'insensitive' } },
          { entityType: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.AuditLogWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json(paginated(rows, total, page));
  }),
);

/** GET /api/v1/audit-logs/actions — filtre açılır listesi için ayrık eylemler. */
router.get(
  '/actions',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.auditLog.groupBy({
      by: ['action'],
      _count: { _all: true },
      orderBy: { _count: { action: 'desc' } },
      take: 100,
    });
    res.json({ data: rows.map((r) => ({ action: r.action, count: r._count._all })) });
  }),
);

export default router;
