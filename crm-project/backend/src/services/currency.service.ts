import { prisma } from '../lib/prisma';

export const SUPPORTED_CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export type RateMap = Record<CurrencyCode, number>;

export interface RateSnapshot {
  code: CurrencyCode;
  rate: number;
  source: string;
  rateDate: Date | null;
  updatedAt: Date;
}

/**
 * DEĞERLEME MİMARİSİ
 *
 * Kayıtlar veritabanında YALNIZCA orijinal para birimiyle (`amount`,
 * `currency`) saklanır. TL ve USD karşılıkları listelerde, panolarda ve
 * boru hattında **istek anındaki güncel kurla** hesaplanır.
 *
 * Kuru kayıt anında dondurmak, bir ay önce girilmiş $100.000'lık bir
 * fırsatın bugünkü değerini göstermeyi imkânsız kılıyordu. Tek istisna
 * resmiyet kazanmış belgelerdir (sözleşmeler ve onaylanmış teklifler):
 * orada `exchangeRateAtCreation` saklanır ve arayüzde "imza tarihindeki
 * değer" ile "güncel piyasa değeri" YAN YANA gösterilir.
 */

const DEFAULT_RATES: RateMap = { TRY: 1, USD: 1, EUR: 1, GBP: 1 };

// Kur, tek bir istek içinde onlarca kez okunur (liste + özet + huni).
// Kısa ömürlü bellek önbelleği veritabanına tekrar tekrar gitmeyi önler
// ama kur güncellemesini de geciktirmez.
let cache: { rates: RateMap; snapshots: RateSnapshot[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 20_000;

export function invalidateRateCache(): void {
  cache = null;
}

async function loadRates(): Promise<{ rates: RateMap; snapshots: RateSnapshot[] }> {
  if (cache && cache.expiresAt > Date.now()) {
    return { rates: cache.rates, snapshots: cache.snapshots };
  }

  const rows = await prisma.exchangeRateCache.findMany({
    where: { code: { in: ['USD', 'EUR', 'GBP'] } },
    orderBy: { code: 'asc' },
  });

  const rates: RateMap = { ...DEFAULT_RATES };
  const snapshots: RateSnapshot[] = [
    { code: 'TRY', rate: 1, source: 'SABIT', rateDate: null, updatedAt: new Date() },
  ];

  for (const row of rows) {
    if (!isCurrencyCode(row.code)) continue;
    rates[row.code] = row.rate;
    snapshots.push({
      code: row.code,
      rate: row.rate,
      source: row.source,
      rateDate: row.rateDate,
      updatedAt: row.updatedAt,
    });
  }

  cache = { rates, snapshots, expiresAt: Date.now() + CACHE_TTL_MS };
  return { rates, snapshots };
}

/**
 * Güncel kurlar. TRY her zaman 1.0'dır ve tabloda tutulmaz.
 * Dış çağrı yapmaz; yalnızca veritabanı önbelleğinden okur.
 */
export async function getRates(): Promise<RateSnapshot[]> {
  return (await loadRates()).snapshots;
}

export async function getRateMap(): Promise<RateMap> {
  return (await loadRates()).rates;
}

/** Kurların en eskisinin ne kadar bayat olduğu — arayüz uyarısı için. */
export async function getRateFreshness(): Promise<{
  lastUpdatedAt: Date | null;
  ageMinutes: number | null;
  isStale: boolean;
  sources: string[];
}> {
  const { snapshots } = await loadRates();
  const nonBase = snapshots.filter((s) => s.code !== 'TRY');

  if (nonBase.length === 0) {
    return { lastUpdatedAt: null, ageMinutes: null, isStale: true, sources: [] };
  }

  const oldest = nonBase.reduce(
    (min, s) => (s.updatedAt < min ? s.updatedAt : min),
    nonBase[0]!.updatedAt,
  );
  const ageMinutes = Math.round((Date.now() - oldest.getTime()) / 60_000);

  return {
    lastUpdatedAt: oldest,
    ageMinutes,
    // İş günü içinde 6 saatten eski kur bayat sayılır.
    isStale: ageMinutes > 360,
    sources: [...new Set(nonBase.map((s) => s.source))],
  };
}

// ---------------------------------------------------------------------------
// Dönüştürme
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Tutarı GÜNCEL kurla TL'ye çevirir. */
export function toTryAt(amount: number, currency: string, rates: RateMap): number {
  const code: CurrencyCode = isCurrencyCode(currency) ? currency : 'TRY';
  return round2(amount * (rates[code] ?? 1));
}

/** İki para birimi arasında TL üzerinden köprüleyerek çevirir. */
export function convert(
  amount: number,
  from: string,
  to: CurrencyCode,
  rates: RateMap,
): number {
  const source: CurrencyCode = isCurrencyCode(from) ? from : 'TRY';
  if (source === to) return round2(amount);
  const inTry = amount * (rates[source] ?? 1);
  return round2(inTry / (rates[to] ?? 1));
}

/**
 * Bir tutarın anlık değerlemesi — listeler ve panolar bunu kullanır.
 * Dondurulmuş kur YOKTUR; her çağrı o anki kuru yansıtır.
 */
export interface LiveValue {
  amount: number;
  currency: CurrencyCode;
  /** Güncel kurla TL karşılığı. */
  amountTry: number;
  /** Güncel kurla USD karşılığı — ikinci ana para birimi. */
  amountUsd: number;
  /** Değerlemede kullanılan güncel kur. */
  rate: number;
}

export function liveValue(amount: number, currency: string, rates: RateMap): LiveValue {
  const code: CurrencyCode = isCurrencyCode(currency) ? currency : 'TRY';
  return {
    amount,
    currency: code,
    amountTry: toTryAt(amount, code, rates),
    amountUsd: convert(amount, code, 'USD', rates),
    rate: rates[code] ?? 1,
  };
}

/**
 * Resmî belgeler (sözleşme, onaylanmış teklif) için ÇİFT değerleme:
 * imza/kayıt tarihindeki değer ile bugünkü piyasa değeri yan yana.
 */
export interface DualValue extends LiveValue {
  /** Kayıt anında dondurulmuş kur; yoksa null. */
  rateAtCreation: number | null;
  /** İmza tarihindeki TL karşılığı; donmuş kur yoksa null. */
  amountTryAtCreation: number | null;
  /** İki değerleme arasındaki fark (TL). */
  differenceTry: number | null;
  /** Yüzde fark; %1'in altındaki sapma gürültü sayılır. */
  driftPercent: number | null;
  hasDrift: boolean;
}

export function dualValue(
  amount: number,
  currency: string,
  rateAtCreation: number | null | undefined,
  rates: RateMap,
): DualValue {
  const live = liveValue(amount, currency, rates);
  const frozen = rateAtCreation ?? null;

  if (frozen === null || live.currency === 'TRY') {
    return {
      ...live,
      rateAtCreation: frozen,
      amountTryAtCreation: frozen === null ? null : round2(amount * frozen),
      differenceTry: null,
      driftPercent: null,
      hasDrift: false,
    };
  }

  const atCreation = round2(amount * frozen);
  const difference = round2(live.amountTry - atCreation);
  const driftPercent = atCreation === 0 ? 0 : round2((difference / atCreation) * 100);

  return {
    ...live,
    rateAtCreation: frozen,
    amountTryAtCreation: atCreation,
    differenceTry: difference,
    driftPercent,
    hasDrift: Math.abs(driftPercent) >= 1,
  };
}

/**
 * Bir belgenin kayıt anı kurunu dondurup dondurmayacağına karar verir.
 *
 * Yalnızca RESMİYET KAZANMIŞ belgeler dondurulur; taslaklar piyasayı
 * izlemeye devam eder.
 */
export function shouldFreezeRate(entity: 'contract' | 'offer', status: string): boolean {
  if (entity === 'contract') {
    // Taslak sözleşme henüz imzalanmamıştır.
    return status !== 'Taslak';
  }
  return status === 'Gönderildi' || status === 'Kabul';
}

/** Dondurma anındaki kuru verir (TRY için 1). */
export async function rateForFreeze(currency: string): Promise<number> {
  if (currency === 'TRY' || !isCurrencyCode(currency)) return 1;
  const rates = await getRateMap();
  return rates[currency] ?? 1;
}

/** Elle kur girişi — TCMB'ye erişilemeyen kapalı ağlar için. */
export async function setManualRate(code: CurrencyCode, rate: number): Promise<void> {
  if (code === 'TRY') return;
  await prisma.exchangeRateCache.upsert({
    where: { code },
    update: { rate, source: 'MANUEL', rateDate: new Date() },
    create: { code, rate, source: 'MANUEL', rateDate: new Date() },
  });
  invalidateRateCache();
}
