import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { BadRequest, Unauthorized } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import {
  sha256, signAccessToken, signRefreshToken, revokeAccessToken,
  verifyAccessToken, verifyRefreshToken,
} from '../utils/jwt';
import { assertPasswordStrength, burnTiming, hashPassword, verifyPassword } from '../utils/password';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginLimiter } from '../middleware/rateLimit';
import { writeAudit } from '../middleware/audit';
import { permissionsFor } from '../middleware/permissions';

const router = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi giriniz.').max(255),
  password: z.string().min(1, 'Şifre zorunludur.').max(200),
});

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: REFRESH_TTL_MS,
  };
}

/**
 * POST /api/v1/auth/login
 *
 * Kaba kuvvet savunması iki katmanlı: IP+hesap bazlı hız sınırı (middleware)
 * ve kalıcı hesap kilidi (DB). Hatalı e-posta durumunda da bcrypt maliyeti
 * ödenir; aksi halde yanıt süresi "bu e-posta kayıtlı mı" sorusunu yanıtlar.
 */
router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });

    if (!user) {
      await burnTiming();
      await writeAudit({ req, action: 'LOGIN_FAILED', entityType: 'User', changes: { email } });
      throw Unauthorized('E-posta veya şifre hatalı.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const seconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw Unauthorized(`Hesap geçici olarak kilitli. ${seconds} saniye sonra tekrar deneyin.`);
    }

    if (!user.isActive) {
      await burnTiming();
      throw Unauthorized('Hesabınız devre dışı bırakılmış.');
    }

    const ok = await verifyPassword(password, user.passwordHash);

    if (!ok) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await writeAudit({
        req, action: shouldLock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        entityType: 'User', entityId: user.id, changes: { attempts },
      });
      throw Unauthorized('E-posta veya şifre hatalı.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // MFA açıksa bu aşamada verilen token MFA'sız (mfa=false) bir "yarım"
    // token'dır; requireMfaComplete dışındaki tüm rotalarda reddedilir.
    const mfaSatisfied = !user.mfaEnabled;
    const { token: accessToken } = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      tokenVersion: user.tokenVersion,
      mfaSatisfied,
    });

    // MFA bekleyen oturuma refresh anahtarı verilmez; ancak MFA doğrulandıktan
    // sonra /mfa/verify kalıcı oturumu açar.
    if (mfaSatisfied) {
      const refreshToken = await issueRefresh(
        user.id, user.tokenVersion, req.headers['user-agent'], req.ip,
      );
      res.cookie('crm_refresh_token', refreshToken, refreshCookieOptions());
    }

    await writeAudit({ req, action: 'LOGIN_SUCCESS', entityType: 'User', entityId: user.id });

    res.json({
      accessToken,
      mfaRequired: user.mfaEnabled,
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        departmentId: user.departmentId, avatarUrl: user.avatarUrl,
        permissions: mfaSatisfied ? permissionsFor(user.role) : [],
      },
    });
  }),
);

async function issueRefresh(
  userId: string,
  tokenVersion: number,
  userAgent?: string,
  ip?: string,
): Promise<string> {
  const { token } = signRefreshToken(userId, tokenVersion);
  await prisma.refreshToken.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: userAgent?.slice(0, 500) ?? null,
      ip: ip ?? null,
    },
  });
  return token;
}

export { issueRefresh, refreshCookieOptions, REFRESH_TTL_MS };

/**
 * POST /api/v1/auth/refresh
 *
 * Yenileme anahtarı tek kullanımlıktır (rotation): kullanılan kayıt
 * revokedAt ile kapatılır ve yenisi verilir. Aynı anahtar ikinci kez
 * gelirse yeniden kullanım tespit edilmiş demektir — kullanıcının TÜM
 * oturumları tokenVersion artırılarak düşürülür.
 */
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = (req.cookies as Record<string, string> | undefined)?.crm_refresh_token
      ?? (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null);
    if (!raw) throw Unauthorized('Yenileme anahtarı bulunamadı.');

    const claims = verifyRefreshToken(raw);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });

    if (!stored) throw Unauthorized('Yenileme anahtarı tanınmıyor.');

    if (stored.revokedAt) {
      await prisma.user.update({
        where: { id: stored.userId },
        data: { tokenVersion: { increment: 1 } },
      });
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeAudit({
        req, action: 'REFRESH_REUSE_DETECTED', entityType: 'User', entityId: stored.userId,
      });
      throw Unauthorized('Yenileme anahtarı yeniden kullanıldı; tüm oturumlar kapatıldı.');
    }

    if (stored.expiresAt < new Date()) throw Unauthorized('Yenileme anahtarının süresi dolmuş.');

    const user = await prisma.user.findFirst({
      where: { id: claims.sub, deletedAt: null, isActive: true },
    });
    if (!user) throw Unauthorized('Kullanıcı bulunamadı.');
    if (user.tokenVersion !== claims.tv) throw Unauthorized('Oturum geçersiz kılınmış.');

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const nextRefresh = await issueRefresh(user.id, user.tokenVersion, req.headers['user-agent'], req.ip);
    res.cookie('crm_refresh_token', nextRefresh, refreshCookieOptions());

    const { token: accessToken } = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      tokenVersion: user.tokenVersion,
      mfaSatisfied: true,
    });

    res.json({ accessToken });
  }),
);

/** POST /api/v1/auth/logout — access token kara listeye alınır, refresh iptal edilir. */
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        await revokeAccessToken(verifyAccessToken(header.slice(7)));
      } catch {
        // Süresi dolmuş token için ek işlem gerekmez.
      }
    }
    const raw = (req.cookies as Record<string, string> | undefined)?.crm_refresh_token;
    if (raw) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(raw), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.clearCookie('crm_refresh_token', { ...refreshCookieOptions(), maxAge: undefined });
    res.json({ success: true });
  }),
);

/** POST /api/v1/auth/logout-all — tüm cihazlardan çıkış. */
router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
      prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await writeAudit({ req, action: 'LOGOUT_ALL', entityType: 'User', entityId: userId });
    res.clearCookie('crm_refresh_token', { ...refreshCookieOptions(), maxAge: undefined });
    res.json({ success: true });
  }),
);

/** GET /api/v1/auth/me */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: {
        id: true, email: true, name: true, role: true, phone: true, avatarUrl: true,
        departmentId: true, mfaEnabled: true, secondaryEmails: true,
        calendarFilterPreferences: true, lastLoginAt: true,
        department: { select: { id: true, name: true } },
      },
    });
    res.json({ ...user, permissions: req.user!.permissions, mfaSatisfied: req.user!.mfaSatisfied });
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

/**
 * POST /api/v1/auth/change-password
 * Şifre değişimi tokenVersion'ı artırır: çalınmış bir token şifre
 * değiştirildiği anda ölür.
 */
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      await writeAudit({ req, action: 'PASSWORD_CHANGE_FAILED', entityType: 'User', entityId: user.id });
      throw Unauthorized('Mevcut şifre hatalı.');
    }
    if (currentPassword === newPassword) {
      throw BadRequest('Yeni şifre mevcut şifreyle aynı olamaz.');
    }
    assertPasswordStrength(newPassword);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(newPassword),
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await writeAudit({ req, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id });
    res.clearCookie('crm_refresh_token', { ...refreshCookieOptions(), maxAge: undefined });
    res.json({ success: true, message: 'Şifre güncellendi. Lütfen tekrar giriş yapın.' });
  }),
);

export default router;
