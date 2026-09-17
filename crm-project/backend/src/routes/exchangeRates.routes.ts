import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { auditAction } from '../middleware/audit';
import {
  getRates, setManualRate, SUPPORTED_CURRENCIES, type CurrencyCode,
} from '../services/currency.service';
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
        sources: [...new Set(nonBase.map((r) => r.source))],
      },
    });
  }),
);

/**
 * POST /api/v1/exchange-rates/sync — TCMB'den elle çekim (yalnızca ADMIN).
 * Zamanlanmış iş günde bir çalışır; bu uç aradaki ihtiyaç içindir.
 */
router.post(
  '/sync',
  requireRole('ADMIN', 'MANAGER'),
  auditAction('EXCHANGE_RATE_SYNC', 'ExchangeRateCache'),
  asyncHandler(async (_req, res) => {
    const result = await syncExchangeRates();
    // TCMB'ye ulaşılamadıysa bu bir hata değil, bilgilendirilmiş bir
    // sonuçtur: istemci `success: false` görüp elle giriş önerir.
    res.json(result);
  }),
);

const manualSchema = z.object({
  rates: z
    .array(
      z.object({
        code: z.enum(SUPPORTED_CURRENCIES),
        rate: z.number().positive('Kur sıfırdan büyük olmalıdır.').max(100_000),
      }),
    )
    .min(1)
    .max(SUPPORTED_CURRENCIES.length),
});

/**
 * PUT /api/v1/exchange-rates — elle kur girişi.
 *
 * TCMB'ye çıkışı olmayan kapalı ağ kurulumlarında tek çalışan yoldur.
 * Kaynak `MANUEL` olarak işaretlenir; bir sonraki başarılı TCMB
 * senkronizasyonu bu değerin üzerine yazar.
 */
router.put(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  validate(manualSchema),
  auditAction('EXCHANGE_RATE_MANUAL', 'ExchangeRateCache'),
  asyncHandler(async (req, res) => {
    const { rates } = req.body as z.infer<typeof manualSchema>;

    for (const item of rates) {
      await setManualRate(item.code as CurrencyCode, item.rate);
    }

    res.json({
      success: true,
      updated: rates.length,
      message: `${rates.length} kur elle güncellendi. Bir sonraki TCMB senkronizasyonu üzerine yazacaktır.`,
      data: await getRates(),
    });
  }),
);

export default router;
