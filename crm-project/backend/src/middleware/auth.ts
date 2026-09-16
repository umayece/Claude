import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Forbidden, Unauthorized } from '../lib/errors';
import { isAccessTokenRevoked, verifyAccessToken } from '../utils/jwt';
import { asyncHandler } from '../utils/asyncHandler';
import { permissionsFor, type Permission } from './permissions';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string | null;
  permissions: Permission[];
  mfaSatisfied: boolean;
  jti: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Denetim kaydı için rota gövdesinin doldurduğu bağlam. */
      auditContext?: { entityType: string; entityId?: string; changes?: unknown };
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.crm_access_token;
  return cookieToken ?? null;
}

/**
 * Kimlik doğrulama.
 *
 * Token'ın imzası TEK BAŞINA yeterli değildir; her istekte veritabanından
 * kullanıcı tazelenir. Böylece devre dışı bırakılan, silinen veya rolü
 * düşürülen bir kullanıcının elindeki eski token anında işlevsiz kalır
 * (token içindeki `role` claim'ine asla güvenilmez).
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) throw Unauthorized('Erişim anahtarı bulunamadı.');

  const claims = verifyAccessToken(token);

  if (await isAccessTokenRevoked(claims.jti)) {
    throw Unauthorized('Oturum sonlandırılmış.');
  }

  const user = await prisma.user.findFirst({
    where: { id: claims.sub, deletedAt: null, isActive: true },
    select: {
      id: true, email: true, name: true, role: true,
      departmentId: true, tokenVersion: true, mfaEnabled: true,
    },
  });
  if (!user) throw Unauthorized('Kullanıcı bulunamadı veya devre dışı.');

  // Şifre değişikliği / zorla çıkış tokenVersion'ı artırır.
  if (user.tokenVersion !== claims.tv) {
    throw Unauthorized('Oturum geçersiz kılınmış. Lütfen tekrar giriş yapın.');
  }

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    departmentId: user.departmentId,
    // Yetkiler DB'deki güncel rolden türetilir, token payload'ından değil.
    permissions: permissionsFor(user.role),
    mfaSatisfied: claims.mfa === true,
    jti: claims.jti,
  };

  next();
});

/**
 * MFA açık kullanıcıların yarım kalmış oturumları (mfa=false) yalnızca
 * MFA doğrulama uçlarına erişebilir. Diğer tüm rotalar bu kapıdan geçer.
 */
export function requireMfaComplete(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(Unauthorized());
  if (!req.user.mfaSatisfied) {
    return next(Forbidden('İki adımlı doğrulama tamamlanmadı.'));
  }
  next();
}
