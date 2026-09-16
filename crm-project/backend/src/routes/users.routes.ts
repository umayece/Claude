import { Router } from 'express';
import { Prisma, type Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { BadRequest, Forbidden, NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { paginated, parsePagination } from '../utils/pagination';
import { assertPasswordStrength, hashPassword } from '../utils/password';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, requireRole } from '../middleware/rbac';
import { canAssignRole, permissionsFor } from '../middleware/permissions';
import { validate } from '../middleware/validate';
import { auditAction } from '../middleware/audit';

const router = Router();
router.use(authenticate, requireMfaComplete);

const ROLES = ['ADMIN', 'MANAGER', 'SALES', 'SUPPORT', 'VIEWER'] as const;

const publicSelect = {
  id: true, email: true, name: true, role: true, phone: true, avatarUrl: true,
  departmentId: true, isActive: true, lastLoginAt: true, mfaEnabled: true, createdAt: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

/** GET /api/v1/users — atama açılır listeleri için. */
router.get(
  '/',
  requirePermission('user:read'),
  asyncHandler(async (req, res) => {
    const page = parsePagination(req.query as Record<string, unknown>);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.user.findMany({ where, select: publicSelect, orderBy: { name: 'asc' }, skip: page.skip, take: page.take }),
      prisma.user.count({ where }),
    ]);

    res.json(paginated(rows, total, page));
  }),
);

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(40).nullish(),
  avatarUrl: z.string().trim().max(500_000).nullish(),
  secondaryEmails: z.array(z.string().trim().email().max(255)).max(10).nullish(),
  calendarFilterPreferences: z
    .object({
      showTasks: z.boolean().optional(),
      showTenders: z.boolean().optional(),
      showContracts: z.boolean().optional(),
      showBirthdays: z.boolean().optional(),
      showMilestones: z.boolean().optional(),
    })
    .nullish(),
});

/**
 * PUT /api/v1/users/me — kendi profilini güncelle.
 *
 * `role`, `isActive`, `departmentId` ve `email` bu uçta KABUL EDİLMEZ:
 * şemada yoklar, dolayısıyla bir kullanıcı gövdeye `role: "ADMIN"`
 * ekleyerek kendini yükseltemez (kütle atama savunması).
 */
router.put(
  '/me',
  validate(profileSchema),
  auditAction('USER_PROFILE_UPDATE', 'User'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof profileSchema>;
    req.auditContext = { entityType: 'User', entityId: req.user!.id };

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        ...(body.secondaryEmails !== undefined
          ? { secondaryEmails: (body.secondaryEmails ?? Prisma.DbNull) as Prisma.InputJsonValue }
          : {}),
        ...(body.calendarFilterPreferences !== undefined
          ? {
              calendarFilterPreferences:
                (body.calendarFilterPreferences ?? Prisma.DbNull) as Prisma.InputJsonValue,
            }
          : {}),
      },
      select: { ...publicSelect, secondaryEmails: true, calendarFilterPreferences: true },
    });

    res.json({ ...user, permissions: permissionsFor(user.role) });
  }),
);

/** DELETE /api/v1/users/me/avatar */
router.delete(
  '/me/avatar',
  auditAction('USER_AVATAR_REMOVE', 'User'),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatarUrl: null },
      select: publicSelect,
    });
    res.json(user);
  }),
);

const createUserSchema = z.object({
  email: z.string().trim().email().max(255),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(10).max(200),
  role: z.enum(ROLES).default('VIEWER'),
  departmentId: z.string().uuid().nullish(),
});

/** POST /api/v1/users — yalnızca ADMIN. */
router.post(
  '/',
  requireRole('ADMIN'),
  validate(createUserSchema),
  auditAction('USER_CREATE', 'User'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createUserSchema>;
    assertPasswordStrength(body.password);

    if (!canAssignRole(req.user!.role, body.role as Role)) {
      throw Forbidden('Bu rolü atama yetkiniz yok.');
    }

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash: await hashPassword(body.password),
        role: body.role,
        departmentId: body.departmentId ?? null,
      },
      select: publicSelect,
    });

    req.auditContext = { entityType: 'User', entityId: user.id };
    res.status(201).json(user);
  }),
);

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  departmentId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});

/**
 * PUT /api/v1/users/:id — yönetimsel güncelleme (yalnızca ADMIN).
 *
 * İki koruma: kendi rolünü düşüremez/değiştiremez (son yöneticinin
 * kendini kilitlemesi) ve kendini devre dışı bırakamaz.
 */
router.put(
  '/:id',
  requireRole('ADMIN'),
  validate(updateUserSchema),
  auditAction('USER_UPDATE', 'User'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = req.body as z.infer<typeof updateUserSchema>;

    const target = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw NotFound('Kullanıcı bulunamadı.');

    if (id === req.user!.id && (body.role !== undefined || body.isActive === false)) {
      throw BadRequest('Kendi rolünüzü veya erişim durumunuzu bu uçtan değiştiremezsiniz.');
    }
    if (body.role && !canAssignRole(req.user!.role, body.role as Role)) {
      throw Forbidden('Bu rolü atama yetkiniz yok.');
    }

    // Son etkin yöneticiyi kaybetmemek için sayım yapılır.
    if (target.role === 'ADMIN' && (body.role !== undefined && body.role !== 'ADMIN' || body.isActive === false)) {
      const admins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true, deletedAt: null, id: { not: id } },
      });
      if (admins === 0) throw BadRequest('Sistemde en az bir etkin yönetici kalmalıdır.');
    }

    const roleOrStatusChanged = body.role !== undefined || body.isActive !== undefined;

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        // Rol veya erişim değiştiyse elindeki tüm token'lar geçersizleşir;
        // aksi halde düşürülen bir yönetici token süresi dolana kadar
        // eski yetkileriyle çalışmaya devam eder.
        ...(roleOrStatusChanged ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: publicSelect,
    });

    if (roleOrStatusChanged) {
      await prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    res.json(user);
  }),
);

/** DELETE /api/v1/users/:id — yumuşak silme. */
router.delete(
  '/:id',
  requireRole('ADMIN'),
  auditAction('USER_DELETE', 'User'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (id === req.user!.id) throw BadRequest('Kendi hesabınızı silemezsiniz.');

    const target = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw NotFound('Kullanıcı bulunamadı.');

    if (target.role === 'ADMIN') {
      const admins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true, deletedAt: null, id: { not: id } },
      });
      if (admins === 0) throw BadRequest('Sistemde en az bir etkin yönetici kalmalıdır.');
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, tokenVersion: { increment: 1 } },
      }),
      prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    res.json({ success: true });
  }),
);

/** GET /api/v1/users/departments */
router.get(
  '/meta/departments',
  requirePermission('user:read'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.department.findMany({ orderBy: { name: 'asc' } });
    res.json({ data: rows });
  }),
);

export default router;
