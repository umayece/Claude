import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { requirePermission } from '../middleware/rbac';
import { backupLimiter } from '../middleware/rateLimit';
import { writeAudit } from '../middleware/audit';
import { env } from '../lib/env';
import { getRates } from '../services/currency.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

/**
 * GET /api/v1/system/backup
 *
 * Tüm CRM verisini tek JSON dökümü olarak indirir. Yalnızca ADMIN.
 *
 * Dışa aktarımdan HASSAS ALANLAR ÇIKARILIR: şifre özetleri, MFA gizli
 * anahtarları, kurtarma kodu özetleri ve yenileme anahtarları dökümde yer
 * almaz — yedek dosyası sızarsa kimlik doğrulama sırları ele geçmemelidir.
 *
 * Yanıt akış olarak yazılır; büyük veri setinde tüm JSON'u bellekte
 * toplamak süreç belleğini şişirir.
 */
router.get(
  '/backup',
  requireRole('ADMIN'),
  requirePermission('system:backup'),
  backupLimiter,
  asyncHandler(async (req, res) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mke-crm-backup-${stamp}.json"`);
    res.setHeader('Cache-Control', 'no-store');

    const write = (chunk: string) => res.write(chunk);
    const CHUNK = 500;

    write('{\n');
    write(`  "meta": ${JSON.stringify({
      exportedAt: new Date().toISOString(),
      exportedBy: req.user!.email,
      schemaVersion: 1,
      application: 'MKE CRM',
      environment: env.nodeEnv,
      note: 'Kimlik doğrulama sırları (şifre özeti, MFA anahtarı, token) bilinçli olarak dışarıda bırakılmıştır.',
    })},\n`);

    /** Bir tabloyu sayfa sayfa okuyup JSON dizisi olarak akışa yazar. */
    async function dump<T>(
      key: string,
      fetchPage: (skip: number, take: number) => Promise<T[]>,
      isLast = false,
    ): Promise<void> {
      write(`  "${key}": [`);
      let skip = 0;
      let first = true;
      for (;;) {
        const rows = await fetchPage(skip, CHUNK);
        if (rows.length === 0) break;
        for (const row of rows) {
          write(first ? '\n    ' : ',\n    ');
          write(JSON.stringify(row));
          first = false;
        }
        if (rows.length < CHUNK) break;
        skip += CHUNK;
      }
      write(first ? ']' : '\n  ]');
      write(isLast ? '\n' : ',\n');
    }

    const order = { id: 'asc' } as const;

    await dump('departments', (skip, take) =>
      prisma.department.findMany({ skip, take, orderBy: order }));

    await dump('users', (skip, take) =>
      prisma.user.findMany({
        skip, take, orderBy: order,
        // Sır taşıyan sütunlar seçilmez.
        select: {
          id: true, email: true, name: true, role: true, departmentId: true,
          phone: true, avatarUrl: true, secondaryEmails: true,
          calendarFilterPreferences: true, isActive: true, mfaEnabled: true,
          lastLoginAt: true, createdAt: true, updatedAt: true, deletedAt: true,
        },
      }));

    await dump('cities', (skip, take) => prisma.city.findMany({ skip, take, orderBy: order }));
    await dump('companies', (skip, take) => prisma.company.findMany({ skip, take, orderBy: order }));
    await dump('contacts', (skip, take) => prisma.contact.findMany({ skip, take, orderBy: order }));
    await dump('contactPhones', (skip, take) => prisma.contactPhone.findMany({ skip, take, orderBy: order }));
    await dump('deals', (skip, take) => prisma.deal.findMany({ skip, take, orderBy: order }));
    await dump('offers', (skip, take) => prisma.offer.findMany({ skip, take, orderBy: order }));
    await dump('offerItems', (skip, take) => prisma.offerItem.findMany({ skip, take, orderBy: order }));
    await dump('tenders', (skip, take) => prisma.tender.findMany({ skip, take, orderBy: order }));
    await dump('contracts', (skip, take) => prisma.contract.findMany({ skip, take, orderBy: order }));
    await dump('paymentMilestones', (skip, take) => prisma.paymentMilestone.findMany({ skip, take, orderBy: order }));
    await dump('products', (skip, take) => prisma.product.findMany({ skip, take, orderBy: order }));
    await dump('tickets', (skip, take) => prisma.ticket.findMany({ skip, take, orderBy: order }));
    await dump('tasks', (skip, take) => prisma.task.findMany({ skip, take, orderBy: order }));
    await dump('notes', (skip, take) => prisma.note.findMany({ skip, take, orderBy: order }));
    await dump('activities', (skip, take) => prisma.activity.findMany({ skip, take, orderBy: order }));
    await dump('emails', (skip, take) => prisma.emailQueue.findMany({ skip, take, orderBy: order }));
    await dump('customFieldDefinitions', (skip, take) =>
      prisma.customFieldDefinition.findMany({ skip, take, orderBy: order }));
    await dump('exchangeRates', (skip, take) =>
      prisma.exchangeRateCache.findMany({ skip, take, orderBy: { code: 'asc' } }), true);

    write('}\n');
    res.end();

    await writeAudit({
      req, action: 'SYSTEM_BACKUP', entityType: 'System', statusCode: 200,
    });
  }),
);

/** GET /api/v1/system/health — kimlik doğrulamalı derin sağlık kontrolü. */
router.get(
  '/health',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const started = Date.now();
    let database = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }

    const rates = await getRates().catch(() => []);
    const nonBase = rates.filter((r) => r.code !== 'TRY');

    res.json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      databaseLatencyMs: Date.now() - started,
      uptimeSeconds: Math.round(process.uptime()),
      environment: env.nodeEnv,
      backgroundJobs: env.enableBackgroundJobs,
      exchangeRates: {
        loaded: nonBase.length,
        lastUpdatedAt: nonBase.length
          ? nonBase.reduce((min, r) => (r.updatedAt < min ? r.updatedAt : min), nonBase[0]!.updatedAt)
          : null,
      },
      trashRetentionDays: env.trashRetentionDays,
    });
  }),
);

/** GET /api/v1/system/stats — kayıt sayıları. */
router.get(
  '/stats',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const [companies, trashedCompanies, contacts, deals, tenders, contracts, products, tickets, tasks, auditLogs] =
      await prisma.$transaction([
        prisma.company.count({ where: { deletedAt: null } }),
        prisma.company.count({ where: { deletedAt: { not: null } } }),
        prisma.contact.count({ where: { deletedAt: null } }),
        prisma.deal.count({ where: { deletedAt: null } }),
        prisma.tender.count({ where: { deletedAt: null } }),
        prisma.contract.count({ where: { deletedAt: null } }),
        prisma.product.count({ where: { deletedAt: null } }),
        prisma.ticket.count({ where: { deletedAt: null } }),
        prisma.task.count({ where: { deletedAt: null } }),
        prisma.auditLog.count(),
      ]);

    res.json({
      companies, trashedCompanies, contacts, deals, tenders,
      contracts, products, tickets, tasks, auditLogs,
    });
  }),
);

export default router;
