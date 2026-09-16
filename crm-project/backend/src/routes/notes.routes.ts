import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate, requireMfaComplete);

const bodySchema = z.object({
  title: z.string().trim().max(200).nullish(),
  body: z.string().min(1, 'Not içeriği boş olamaz.').max(20_000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Renk #RRGGBB biçiminde olmalıdır.').default('#fef3c7'),
  positionX: z.number().int().min(0).max(20_000).default(0),
  positionY: z.number().int().min(0).max(20_000).default(0),
  isPinned: z.boolean().default(false),
});

/**
 * Yapışkan notlar kişiseldir: her sorgu `userId` ile kapsanır, böylece
 * kimlik tahmini ile başkasının notu okunamaz.
 */
const own = (userId: string) => ({ userId, deletedAt: null });

/** GET /api/v1/notes */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.note.findMany({
      where: own(req.user!.id),
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });
    res.json({ data: rows });
  }),
);

/** POST /api/v1/notes */
router.post(
  '/',
  validate(bodySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof bodySchema>;
    const note = await prisma.note.create({
      data: { ...body, title: body.title ?? null, userId: req.user!.id },
    });
    res.status(201).json(note);
  }),
);

/** PUT /api/v1/notes/:id */
router.put(
  '/:id',
  validate(bodySchema.partial()),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.note.findFirst({ where: { id, ...own(req.user!.id) } });
    if (!existing) throw NotFound('Not bulunamadı.');

    const note = await prisma.note.update({
      where: { id },
      data: req.body as z.infer<typeof bodySchema>,
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

export default router;
