import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Forbidden, NotFound, Unauthorized } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { hasPermission, type Permission } from './permissions';

/** İzin kapısı. `authenticate` sonrasında kullanılır. */
export function requirePermission(...required: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(Unauthorized());
    const missing = required.filter((p) => !hasPermission(user.role, p));
    if (missing.length > 0) {
      return next(Forbidden(`Eksik yetki: ${missing.join(', ')}`));
    }
    next();
  };
}

/** Rol kapısı — izin matrisinin dışında kalan yönetimsel uçlar için. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(Unauthorized());
    if (!roles.includes(user.role)) {
      return next(Forbidden('Bu işlem için rol yetkiniz yetersiz.'));
    }
    next();
  };
}

/**
 * Veri kapsamı (IDOR savunması).
 *
 * Yetki kontrolü tek başına IDOR'u engellemez: `deal:read` izni olan bir
 * satışçı, `/deals/:id` üzerinden BAŞKA bir departmanın fırsatını okuyabilir.
 * Bu yüzden her sorguya kullanıcı kapsamı bir `where` parçası olarak enjekte
 * edilir; kayıt kapsam dışındaysa 403 yerine 404 döneriz — aksi halde
 * "403 = kayıt var" bilgisi varlık numaralandırmaya (enumeration) yol açar.
 */
export function companyScope(user: Request['user']): Prisma.CompanyWhereInput {
  if (!user) return { id: '__deny__' };
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return {};
  if (user.departmentId) {
    return {
      OR: [
        { departmentId: user.departmentId },
        { ownerId: user.id },
        { departmentId: null },
      ],
    };
  }
  return { OR: [{ ownerId: user.id }, { departmentId: null }] };
}

/** Şirkete bağlı alt kayıtlar (kişi, fırsat, teklif...) için kapsam. */
export function relatedCompanyScope(user: Request['user']): Prisma.CompanyWhereInput | undefined {
  const scope = companyScope(user);
  return Object.keys(scope).length === 0 ? undefined : scope;
}

/**
 * Bir şirket kaydına erişimi doğrular ve kaydı döndürür.
 * Kapsam dışındaki kayıt için 404 üretir.
 */
export async function assertCompanyAccess(
  user: Request['user'],
  companyId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<{ id: string; name: string; departmentId: string | null; ownerId: string | null }> {
  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      ...(options.includeDeleted ? {} : { deletedAt: null }),
      AND: [companyScope(user)],
    },
    select: { id: true, name: true, departmentId: true, ownerId: true },
  });
  if (!company) throw NotFound('Şirket bulunamadı.');
  return company;
}

/**
 * Rota parametresindeki şirket kimliğini erişim kapsamına göre doğrulayan
 * hazır middleware. `req.params[paramName]` bekler.
 */
export function guardCompanyParam(paramName = 'id'): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    await assertCompanyAccess(req.user, String(req.params[paramName]));
    next();
  });
}

/**
 * Kullanıcının yalnızca kendi kaydına dokunabileceği uçlar için
 * (profil, şifre, kendi notları). ADMIN muaf değildir: kendi rotasıdır.
 */
export function requireSelfOrRole(paramName: string, ...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(Unauthorized());
    if (req.params[paramName] === user.id) return next();
    if (roles.includes(user.role)) return next();
    return next(Forbidden('Yalnızca kendi kaydınıza erişebilirsiniz.'));
  };
}
