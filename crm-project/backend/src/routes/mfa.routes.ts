import crypto from 'node:crypto';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { BadRequest, Unauthorized } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { signAccessToken } from '../utils/jwt';
import { verifyPassword } from '../utils/password';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { mfaLimiter } from '../middleware/rateLimit';
import { writeAudit } from '../middleware/audit';
import { permissionsFor } from '../middleware/permissions';
import { issueRefresh, refreshCookieOptions } from './auth.routes';

const router = Router();

// TOTP penceresi bilinçli olarak dar: 1 adım geri + 1 adım ileri (±30 sn).
// Geniş pencere, 6 haneli kodun etkin arama uzayını büyütür.
authenticator.options = { window: 1, step: 30 };

const ISSUER = 'MKE CRM';
const RECOVERY_CODE_COUNT = 8;

function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'),
  );
}

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Doğrulama kodu 6 haneli olmalıdır.'),
});

/**
 * POST /api/v1/mfa/setup
 * Gizli anahtar üretir ama HENÜZ etkinleştirmez — kullanıcı geçerli bir kod
 * göstermeden MFA açılmaz, aksi halde kendini kilitleyebilir.
 */
router.post(
  '/setup',
  authenticate,
  requireMfaComplete,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.mfaEnabled) throw BadRequest('İki adımlı doğrulama zaten etkin.');

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, ISSUER, secret);

    // Doğrulanana kadar saklanır; mfaEnabled false kaldığı sürece
    // bu anahtar tek başına giriş yetkisi vermez.
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: secret } });

    res.json({
      secret,
      otpauthUrl: otpauth,
      qrCodeDataUrl: await QRCode.toDataURL(otpauth),
    });
  }),
);

/** POST /api/v1/mfa/enable — kodu doğrula, MFA'yı aç, kurtarma kodlarını bir kez göster. */
router.post(
  '/enable',
  authenticate,
  requireMfaComplete,
  mfaLimiter,
  validate(codeSchema),
  asyncHandler(async (req, res) => {
    const { code } = req.body as z.infer<typeof codeSchema>;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

    if (user.mfaEnabled) throw BadRequest('İki adımlı doğrulama zaten etkin.');
    if (!user.mfaSecret) throw BadRequest('Önce /mfa/setup çağrılmalıdır.');
    if (!authenticator.verify({ token: code, secret: user.mfaSecret })) {
      await writeAudit({ req, action: 'MFA_ENABLE_FAILED', entityType: 'User', entityId: user.id });
      throw Unauthorized('Doğrulama kodu hatalı.');
    }

    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map((c) => bcrypt.hash(c, 10)));

    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaRecoveryHash: hashes, tokenVersion: { increment: 1 } },
    });

    await writeAudit({ req, action: 'MFA_ENABLED', entityType: 'User', entityId: user.id });

    res.json({
      success: true,
      // Kurtarma kodları yalnızca burada, bir kez düz metin döner.
      recoveryCodes,
      message: 'Kurtarma kodlarını güvenli bir yerde saklayın; tekrar gösterilmeyecek.',
    });
  }),
);

const verifySchema = z.object({
  code: z.string().min(6).max(20),
});

/**
 * POST /api/v1/mfa/verify
 * Giriş akışının ikinci adımı. `authenticate` geçer ama
 * `requireMfaComplete` UYGULANMAZ — bu uç zaten yarım token'ı tamamlamak içindir.
 */
router.post(
  '/verify',
  authenticate,
  mfaLimiter,
  validate(verifySchema),
  asyncHandler(async (req, res) => {
    const { code } = req.body as z.infer<typeof verifySchema>;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

    if (!user.mfaEnabled || !user.mfaSecret) throw BadRequest('İki adımlı doğrulama etkin değil.');

    let ok = /^\d{6}$/.test(code) && authenticator.verify({ token: code, secret: user.mfaSecret });
    let usedRecovery = false;

    // TOTP tutmadıysa kurtarma kodlarına bak. Eşleşen kod TÜKETİLİR.
    if (!ok && Array.isArray(user.mfaRecoveryHash)) {
      const hashes = user.mfaRecoveryHash as string[];
      for (let i = 0; i < hashes.length; i += 1) {
        const hash = hashes[i];
        if (typeof hash === 'string' && (await bcrypt.compare(code.trim().toUpperCase(), hash))) {
          const remaining = hashes.filter((_, index) => index !== i);
          await prisma.user.update({
            where: { id: user.id },
            data: { mfaRecoveryHash: remaining },
          });
          ok = true;
          usedRecovery = true;
          break;
        }
      }
    }

    if (!ok) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= 5;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60_000) : null,
        },
      });
      await writeAudit({ req, action: 'MFA_VERIFY_FAILED', entityType: 'User', entityId: user.id });
      throw Unauthorized('Doğrulama kodu hatalı.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const { token: accessToken } = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      tokenVersion: user.tokenVersion,
      mfaSatisfied: true,
    });

    const refreshToken = await issueRefresh(
      user.id, user.tokenVersion, req.headers['user-agent'], req.ip,
    );
    res.cookie('crm_refresh_token', refreshToken, refreshCookieOptions());

    await writeAudit({
      req, action: usedRecovery ? 'MFA_RECOVERY_USED' : 'MFA_VERIFIED',
      entityType: 'User', entityId: user.id,
    });

    res.json({
      accessToken,
      usedRecoveryCode: usedRecovery,
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        departmentId: user.departmentId, avatarUrl: user.avatarUrl,
        permissions: permissionsFor(user.role),
      },
    });
  }),
);

const disableSchema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().regex(/^\d{6}$/),
});

/** POST /api/v1/mfa/disable — hem şifre hem geçerli TOTP ister. */
router.post(
  '/disable',
  authenticate,
  requireMfaComplete,
  mfaLimiter,
  validate(disableSchema),
  asyncHandler(async (req, res) => {
    const { password, code } = req.body as z.infer<typeof disableSchema>;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

    if (!user.mfaEnabled || !user.mfaSecret) throw BadRequest('İki adımlı doğrulama etkin değil.');
    if (!(await verifyPassword(password, user.passwordHash))) throw Unauthorized('Şifre hatalı.');
    if (!authenticator.verify({ token: code, secret: user.mfaSecret })) {
      throw Unauthorized('Doğrulama kodu hatalı.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        // `undefined` Prisma'da "bu alana dokunma" demektir; kurtarma
        // kodlarını gerçekten silmek için DbNull gerekir.
        mfaRecoveryHash: Prisma.DbNull,
        tokenVersion: { increment: 1 },
      },
    });

    await writeAudit({ req, action: 'MFA_DISABLED', entityType: 'User', entityId: user.id });
    res.json({ success: true, message: 'İki adımlı doğrulama kapatıldı. Lütfen tekrar giriş yapın.' });
  }),
);

/** GET /api/v1/mfa/status */
router.get(
  '/status',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { mfaEnabled: true, mfaRecoveryHash: true },
    });
    res.json({
      mfaEnabled: user.mfaEnabled,
      mfaSatisfied: req.user!.mfaSatisfied,
      remainingRecoveryCodes: Array.isArray(user.mfaRecoveryHash) ? user.mfaRecoveryHash.length : 0,
    });
  }),
);

export default router;
