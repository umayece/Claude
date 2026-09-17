import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { validate, validated } from '../middleware/validate';

const router = Router();
router.use(authenticate, requireMfaComplete);

const querySchema = z.object({
  /** ISO 3166-1 alpha-2 — verilmezse tüm ülkeler döner. */
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  q: z.string().trim().max(120).optional(),
});
type Query = z.infer<typeof querySchema>;

/**
 * GET /api/v1/cities
 *
 * Türkiye illeri + uluslararası şehirler. Liste birkaç yüz satırdır ve
 * istemcide bir kez önbelleklenir; sayfalama yerine ülke filtresi verilir.
 */
router.get(
  '/',
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<Query>(req);

    const where: Prisma.CityWhereInput = {
      ...(query.countryCode ? { countryCode: query.countryCode } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const cities = await prisma.city.findMany({
      where,
      // Türkiye önce (plaka sırasıyla), ardından ülke ve şehir adına göre.
      orderBy: [{ countryCode: 'asc' }, { plateCode: 'asc' }, { name: 'asc' }],
      take: 1000,
    });

    res.json({ data: cities, meta: { total: cities.length } });
  }),
);

/**
 * GET /api/v1/cities/countries
 * Form açılır listeleri için ülke kataloğu (şehir sayısıyla birlikte).
 */
router.get(
  '/countries',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.city.groupBy({
      by: ['countryCode', 'country'],
      _count: { _all: true },
      orderBy: { country: 'asc' },
    });

    // Türkiye her zaman listenin başındadır (varsayılan pazar).
    const countries = rows
      .map((row) => ({
        countryCode: row.countryCode,
        country: row.country,
        cityCount: row._count._all,
      }))
      .sort((a, b) => {
        if (a.countryCode === 'TR') return -1;
        if (b.countryCode === 'TR') return 1;
        return a.country.localeCompare(b.country, 'tr');
      });

    res.json({ data: countries });
  }),
);

export default router;
