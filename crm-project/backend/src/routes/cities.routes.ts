import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireMfaComplete);

/**
 * GET /api/v1/cities — şehir listesi (koordinatlı).
 * 81 kayıtlık sabit bir tablo; sayfalama gerekmez ve istemci tarafında
 * bir kez önbelleklenir.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const cities = await prisma.city.findMany({ orderBy: { name: 'asc' } });
    res.json({ data: cities });
  }),
);

export default router;
