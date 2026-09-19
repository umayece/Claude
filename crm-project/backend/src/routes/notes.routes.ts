import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { assertCompanyAccess, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { logActivity } from '../services/activity.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

/**
 * Not gövdesi BOŞ OLABİLİR.
 *
 * "Yeni Not" düğmesi önce boş bir kart oluşturur, kullanıcı sonra yazar.
 * Şema `min(1)` istediği için bu akış 422 ile düşüyordu; alan artık
 * isteğe bağlıdır ve varsayılanı boş dizedir.
 */
const noteFieldsSchema = z.object({
  title: z.string().trim().max(200).nullish(),
  body: z.string().max(20_000).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Renk #RRGGBB biçiminde olmalıdır.').default('#E0F2FE'),
  positionX: z.number().int().min(0).max(20_000).default(0),
  positionY: z.number().int().min(0).max(20_000).default(0),
  isPinned: z.boolean().default(false),
  /** Zaman tünelinden eklenen notlar bir kuruma bağlanır. */
  /*
    Bağ kimlikleri: boş metin "bağ yok" demektir.

    Temizlenen bir seçici `null` değil `""` gönderir; düz
    `z.string().uuid().nullish()` bunu reddedip kullanıcıya sebebi
    anlaşılmayan bir doğrulama hatası veriyordu. Kişiye not eklerken
    şirket bağı ZORUNLU DEĞİLDİR.
  */
  companyId: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.string().uuid().nullable(),
  ).optional(),
  contactId: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.string().uuid().nullable(),
  ).optional(),
  dealId: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.string().uuid().nullable(),
  ).optional(),
});

const createSchema = noteFieldsSchema;
const updateSchema = noteFieldsSchema.partial();

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(60),
  q: z.string().trim().max(200).optional(),
  companyId: z.string().uuid().optional(),
  /** "personal" → kuruma bağlı olmayanlar, "linked" → kurumlu notlar. */
  kind: z.enum(['all', 'personal', 'linked']).default('all'),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const noteInclude = {
  company: { select: { id: true, name: true, type: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, title: true } },
} satisfies Prisma.NoteInclude;

/**
 * Yapışkan notlar kişiseldir: her sorgu `userId` ile kapsanır, böylece
 * kimlik tahmini ile başkasının notu okunamaz.
 */
const own = (userId: string) => ({ userId, deletedAt: null });

/** GET /api/v1/notes */
router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);

    const and: Prisma.NoteWhereInput[] = [own(req.user!.id)];
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.kind === 'personal') and.push({ companyId: null });
    if (query.kind === 'linked') and.push({ companyId: { not: null } });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { body: { contains: query.q, mode: 'insensitive' } },
          { company: { name: { contains: query.q, mode: 'insensitive' } } },
        ],
      });
    }

    const where: Prisma.NoteWhereInput = { AND: and };
    const [rows, total] = await prisma.$transaction([
      prisma.note.findMany({
        where,
        include: noteInclude,
        orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      prisma.note.count({ where }),
    ]);

    res.json(paginated(rows, total, page));
  }),
);

/** POST /api/v1/notes */
router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;

    // Kuruma bağlanıyorsa erişim kapsamı doğrulanır; aksi halde kullanıcı
    // göremediği bir kurumun zaman tüneline kayıt düşürebilirdi.
    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);

    const note = await prisma.note.create({
      data: {
        title: body.title ?? null,
        body: body.body,
        color: body.color,
        positionX: body.positionX,
        positionY: body.positionY,
        isPinned: body.isPinned,
        companyId: body.companyId ?? null,
        contactId: body.contactId ?? null,
        dealId: body.dealId ?? null,
        userId: req.user!.id,
      },
      include: noteInclude,
    });

    // Kuruma bağlı notlar zaman tünelinde de görünür.
    if (note.companyId && note.body.trim()) {
      await logActivity({
        type: 'NOTE',
        title: note.title?.trim() || 'Not eklendi',
        body: note.body,
        companyId: note.companyId,
        contactId: note.contactId,
        dealId: note.dealId,
        userId: req.user!.id,
        metadata: { noteId: note.id },
      });
    }

    res.status(201).json(note);
  }),
);

/** PUT /api/v1/notes/:id */
router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.note.findFirst({ where: { id, ...own(req.user!.id) } });
    if (!existing) throw NotFound('Not bulunamadı.');

    const body = req.body as z.infer<typeof updateSchema>;
    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);

    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.positionX !== undefined ? { positionX: body.positionX } : {}),
        ...(body.positionY !== undefined ? { positionY: body.positionY } : {}),
        ...(body.isPinned !== undefined ? { isPinned: body.isPinned } : {}),
        ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
        ...(body.dealId !== undefined ? { dealId: body.dealId } : {}),
      },
      include: noteInclude,
    });

    res.json(note);
  }),
);

/** DELETE /api/v1/notes/:id */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.note.findFirst({ where: { id, ...own(req.user!.id) } });
    if (!existing) throw NotFound('Not bulunamadı.');
    await prisma.note.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  }),
);

/**
 * GET /api/v1/notes/company/:companyId
 * Bir kuruma ait notlar — ekip genelinde görünür (yalnızca yazarına değil).
 * Kurum notu kurumsal bilgidir; kişisel yapışkan nottan farklıdır.
 */
router.get(
  '/company/:companyId',
  asyncHandler(async (req, res) => {
    const companyId = String(req.params.companyId);
    await assertCompanyAccess(req.user, companyId);

    const rows = await prisma.note.findMany({
      where: { companyId, deletedAt: null, company: companyScope(req.user) },
      include: { ...noteInclude, user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ data: rows });
  }),
);

export default router;
