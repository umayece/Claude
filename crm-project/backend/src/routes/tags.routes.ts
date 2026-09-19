/**
 * Etiket yönetimi.
 *
 * Etiketin kendisi ile etiketin BAĞLARI ayrı kaynaklardır:
 * - `/tags` etiketleri yönetir (oluştur, yeniden adlandır, renklendir, sil),
 * - `/tags/:id/records` o etikete sahip kayıtları listeler,
 * - `/tags/:id/company/:companyId` tek bir bağı koparır.
 *
 * Bu ayrım sayesinde kullanıcı etiketi bir kayıttan kaldırmak için o kaydın
 * kendi sayfasına gitmek zorunda kalmaz.
 */
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { Conflict, NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { auditAction } from '../middleware/audit';

const router = Router();
router.use(authenticate, requireMfaComplete);

const tagBodySchema = z.object({
  name: z.string().trim().min(1, 'Etiket adı zorunludur.').max(60),
  /** Hex renk; rozet arka planı buradan gelir. */
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Renk #RRGGBB olmalıdır.')
    .default('#C5A059'),
  description: z.string().trim().max(500).nullish(),
});

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

/** GET /api/v1/tags — etiketler + kullanım sayıları. */
router.get(
  '/',
  requirePermission('company:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);

    const tags = await prisma.tag.findMany({
      where: query.q
        ? { name: { contains: query.q, mode: 'insensitive' } }
        : undefined,
      orderBy: { name: 'asc' },
      include: { _count: { select: { companies: true, contacts: true } } },
    });

    res.json({
      data: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        description: tag.description,
        companyCount: tag._count.companies,
        contactCount: tag._count.contacts,
        totalCount: tag._count.companies + tag._count.contacts,
        createdAt: tag.createdAt,
      })),
    });
  }),
);

/**
 * GET /api/v1/tags/:id/records — etikete bağlı kurum ve kişiler.
 *
 * Kurum kapsamı burada da uygulanır: kullanıcı erişemediği bir kurumu
 * etiket üzerinden görmemeli, aksi halde etiket sayfası bir yan kanal olur.
 */
