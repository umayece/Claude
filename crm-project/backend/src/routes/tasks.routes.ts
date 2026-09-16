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

const router = Router();
router.use(authenticate, requireMfaComplete);

export const TASK_TYPES = ['Görev', 'Arama', 'Toplantı', 'E-Posta', 'Ziyaret', 'Teslimat'] as const;
export const TASK_STATUSES = ['Açık', 'Devam Ediyor', 'Tamamlandı', 'İptal'] as const;
export const TASK_PRIORITIES = ['Düşük', 'Orta', 'Yüksek', 'Kritik'] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Alanların tek tanımı. Saat kuralları ayrı bir `superRefine` olarak
 * uygulanır: şema doğrudan `.refine()` ile kurulsaydı ZodEffects döner ve
 * kısmi güncelleme için gereken `.partial()` çağrılamazdı.
 */
const taskFieldsSchema = z.object({
  title: z.string().trim().min(2).max(300),
  description: z.string().max(10_000).nullish(),
  type: z.enum(TASK_TYPES).default('Görev'),
  priority: z.enum(TASK_PRIORITIES).default('Orta'),
  status: z.enum(TASK_STATUSES).default('Açık'),
  dueDate: z.coerce.date().nullish(),
  startTime: z.string().regex(TIME_PATTERN, 'Saat "SS:DD" biçiminde olmalıdır.').nullish(),
  endTime: z.string().regex(TIME_PATTERN, 'Saat "SS:DD" biçiminde olmalıdır.').nullish(),
  isAllDay: z.boolean().default(true),
  companyId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  dealId: z.string().uuid().nullish(),
  tenderId: z.string().uuid().nullish(),
  assignedUserId: z.string().uuid().nullish(),
});

interface TimeFields {
  isAllDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

function checkTimes(value: TimeFields, ctx: z.RefinementCtx): void {
  // `isAllDay` kısmi güncellemede gelmeyebilir; yalnızca açıkça false
  // gönderildiğinde başlangıç saati aranır.
  if (value.isAllDay === false && !value.startTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tüm gün olmayan görevlerde başlangıç saati zorunludur.',
      path: ['startTime'],
    });
  }

  if (value.startTime && value.endTime && value.endTime <= value.startTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Bitiş saati başlangıçtan sonra olmalıdır.',
      path: ['endTime'],
    });
  }
}

const taskCreateSchema = taskFieldsSchema.superRefine(checkTimes);
const taskUpdateSchema = taskFieldsSchema.partial().superRefine(checkTimes);

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  type: z.enum(TASK_TYPES).optional(),
  companyId: z.string().uuid().optional(),
  assignedUserId: z.string().uuid().optional(),
  /** true → yalnızca gecikmiş, tamamlanmamış görevler. */
  overdue: z.coerce.boolean().optional(),
  mine: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.string().max(40).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const taskInclude = {
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, title: true } },
  tender: { select: { id: true, tenderNumber: true, title: true } },
  assignedUser: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.TaskInclude;

function decorate<T extends { dueDate: Date | null; status: string }>(task: T) {
  const overdue =
    task.dueDate !== null &&
    task.status !== 'Tamamlandı' &&
    task.status !== 'İptal' &&
    task.dueDate < new Date();
  return {
    ...task,
    isOverdue: overdue,
    daysOverdue: overdue && task.dueDate
      ? Math.floor((Date.now() - task.dueDate.getTime()) / 86_400_000)
      : 0,
  };
}

/**
 * Görev kapsamı: şirkete bağlı görevler şirket kapsamını miras alır,
 * şirketsiz (kişisel) görevler yalnızca sahibine görünür.
 */
function taskScope(user: Express.Request['user']): Prisma.TaskWhereInput {
  if (user?.role === 'ADMIN' || user?.role === 'MANAGER') return {};
  return {
    OR: [
      { company: companyScope(user) },
      { companyId: null, assignedUserId: user?.id ?? '__none__' },
    ],
  };
}

/** GET /api/v1/tasks */
router.get(
  '/',
  requirePermission('task:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const orderBy = buildOrderBy(
      query.sort,
      ['dueDate', 'createdAt', 'priority', 'title'] as const,
      'dueDate',
    );

    const and: Prisma.TaskWhereInput[] = [{ deletedAt: null }, taskScope(req.user)];
    if (query.status) and.push({ status: query.status });
    if (query.priority) and.push({ priority: query.priority });
    if (query.type) and.push({ type: query.type });
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.assignedUserId) and.push({ assignedUserId: query.assignedUserId });
    if (query.mine) and.push({ assignedUserId: req.user!.id });
    if (query.overdue) {
      and.push({ dueDate: { lt: new Date() }, status: { notIn: ['Tamamlandı', 'İptal'] } });
    }
    if (query.from || query.to) {
      and.push({ dueDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } });
    }
    if (query.q) and.push({ title: { contains: query.q, mode: 'insensitive' } });

    const where: Prisma.TaskWhereInput = { AND: and };
    const [rows, total] = await prisma.$transaction([
      prisma.task.findMany({
        where, include: taskInclude,
        orderBy,
        skip: page.skip, take: page.take,
      }),
      prisma.task.count({ where }),
    ]);

    res.json(paginated(rows.map(decorate), total, page));
  }),
);

