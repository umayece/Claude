import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getRates } from '../services/currency.service';
import { syncExchangeRates } from '../jobs/exchangeRateSync';

const router = Router();
router.use(authenticate, requireMfaComplete);

/** GET /api/v1/exchange-rates — önbellekteki güncel kurlar. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rates = await getRates();
    const nonBase = rates.filter((r) => r.code !== 'TRY');
    const oldest = nonBase.length
      ? nonBase.reduce((min, r) => (r.updatedAt < min ? r.updatedAt : min), nonBase[0]!.updatedAt)
      : null;

    res.json({
      base: 'TRY',
      data: rates,
      meta: {
        lastUpdatedAt: oldest,
        // Kur 24 saatten eskiyse istemci bunu kullanıcıya bildirir;
        // internet kesintisinde eski kurla çalışmak sessizce olmamalı.
        isStale: oldest ? Date.now() - oldest.getTime() > 24 * 3_600_000 : true,
        source: 'TCMB',
      },
    });
  }),
);

/** POST /api/v1/exchange-rates/sync — elle tetikleme (yalnızca ADMIN). */
router.post(
  '/sync',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const result = await syncExchangeRates();
    res.json(result);
  }),
);

export default router;
