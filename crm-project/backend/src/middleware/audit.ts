import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

const SENSITIVE_KEYS = new Set([
  'password', 'newPassword', 'currentPassword', 'passwordHash',
  'mfaSecret', 'token', 'refreshToken', 'accessToken', 'code', 'totp',
  'mfaRecoveryHash', 'recoveryCodes',
]);

/** Denetim kaydına hassas alanlar asla ham yazılmaz. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim();
  return req.socket.remoteAddress ?? undefined;
}

export interface AuditInput {
  req: Request;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: unknown;
  statusCode?: number;
}

/** Doğrudan çağrılan denetim yazıcısı. Log yazımı iş akışını bloklamaz. */
export async function writeAudit(input: AuditInput): Promise<void> {
  const { req, action, entityType, entityId, changes, statusCode } = input;
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? null,
        userEmail: req.user?.email ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        changes: changes === undefined
          ? undefined
          : (redact(changes) as Prisma.InputJsonValue),
        ip: clientIp(req),
        userAgent: req.headers['user-agent']?.slice(0, 500),
        statusCode: statusCode ?? null,
      },
    });
  } catch (error) {
    // Denetim yazımı başarısız olursa istek düşmez, ancak sessiz de kalmaz.
    console.error('[audit] kayıt yazılamadı:', error);
  }
}

/**
 * Mutasyon rotalarını saran otomatik denetim middleware'i.
 * Yanıt gönderildikten sonra (finish) çalışır; yalnızca 2xx sonuçları
 * "gerçekleşmiş işlem" olarak kaydedilir, hatalar ayrıca statusCode ile yazılır.
 */
export function auditAction(action: string, entityType: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      const entityId =
        req.auditContext?.entityId ??
        (typeof req.params.id === 'string' ? req.params.id : undefined);
      void writeAudit({
        req,
        action,
        entityType: req.auditContext?.entityType ?? entityType,
        entityId,
        changes: req.auditContext?.changes ?? (Object.keys(req.body ?? {}).length ? req.body : undefined),
        statusCode: res.statusCode,
      });
    });
    next();
  };
}
