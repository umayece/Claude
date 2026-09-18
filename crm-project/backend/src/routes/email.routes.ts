import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, assertCompanyAccess, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { auditAction } from '../middleware/audit';
import { logActivity } from '../services/activity.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

/**
 * Yerel E-Posta Simülatörü.
 *
 * Kurumun henüz SMTP sunucusu olmadığı için gönderim gerçekten YAPILMAZ:
 * mesaj EmailQueue tablosuna SENT olarak yazılır ve müşteri/kişi zaman
 * tüneline "E-Posta Gönderildi" aktivitesi olarak düşer. Gerçek SMTP
 * devreye girdiğinde yalnızca `deliver()` gövdesi değiştirilecektir.
 */
const PROVIDER = 'LOCAL_SIMULATOR';

const sendSchema = z.object({
  to: z.string().trim().email('Geçerli bir alıcı adresi giriniz.').max(255),
  cc: z.string().trim().max(1000).nullish(),
  subject: z.string().trim().min(1, 'Konu zorunludur.').max(300),
  bodyHtml: z.string().min(1, 'E-posta gövdesi boş olamaz.').max(500_000),
  bodyText: z.string().max(500_000).nullish(),
  companyId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
});

const outboxQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  status: z.enum(['QUEUED', 'SENT', 'FAILED']).optional(),
});
type OutboxQuery = z.infer<typeof outboxQuerySchema>;

/** HTML gövdeden düz metin türetir (önizleme ve arama için). */
function toPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** POST /api/v1/email/send */
router.post(
  '/send',
  requirePermission('email:send'),
  validate(sendSchema),
  auditAction('EMAIL_SEND', 'EmailQueue'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof sendSchema>;

    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);

    // Kişi verildiyse şirketiyle tutarlılığı doğrulanır; aksi halde
    // bir kullanıcı erişemediği şirketin zaman tüneline kayıt düşürebilir.
    let resolvedCompanyId = body.companyId ?? null;
    if (body.contactId) {
      const contact = await prisma.contact.findFirst({
        where: {
          id: body.contactId, deletedAt: null,
          OR: [{ companyId: null }, { company: companyScope(req.user) }],
        },
        select: { id: true, companyId: true, firstName: true, lastName: true },
      });
      if (!contact) throw NotFound('Kişi bulunamadı.');
      resolvedCompanyId ??= contact.companyId;
    }

    const record = await prisma.emailQueue.create({
      data: {
        toAddress: body.to,
        ccAddress: body.cc ?? null,
        subject: body.subject,
        bodyHtml: body.bodyHtml,
        bodyText: body.bodyText ?? toPlainText(body.bodyHtml),
        status: 'SENT',
        provider: PROVIDER,
        companyId: resolvedCompanyId,
        contactId: body.contactId ?? null,
        userId: req.user!.id,
        sentAt: new Date(),
      },
    });

    await logActivity({
      type: 'EMAIL',
      title: `E-Posta Gönderildi: ${body.subject}`,
      body: (record.bodyText ?? '').slice(0, 1000),
      companyId: resolvedCompanyId,
      contactId: body.contactId ?? null,
      userId: req.user!.id,
      metadata: { to: body.to, cc: body.cc ?? null, emailId: record.id, provider: PROVIDER },
    });

    req.auditContext = { entityType: 'EmailQueue', entityId: record.id };

    res.status(201).json({
      ...record,
      simulated: true,
      message: 'E-posta yerel simülatöre kaydedildi ve zaman tüneline işlendi.',
    });
  }),
);

/** GET /api/v1/email/outbox */
router.get(
  '/outbox',
  requirePermission('email:read'),
  validate(outboxQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<OutboxQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);

    const and: Prisma.EmailQueueWhereInput[] = [
      // Şirketsiz (serbest) gönderimleri yalnızca gönderen görür.
      {
        OR: [
          { company: companyScope(req.user) },
          { companyId: null, userId: req.user!.id },
        ],
      },
    ];
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.contactId) and.push({ contactId: query.contactId });
    if (query.status) and.push({ status: query.status });
    if (query.q) {
      and.push({
        OR: [
          { subject: { contains: query.q, mode: 'insensitive' } },
          { toAddress: { contains: query.q, mode: 'insensitive' } },
          { bodyText: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.EmailQueueWhereInput = { AND: and };
    const [rows, total] = await prisma.$transaction([
      prisma.emailQueue.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: {
          id: true, toAddress: true, ccAddress: true, subject: true, status: true,
          provider: true, sentAt: true, createdAt: true, errorText: true,
          // Liste yanıtında tam HTML taşınmaz; önizleme yeterlidir.
          bodyText: true,
          company: { select: { id: true, name: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.emailQueue.count({ where }),
    ]);

    res.json(
      paginated(
        rows.map((row) => ({
          ...row,
          preview: (row.bodyText ?? '').slice(0, 240),
          bodyText: undefined,
        })),
        total,
        page,
      ),
    );
  }),
);

/** GET /api/v1/email/:id — tam gövde. */
router.get(
  '/:id',
  requirePermission('email:read'),
  asyncHandler(async (req, res) => {
    const email = await prisma.emailQueue.findFirst({
      where: {
        id: req.params.id,
        OR: [{ company: companyScope(req.user) }, { companyId: null, userId: req.user!.id }],
      },
      include: {
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        user: { select: { id: true, name: true } },
      },
    });
    if (!email) throw NotFound('E-posta kaydı bulunamadı.');
    res.json(email);
  }),
);

export default router;
