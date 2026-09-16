import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';

function keyFromIpAndAccount(req: Request): string {
  const ip = req.ip ?? 'unknown';
  const account =
    typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : req.user?.id ?? '';
  return `${ip}|${account}`;
}

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Çok fazla deneme yapıldı, lütfen bekleyin.' } },
};

/** Genel API sınırı — kaba kuvvet ve tarama trafiğini törpüler. */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 300,
});

/**
 * Giriş uçları: IP + hesap bileşik anahtarı.
 * Yalnızca IP'ye bakan bir limit, tek IP arkasındaki ofisi kilitler;
 * yalnızca hesaba bakan bir limit dağıtık kaba kuvveti kaçırır.
 */
export const loginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: keyFromIpAndAccount,
  skipSuccessfulRequests: true,
});

/** MFA kodu 6 haneli; brute-force penceresi dar tutulur. */
export const mfaLimiter = rateLimit({
  ...shared,
  windowMs: 10 * 60_000,
  limit: 6,
  keyGenerator: keyFromIpAndAccount,
  skipSuccessfulRequests: true,
});

/** AI uçları model maliyeti taşır; kullanıcı başına sınırlanır. */
export const aiLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 20,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonymous',
});

/** Yedekleme uçları ağır; saatlik sınır. */
export const backupLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60_000,
  limit: 5,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonymous',
});