router.get(
  '/:id/records',
  requirePermission('company:read'),
  asyncHandler(async (req, res) => {
    const tagId = String(req.params.id);
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw NotFound('Etiket bulunamadı.');

    const scope = companyScope(req.user);

    const [companies, contacts] = await Promise.all([
      prisma.companyTag.findMany({
        where: { tagId, company: { deletedAt: null, ...scope } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          company: {
            select: {
              id: true, name: true, type: true, status: true,
              country: true, countryCode: true,
            },
          },
        },
      }),
      prisma.contactTag.findMany({
        where: {
          tagId,
          contact: {
            deletedAt: null,
            // Bağımsız kişi hiçbir departmana ait değildir; kapsam ona uygulanmaz.
            OR: [{ companyId: null }, { company: scope }],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          contact: {
            select: {
              id: true, firstName: true, lastName: true, title: true,
              contactType: true, country: true,
              company: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    res.json({
      tag,
      companies: companies.map((row) => row.company),
      contacts: contacts.map((row) => row.contact),
    });
  }),
);

/** POST /api/v1/tags */
router.post(
  '/',
  requirePermission('company:write'),
  validate(tagBodySchema),
  auditAction('TAG_CREATE', 'Tag'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof tagBodySchema>;

    const exists = await prisma.tag.findUnique({ where: { name: body.name } });
    if (exists) throw Conflict('Bu adda bir etiket zaten var.');

    const tag = await prisma.tag.create({
      data: { name: body.name, color: body.color, description: body.description ?? null },
    });
    req.auditContext = { entityType: 'Tag', entityId: tag.id };
    res.status(201).json(tag);
  }),
);

/** PUT /api/v1/tags/:id — yeniden adlandırma ve renk değişikliği. */
router.put(
  '/:id',
  requirePermission('company:write'),
  validate(tagBodySchema.partial()),
  auditAction('TAG_UPDATE', 'Tag'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) throw NotFound('Etiket bulunamadı.');

    const body = req.body as Partial<z.infer<typeof tagBodySchema>>;

    // Yeniden adlandırma çakışması: aynı adı taşıyan BAŞKA bir etiket varsa
    // birleştirme kullanıcının kararıdır, sessizce yapılmaz.
    if (body.name && body.name !== existing.name) {
      const clash = await prisma.tag.findUnique({ where: { name: body.name } });
      if (clash) throw Conflict('Bu adda bir etiket zaten var.');
    }

    const tag = await prisma.tag.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
    });
    res.json(tag);
  }),
);

/** DELETE /api/v1/tags/:id — etiketi ve tüm bağlarını siler. */
router.delete(
  '/:id',
  requirePermission('company:write'),
  auditAction('TAG_DELETE', 'Tag'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) throw NotFound('Etiket bulunamadı.');

    // Bağlar `onDelete: Cascade` ile gider; kurum ve kişi kayıtları kalır.
    await prisma.tag.delete({ where: { id } });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Bağlar
// ---------------------------------------------------------------------------

const attachSchema = z.object({
  companyIds: z.array(z.string().uuid()).max(500).default([]),
  contactIds: z.array(z.string().uuid()).max(500).default([]),
});

/** POST /api/v1/tags/:id/attach — toplu etiketleme. */
router.post(
  '/:id/attach',
  requirePermission('company:write'),
  validate(attachSchema),
  auditAction('TAG_ATTACH', 'Tag'),
  asyncHandler(async (req, res) => {
    const tagId = String(req.params.id);
    const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { id: true } });
    if (!tag) throw NotFound('Etiket bulunamadı.');

    const body = req.body as z.infer<typeof attachSchema>;
    const scope = companyScope(req.user);

    // Kullanıcının erişemediği kayıtlar sessizce elenir: erişilemeyen bir
    // kimliğe 403 dönmek o kaydın varlığını sızdırırdı.
    const [companies, contacts] = await Promise.all([
      body.companyIds.length
        ? prisma.company.findMany({
          where: { id: { in: body.companyIds }, deletedAt: null, ...scope },
          select: { id: true },
        })
        : Promise.resolve([]),
      body.contactIds.length
        ? prisma.contact.findMany({
          where: {
            id: { in: body.contactIds },
            deletedAt: null,
            OR: [{ companyId: null }, { company: scope }],
          },
          select: { id: true },
        })
        : Promise.resolve([]),
    ]);

    await prisma.$transaction([
      prisma.companyTag.createMany({
        data: companies.map((c) => ({ companyId: c.id, tagId })),
        skipDuplicates: true,
      }),
      prisma.contactTag.createMany({
        data: contacts.map((c) => ({ contactId: c.id, tagId })),
        skipDuplicates: true,
      }),
    ]);

    res.json({ attachedCompanies: companies.length, attachedContacts: contacts.length });
  }),
);

/**
 * DELETE /api/v1/tags/:id/company/:companyId
 *
 * Etiketi TEK bir kurumdan kaldırır. Etiketin kendisi ve diğer bağları
 * korunur — kullanıcının aradığı "şu firmadan bu etiketi çıkar" işlemi budur.
 */
router.delete(
  '/:id/company/:companyId',
  requirePermission('company:write'),
  auditAction('TAG_DETACH', 'Company'),
  asyncHandler(async (req, res) => {
    const tagId = String(req.params.id);
    const companyId = String(req.params.companyId);

    const link = await prisma.companyTag.findFirst({
      where: { tagId, companyId, company: { deletedAt: null, ...companyScope(req.user) } },
    });
    if (!link) throw NotFound('Etiket bağı bulunamadı.');

    await prisma.companyTag.delete({
      where: { companyId_tagId: { companyId, tagId } },
    });
    req.auditContext = { entityType: 'Company', entityId: companyId };
    res.json({ success: true });
  }),
);

/** DELETE /api/v1/tags/:id/contact/:contactId */
router.delete(
  '/:id/contact/:contactId',
  requirePermission('contact:write'),
  auditAction('TAG_DETACH', 'Contact'),
  asyncHandler(async (req, res) => {
    const tagId = String(req.params.id);
    const contactId = String(req.params.contactId);

    const link = await prisma.contactTag.findFirst({
      where: {
        tagId,
        contactId,
        contact: {
          deletedAt: null,
          OR: [{ companyId: null }, { company: companyScope(req.user) }],
        },
      },
    });
    if (!link) throw NotFound('Etiket bağı bulunamadı.');

    await prisma.contactTag.delete({
      where: { contactId_tagId: { contactId, tagId } },
    });
    req.auditContext = { entityType: 'Contact', entityId: contactId };
    res.json({ success: true });
  }),
);

/** Kurum/kişi include'larında kullanılacak ortak etiket seçimi. */
export const tagSelect = {
  select: { tag: { select: { id: true, name: true, color: true } } },
} satisfies Prisma.CompanyTagFindManyArgs;

export default router;
