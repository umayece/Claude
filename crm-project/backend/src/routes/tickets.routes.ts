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
import { nextSequence } from '../services/sequence.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

export const TICKET_STATUSES = ['Açık', 'İnceleniyor', 'Parça Bekleniyor', 'Çözüldü', 'İptal'] as const;
export const TICKET_PRIORITIES = ['Düşük', 'Orta', 'Yüksek', 'Kritik'] as const;
export const TICKET_CATEGORIES = [
  'Garanti', 'Periyodik Bakım', 'Arıza Bildirimi', 'Yedek Parça', 'Kalite Kusuru',
] as const;

/** Öncelik → SLA süresi (saat). Kritik arıza 4 saatte yanıt bekler. */
const SLA_HOURS: Record<string, number> = {
  'Kritik': 4,
  'Yüksek': 24,
  'Orta': 72,
  'Düşük': 168,
};

const ticketBodySchema = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().min(1).max(20_000),
  companyId: z.string().uuid(),
  contactId: z.string().uuid().nullish(),
  assignedUserId: z.string().uuid().nullish(),
  priority: z.enum(TICKET_PRIORITIES).default('Orta'),
  status: z.enum(TICKET_STATUSES).default('Açık'),
  category: z.enum(TICKET_CATEGORIES),
  slaDeadline: z.coerce.date().nullish(),
  resolutionNote: z.string().max(10_000).nullish(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  companyId: z.string().uuid().optional(),
  assignedUserId: z.string().uuid().optional(),
  slaBreached: z.coerce.boolean().optional(),
  sort: z.string().max(40).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const ticketInclude = {
  company: { select: { id: true, name: true, type: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  assignedUser: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.TicketInclude;

function decorate<T extends { slaDeadline: Date | null; resolvedAt: Date | null; status: string }>(t: T) {
  const breached =
    t.slaDeadline !== null && t.resolvedAt === null && t.status !== 'İptal' && t.slaDeadline < new Date();
  return {
    ...t,
    slaBreached: breached,
    hoursUntilSla: t.slaDeadline && !t.resolvedAt
      ? Math.round((t.slaDeadline.getTime() - Date.now()) / 3_600_000)
      : null,
  };
}

/** GET /api/v1/tickets */
router.get(
  '/',
  requirePermission('ticket:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const orderBy = buildOrderBy(
      query.sort,
      ['createdAt', 'slaDeadline', 'priority', 'status'] as const,
      'createdAt',
    );

    const and: Prisma.TicketWhereInput[] = [{ deletedAt: null }, { company: companyScope(req.user) }];
    if (query.status) and.push({ status: query.status });
    if (query.priority) and.push({ priority: query.priority });
    if (query.category) and.push({ category: query.category });
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.assignedUserId) and.push({ assignedUserId: query.assignedUserId });
    if (query.slaBreached) {
      and.push({ slaDeadline: { lt: new Date() }, resolvedAt: null, status: { notIn: ['Çözüldü', 'İptal'] } });
    }
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { ticketNumber: { contains: query.q, mode: 'insensitive' } },
          { description: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.TicketWhereInput = { AND: and };
    const [rows, total] = await prisma.$transaction([
      prisma.ticket.findMany({
        where, include: ticketInclude,
        orderBy,
        skip: page.skip, take: page.take,
      }),
      prisma.ticket.count({ where }),
    ]);

    res.json(paginated(rows.map(decorate), total, page));
  }),
);

/** GET /api/v1/tickets/:id */
router.get(
  '/:id',
  requirePermission('ticket:read'),
  asyncHandler(async (req, res) => {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, deletedAt: null, company: companyScope(req.user) },
      include: {
        ...ticketInclude,
        activities: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!ticket) throw NotFound('Destek kaydı bulunamadı.');
    res.json(decorate(ticket));
  }),
);

/** POST /api/v1/tickets */
router.post(
  '/',
  requirePermission('ticket:write'),
  validate(ticketBodySchema),
  auditAction('TICKET_CREATE', 'Ticket'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof ticketBodySchema>;
    await assertCompanyAccess(req.user, body.companyId);

    // SLA verilmemişse önceliğe göre otomatik hesaplanır.
    const slaDeadline =
      body.slaDeadline ?? new Date(Date.now() + (SLA_HOURS[body.priority] ?? 72) * 3_600_000);

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: await nextSequence('TKT'),
        title: body.title,
        description: body.description,
        companyId: body.companyId,
        contactId: body.contactId ?? null,
        assignedUserId: body.assignedUserId ?? null,
        priority: body.priority,
        status: body.status,
        category: body.category,
        slaDeadline,
      },
      include: ticketInclude,
    });

    req.auditContext = { entityType: 'Ticket', entityId: ticket.id };
    await logActivity({
      type: 'TICKET',
      title: `Destek talebi açıldı: ${ticket.ticketNumber} — ${ticket.title}`,
      body: ticket.description.slice(0, 500),
      companyId: ticket.companyId, contactId: ticket.contactId, ticketId: ticket.id,
      userId: req.user!.id,
      metadata: { category: ticket.category, priority: ticket.priority },
    });

    res.status(201).json(decorate(ticket));
  }),
);

/** PUT /api/v1/tickets/:id */
router.put(
  '/:id',
  requirePermission('ticket:write'),
  validate(ticketBodySchema.partial()),
  auditAction('TICKET_UPDATE', 'Ticket'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.ticket.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
    });
    if (!existing) throw NotFound('Destek kaydı bulunamadı.');

    const body = req.body as Partial<z.infer<typeof ticketBodySchema>>;
    if (body.companyId && body.companyId !== existing.companyId) {
      await assertCompanyAccess(req.user, body.companyId);
    }

    const closing = body.status === 'Çözüldü' && existing.status !== 'Çözüldü';
    const reopening = body.status !== undefined && body.status !== 'Çözüldü' && existing.status === 'Çözüldü';

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
        ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.slaDeadline !== undefined ? { slaDeadline: body.slaDeadline } : {}),
        ...(body.resolutionNote !== undefined ? { resolutionNote: body.resolutionNote } : {}),
        ...(closing ? { resolvedAt: new Date() } : {}),
        ...(reopening ? { resolvedAt: null } : {}),
      },
      include: ticketInclude,
    });

    if (body.status && body.status !== existing.status) {
      await logActivity({
        type: 'TICKET',
        title: `${ticket.ticketNumber}: ${existing.status} → ${body.status}`,
        companyId: ticket.companyId, ticketId: id, userId: req.user!.id,
        metadata: { from: existing.status, to: body.status },
      });
    }

    res.json(decorate(ticket));
  }),
);

/** DELETE /api/v1/tickets/:id */
router.delete(
  '/:id',
  requirePermission('ticket:delete'),
  auditAction('TICKET_DELETE', 'Ticket'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.ticket.findFirst({
      where: { id, deletedAt: null, company: companyScope(req.user) },
      select: { id: true },
    });
    if (!existing) throw NotFound('Destek kaydı bulunamadı.');
    await prisma.ticket.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  }),
);

export default router;
