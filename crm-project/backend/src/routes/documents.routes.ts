import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { BadRequest, NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, assertCompanyAccess, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { auditAction, writeAudit } from '../middleware/audit';

const router = Router();
router.use(authenticate, requireMfaComplete);

export const DOCUMENT_CATEGORIES = [
  'PAZAR_ANALIZI', 'ULKE_BRIFINGI', 'DIPLOMATIK_NOTA', 'PASAPORT_LISTESI',
  'SUNUM', 'SOZLESME_ORNEGI', 'TEKNIK_DOKUMAN',
  // Fuar/etkinlik sonrası ekibin hazırladığı değerlendirme raporu.
  'FUAR_SONUC_RAPORU', 'ETKINLIK_BELGESI',
  // Stratejik pazarlama ve kurumsal doküman kategorileri.
  'STRATEJIK_PAZARLAMA', 'PAZAR_ARASTIRMASI', 'HEYET_RAPORU', 'KURUMSAL_BELGE',
  // İhracat kontrolü evrakı.
  'EUC', 'IHRACAT_LISANSI',
  'DIGER',
] as const;

export const CLASSIFICATIONS = ['Tasnif Dışı', 'Hizmete Özel', 'Gizli'] as const;

// Dosya içeriği veritabanında tutulduğu için sınır dar tutulur.
// Express gövde sınırı 140 MB; base64 ~%33 şişirdiğinden net sınır 100 MB.
/**
 * Dosya boyutu üst sınırı.
 *
 * Yapay 7 MB sınırı kaldırıldı: stratejik pazarlama raporları ve brifing
 * sunumları bunu rahatlıkla aşıyor ve kullanıcı yükleyemiyordu. Sınır
 * artık gövde sınırıyla uyumlu 100 MB.
 *
 * NOT: base64 kodlama ham boyutu ~%33 şişirir, bu yüzden Express gövde
 * sınırı (bkz. app.ts) bu değerin ~1.4 katı olmalıdır.
 */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Tarayıcıda çalıştırılabilen/riskli türler bilinçli olarak kabul edilmez. */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'text/markdown',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/zip',
]);

