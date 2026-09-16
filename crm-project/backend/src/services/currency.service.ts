import { prisma } from '../lib/prisma';

export const SUPPORTED_CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export interface RateSnapshot {
  code: CurrencyCode;
  rate: number;
  source: string;
  updatedAt: Date;
}

/**
 * Güncel kurlar. TRY her zaman 1.0'dır ve tabloda tutulmaz.
 * İnternet erişimi olmasa da bu fonksiyon çalışır: değerler yalnızca
 * veritabanı önbelleğinden okunur, dış çağrı yapılmaz.
 */
export async function getRates(): Promise<RateSnapshot[]> {
  const cached = await prisma.exchangeRateCache.findMany({
    where: { code: { in: ['USD', 'EUR', 'GBP'] } },
    orderBy: { code: 'asc' },
  });

  const rows: RateSnapshot[] = [
    { code: 'TRY', rate: 1, source: 'SABIT', updatedAt: new Date() },
  ];

  for (const row of cached) {
    if (isCurrencyCode(row.code)) {
      rows.push({ code: row.code, rate: row.rate, source: row.source, updatedAt: row.updatedAt });
    }
  }
  return rows;
}

export async function getRateMap(): Promise<Record<CurrencyCode, number>> {
  const rates = await getRates();
  const map: Record<CurrencyCode, number> = { TRY: 1, USD: 1, EUR: 1, GBP: 1 };
  for (const r of rates) map[r.code] = r.rate;
  return map;
}

/**
 * Bir kaydın yazım anındaki kuru. Kur sonradan değişse de geçmiş tutar
 * kaymasın diye kayıt üstünde `exchangeRate` olarak dondurulur.
 */
export async function resolveExchangeRate(currency: string): Promise<number> {
  if (currency === 'TRY') return 1;
  if (!isCurrencyCode(currency)) return 1;
  const row = await prisma.exchangeRateCache.findUnique({ where: { code: currency } });
  return row?.rate ?? 1;
}

/** Kayıt üstündeki donmuş kuru kullanarak TL karşılığı. */
export function toTry(amount: number, exchangeRate: number): number {
  return Math.round(amount * (exchangeRate || 1) * 100) / 100;
}

/** TL bazındaki toplamı hedef para birimine, güncel kurla çevirir. */
export function fromTry(amountTry: number, targetRate: number): number {
  if (!targetRate) return amountTry;
  return Math.round((amountTry / targetRate) * 100) / 100;
}
