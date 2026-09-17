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

/**
 * İki para birimi arasında güncel kurla çevirir (TL üzerinden köprüleyerek).
 * Raporlarda USD'yi ikinci ana para birimi olarak göstermek için kullanılır.
 */
export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: Record<CurrencyCode, number>,
): number {
  if (from === to) return Math.round(amount * 100) / 100;
  const inTry = amount * (rates[from] ?? 1);
  const target = rates[to] ?? 1;
  return Math.round((inTry / target) * 100) / 100;
}

export interface DualAmount {
  /** Kaydın kendi para birimindeki tutar. */
  amount: number;
  currency: CurrencyCode;
  /** Kayıt anında DONDURULMUŞ kurla TL karşılığı (muhasebe değeri). */
  amountTry: number;
  /** GÜNCEL kurla TL karşılığı (bugünkü piyasa değeri). */
  currentTry: number;
  /** GÜNCEL kurla USD karşılığı. */
  currentUsd: number;
  /** Kayıttaki donmuş kur. */
  frozenRate: number;
  /** Bugünkü kur. */
  currentRate: number;
  /** Donmuş ve güncel kur arasında %1'den fazla fark var mı? */
  rateDrift: boolean;
}

/**
 * Bir parasal kaydın hem tarihsel hem güncel karşılığını üretir.
 *
 * Bu ayrım kasıtlıdır: kayıt üstündeki `exchangeRate` muhasebe değerini
 * sabitler (kur hareketi geçmiş tutarı kaydırmaz), ancak kullanıcı
 * "bugün kaç TL eder?" sorusunun yanıtını da görmek ister. İkisini aynı
 * sayıymış gibi göstermek, ekranın "kur yanlış hesaplanıyor" izlenimi
 * vermesine yol açar.
 */
export function dualAmount(
  amount: number,
  currency: string,
  frozenRate: number,
  rates: Record<CurrencyCode, number>,
): DualAmount {
  const code: CurrencyCode = isCurrencyCode(currency) ? currency : 'TRY';
  const currentRate = rates[code] ?? 1;
  const effectiveFrozen = frozenRate || 1;

  return {
    amount,
    currency: code,
    amountTry: Math.round(amount * effectiveFrozen * 100) / 100,
    currentTry: Math.round(amount * currentRate * 100) / 100,
    currentUsd: convert(amount, code, 'USD', rates),
    frozenRate: effectiveFrozen,
    currentRate,
    rateDrift: Math.abs(currentRate - effectiveFrozen) / (effectiveFrozen || 1) > 0.01,
  };
}

/** Elle kur girişi — TCMB'ye erişilemeyen kapalı ağlar için. */
export async function setManualRate(code: CurrencyCode, rate: number): Promise<void> {
  if (code === 'TRY') return;
  await prisma.exchangeRateCache.upsert({
    where: { code },
    update: { rate, source: 'MANUEL' },
    create: { code, rate, source: 'MANUEL' },
  });
}