const uploadSchema = z.object({
  title: z.string().trim().min(2).max(200),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(120),
  /** Dosya içeriği base64 (data URL öneki olmadan). */
  contentBase64: z.string().min(1),
  category: z.enum(DOCUMENT_CATEGORIES).default('DIGER'),
  description: z.string().max(4000).nullish(),
  classification: z.enum(CLASSIFICATIONS).default('Hizmete Özel'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).nullish(),
  companyId: z.string().uuid().nullish(),
  visitId: z.string().uuid().nullish(),
  activityId: z.string().uuid().nullish(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  classification: z.enum(CLASSIFICATIONS).optional(),
  companyId: z.string().uuid().optional(),
  visitId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),
  /** true → yalnızca kurumsal depo (ziyaret eki olmayanlar). */
  repositoryOnly: z.coerce.boolean().optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

/** İçerik (Bytes) hiçbir liste yanıtında taşınmaz. */
const listSelect = {
  id: true, title: true, fileName: true, mimeType: true, sizeBytes: true,
  category: true, description: true, classification: true, tags: true,
  companyId: true, visitId: true, activityId: true, createdAt: true, updatedAt: true,
  company: { select: { id: true, name: true } },
  visit: { select: { id: true, visitCode: true, title: true } },
  uploadedBy: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.DocumentFileSelect;

/** GET /api/v1/documents */
router.get(
  '/',
  requirePermission('document:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);

    const and: Prisma.DocumentFileWhereInput[] = [
      { deletedAt: null },
      // Bir kuruma bağlı belgeler o kurumun erişim kapsamını miras alır;
      // kurumsuz (genel) belgeler tüm yetkili kullanıcılara açıktır.
      { OR: [{ companyId: null }, { company: companyScope(req.user) }] },
    ];
    if (query.category) and.push({ category: query.category });
    if (query.classification) and.push({ classification: query.classification });
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.visitId) and.push({ visitId: query.visitId });
    if (query.activityId) and.push({ activityId: query.activityId });
    // Genel belge deposu: ziyarete veya etkinliğe ait ekler listelenmez,
    // onlar kendi kayıtlarının içinde görünür.
    if (query.repositoryOnly) and.push({ visitId: null, activityId: null });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { fileName: { contains: query.q, mode: 'insensitive' } },
          { description: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.DocumentFileWhereInput = { AND: and };
    const [rows, total] = await prisma.$transaction([
      prisma.documentFile.findMany({
        where, select: listSelect, orderBy: { createdAt: 'desc' },
        skip: page.skip, take: page.take,
      }),
      prisma.documentFile.count({ where }),
    ]);

    res.json(paginated(rows, total, page));
  }),
);

/** GET /api/v1/documents/stats — kategori dağılımı. */
router.get(
  '/stats',
  requirePermission('document:read'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.documentFile.groupBy({
      by: ['category'],
      where: { deletedAt: null },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });

    res.json({
      data: rows.map((r) => ({
        category: r.category,
        count: r._count._all,
        totalBytes: r._sum.sizeBytes ?? 0,
      })),
      limits: { maxFileBytes: MAX_FILE_BYTES },
    });
  }),
);

/** POST /api/v1/documents — base64 yükleme. */
router.post(
  '/',
  requirePermission('document:write'),
  validate(uploadSchema),
  auditAction('DOCUMENT_UPLOAD', 'DocumentFile'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof uploadSchema>;

    if (!ALLOWED_MIME.has(body.mimeType)) {
      throw BadRequest(
        `Bu dosya türü kabul edilmiyor: ${body.mimeType}. ` +
        'PDF, Office belgeleri, düz metin, görsel ve zip yüklenebilir.',
      );
    }

    // Data URL öneki gelirse temizlenir.
    const base64 = body.contentBase64.replace(/^data:[^;]+;base64,/, '');
    let content: Buffer;
    try {
      content = Buffer.from(base64, 'base64');
    } catch {
      throw BadRequest('Dosya içeriği çözümlenemedi.');
    }

    if (content.length === 0) throw BadRequest('Dosya boş.');
    if (content.length > MAX_FILE_BYTES) {
      throw BadRequest(
        `Dosya ${Math.round(content.length / 1024 / 1024)} MB. ` +
        `Üst sınır ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
      );
    }

    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);
    if (body.visitId) {
      const visit = await prisma.protocolVisit.findFirst({
        where: { id: body.visitId, deletedAt: null }, select: { id: true },
      });
      if (!visit) throw NotFound('Ziyaret kaydı bulunamadı.');
    }
    if (body.activityId) {
      const activity = await prisma.businessActivity.findFirst({
        where: { id: body.activityId, deletedAt: null }, select: { id: true },
      });
      if (!activity) throw NotFound('Aktivite bulunamadı.');
    }

    const document = await prisma.documentFile.create({
      data: {
        title: body.title,
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes: content.length,
        content,
        category: body.category,
        description: body.description ?? null,
        classification: body.classification,
        tags: (body.tags ?? undefined) as Prisma.InputJsonValue | undefined,
        companyId: body.companyId ?? null,
        visitId: body.visitId ?? null,
        activityId: body.activityId ?? null,
        uploadedById: req.user!.id,
      },
      select: listSelect,
    });

    req.auditContext = {
      entityType: 'DocumentFile',
      entityId: document.id,
      // İçerik denetim kaydına yazılmaz; yalnızca üst veri.
      changes: { title: body.title, fileName: body.fileName, sizeBytes: content.length },
    };

    res.status(201).json(document);
  }),
);

/** GET /api/v1/documents/:id/download */
router.get(
  '/:id/download',
  requirePermission('document:read'),
  asyncHandler(async (req, res) => {
    const document = await prisma.documentFile.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        OR: [{ companyId: null }, { company: companyScope(req.user) }],
      },
    });
    if (!document) throw NotFound('Belge bulunamadı.');

    // Gizlilik dereceli evrakın kim tarafından indirildiği kayda geçer.
    await writeAudit({
      req, action: 'DOCUMENT_DOWNLOAD', entityType: 'DocumentFile',
      entityId: document.id,
      changes: { fileName: document.fileName, classification: document.classification },
      statusCode: 200,
    });

    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Length', String(document.sizeBytes));
    // `attachment`: tarayıcıda çalıştırılmasın, indirilsin.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(document.fileName)}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');

    res.end(Buffer.from(document.content));
  }),
);

const updateSchema = uploadSchema
  .omit({ contentBase64: true, fileName: true, mimeType: true })
  .partial();

/** PUT /api/v1/documents/:id — yalnızca üst veri güncellenir. */
router.put(
  '/:id',
  requirePermission('document:write'),
  validate(updateSchema),
  auditAction('DOCUMENT_UPDATE', 'DocumentFile'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.documentFile.findFirst({
      where: { id, deletedAt: null }, select: { id: true },
    });
    if (!existing) throw NotFound('Belge bulunamadı.');

    const body = req.body as z.infer<typeof updateSchema>;
    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);

    const document = await prisma.documentFile.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.classification !== undefined ? { classification: body.classification } : {}),
        ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        ...(body.visitId !== undefined ? { visitId: body.visitId } : {}),
        ...(body.activityId !== undefined ? { activityId: body.activityId } : {}),
        ...(body.tags !== undefined
          ? { tags: (body.tags ?? Prisma.DbNull) as Prisma.InputJsonValue }
          : {}),
      },
      select: listSelect,
    });

    res.json(document);
  }),
);

/** DELETE /api/v1/documents/:id */
router.delete(
  '/:id',
  requirePermission('document:delete'),
  auditAction('DOCUMENT_DELETE', 'DocumentFile'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.documentFile.findFirst({
      where: { id, deletedAt: null }, select: { id: true },
    });
    if (!existing) throw NotFound('Belge bulunamadı.');
    await prisma.documentFile.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  }),
);

export default router;