/**
 * GET /api/v1/tasks/overdue — bildirim zili.
 * Sayfalama zorunlu: bildirim listesi yüzlerce satır olabilir.
 */
router.get(
  '/overdue',
  requirePermission('task:read'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const where: Prisma.TaskWhereInput = {
      AND: [
        { deletedAt: null },
        taskScope(req.user),
        { dueDate: { lt: new Date() } },
        { status: { notIn: ['Tamamlandı', 'İptal'] } },
        { OR: [{ assignedUserId: req.user!.id }, { assignedUserId: null }] },
      ],
    };

    const [rows, total] = await prisma.$transaction([
      prisma.task.findMany({ where, include: taskInclude, orderBy: { dueDate: 'asc' }, take: limit }),
      prisma.task.count({ where }),
    ]);

    res.json({ data: rows.map(decorate), meta: { total, shown: rows.length } });
  }),
);

/** GET /api/v1/tasks/:id */
router.get(
  '/:id',
  requirePermission('task:read'),
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [taskScope(req.user)] },
      include: taskInclude,
    });
    if (!task) throw NotFound('Görev bulunamadı.');
    res.json(decorate(task));
  }),
);

/** POST /api/v1/tasks */
router.post(
  '/',
  requirePermission('task:write'),
  validate(taskCreateSchema),
  auditAction('TASK_CREATE', 'Task'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof taskFieldsSchema>;
    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);

    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        type: body.type,
        priority: body.priority,
        status: body.status,
        dueDate: body.dueDate ?? null,
        startTime: body.isAllDay ? null : body.startTime ?? null,
        endTime: body.isAllDay ? null : body.endTime ?? null,
        isAllDay: body.isAllDay,
        companyId: body.companyId ?? null,
        contactId: body.contactId ?? null,
        dealId: body.dealId ?? null,
        tenderId: body.tenderId ?? null,
        assignedUserId: body.assignedUserId ?? req.user!.id,
      },
      include: taskInclude,
    });

    req.auditContext = { entityType: 'Task', entityId: task.id };
    if (task.companyId) {
      await logActivity({
        type: 'TASK', title: `Görev eklendi: ${task.title}`,
        companyId: task.companyId, contactId: task.contactId, dealId: task.dealId,
        userId: req.user!.id,
      });
    }

    res.status(201).json(decorate(task));
  }),
);

/** PUT /api/v1/tasks/:id */
router.put(
  '/:id',
  requirePermission('task:write'),
  validate(taskUpdateSchema),
  auditAction('TASK_UPDATE', 'Task'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.task.findFirst({
      where: { id, deletedAt: null, AND: [taskScope(req.user)] },
    });
    if (!existing) throw NotFound('Görev bulunamadı.');

    const body = req.body as Partial<z.infer<typeof taskFieldsSchema>>;
    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);

    const isAllDay = body.isAllDay ?? existing.isAllDay;
    const completing = body.status === 'Tamamlandı' && existing.status !== 'Tamamlandı';

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
        ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
        ...(body.dealId !== undefined ? { dealId: body.dealId } : {}),
        ...(body.tenderId !== undefined ? { tenderId: body.tenderId } : {}),
        ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId } : {}),
        // Tüm gün işaretlenirse saatler temizlenir; aksi halde takvimde
        // "tüm gün" görünen ama saat taşıyan tutarsız kayıt kalır.
        isAllDay,
        ...(isAllDay
          ? { startTime: null, endTime: null }
          : {
              ...(body.startTime !== undefined ? { startTime: body.startTime } : {}),
              ...(body.endTime !== undefined ? { endTime: body.endTime } : {}),
            }),
        ...(completing ? { completedAt: new Date() } : {}),
        ...(body.status !== undefined && body.status !== 'Tamamlandı' ? { completedAt: null } : {}),
      },
      include: taskInclude,
    });

    res.json(decorate(task));
  }),
);

/** POST /api/v1/tasks/:id/complete — bildirim panelindeki tek tık. */
router.post(
  '/:id/complete',
  requirePermission('task:write'),
  auditAction('TASK_COMPLETE', 'Task'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.task.findFirst({
      where: { id, deletedAt: null, AND: [taskScope(req.user)] },
      select: { id: true, title: true, companyId: true },
    });
    if (!existing) throw NotFound('Görev bulunamadı.');

    const task = await prisma.task.update({
      where: { id },
      data: { status: 'Tamamlandı', completedAt: new Date() },
      include: taskInclude,
    });

    if (task.companyId) {
      await logActivity({
        type: 'TASK', title: `Görev tamamlandı: ${task.title}`,
        companyId: task.companyId, userId: req.user!.id,
      });
    }

    res.json(decorate(task));
  }),
);

/** DELETE /api/v1/tasks/:id */
router.delete(
  '/:id',
  requirePermission('task:delete'),
  auditAction('TASK_DELETE', 'Task'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.task.findFirst({
      where: { id, deletedAt: null, AND: [taskScope(req.user)] },
      select: { id: true },
    });
    if (!existing) throw NotFound('Görev bulunamadı.');
    await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  }),
);

export { taskScope };
export default router;
