import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { invalidateRateCache } from '../services/currency.service';

export interface SyncResult {
  success: boolean;
  source: 'TCMB' | 'FALLBACK_ECB' | 'CACHE';
  updated: { code: string; rate: number }[];
  message: string;
  fetchedAt: Date;
  /** Kaynağın yayınladığı değerleme tarihi. */
  rateDate: Date | null;
}

const TRACKED = ['USD', 'EUR', 'GBP'] as const;
type Tracked = (typeof TRACKED)[number];

interface FetchedRate {
  code: Tracked;
  rate: number;
}

/**
 * TCMB kur senkronizasyonu.
 *
 * GİZLİLİK: Dışarı giden tek bilgi "kur listesi istiyorum"dur. Gövdede,
 * sorgu dizesinde veya başlıklarda hiçbir müşteri, kişi, tutar ya da
 * kimlik bilgisi yoktur.
 *
 * Sıra: TCMB → (başarısızsa) açık kaynak yedek → (o da başarısızsa)
 * veritabanındaki son geçerli kur KORUNUR. Kur hiçbir koşulda silinmez
 * veya 1.0'a düşürülmez; aksi halde tüm TL karşılıkları bir anda bozulurdu.
 */
export async function syncExchangeRates(): Promise<SyncResult> {
  const fetchedAt = new Date();

  // --- 1) TCMB ---
  try {
    const { rates, rateDate } = await fetchFromTcmb();
    if (rates.length > 0) {
      await persist(rates, 'TCMB', rateDate);
      console.log('[exchangeRateSync] TCMB:', rates.map((r) => `${r.code}=${r.rate}`).join(', '));
      return {
        success: true,
        source: 'TCMB',
        updated: rates,
        message: `${rates.length} para birimi TCMB efektif satış kuruyla güncellendi.`,
        fetchedAt,
        rateDate,
      };
    }
  } catch (error) {
    console.warn(`[exchangeRateSync] TCMB başarısız: ${describe(error)}`);
  }

  // --- 2) Açık kaynak yedek ---
  if (env.exchangeFallbackEnabled) {
    try {
      const { rates, rateDate } = await fetchFromFallback();
      if (rates.length > 0) {
        await persist(rates, 'FALLBACK_ECB', rateDate);
        console.log('[exchangeRateSync] yedek kaynak:', rates.map((r) => `${r.code}=${r.rate}`).join(', '));
        return {
          success: true,
          source: 'FALLBACK_ECB',
          updated: rates,
          message:
            `TCMB'ye ulaşılamadı; ${rates.length} para birimi yedek kaynaktan (ECB referans kuru) ` +
            'güncellendi. Bu kur TCMB efektif satış kurundan farklı olabilir.',
          fetchedAt,
          rateDate,
        };
      }
    } catch (error) {
      console.warn(`[exchangeRateSync] yedek kaynak başarısız: ${describe(error)}`);
    }
  }

  // --- 3) Önbellekteki son geçerli kur ---
  const cached = await prisma.exchangeRateCache.findMany({
    where: { code: { in: [...TRACKED] } },
  });

  return {
    success: false,
    source: 'CACHE',
    updated: cached.map((c) => ({ code: c.code, rate: c.rate })),
    message: cached.length
      ? 'Hiçbir kur kaynağına ulaşılamadı. Veritabanındaki son geçerli kurlar korunuyor. ' +
        'Ayarlar ekranından elle kur girebilirsiniz.'
      : 'Hiçbir kur kaynağına ulaşılamadı ve önbellekte kur yok. ' +
        'Ayarlar ekranından elle kur girin; aksi halde tutarlar 1.0 kuruyla hesaplanır.',
    fetchedAt,
    rateDate: null,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'bilinmeyen hata';
}

async function persist(
  rates: FetchedRate[],
  source: string,
  rateDate: Date | null,
): Promise<void> {
  for (const item of rates) {
    await prisma.exchangeRateCache.upsert({
      where: { code: item.code },
      update: { rate: item.rate, source, rateDate },
      create: { code: item.code, rate: item.rate, source, rateDate },
    });
  }
  // Bellek önbelleği hemen tazelenmeli; aksi halde arayüz 20 saniye boyunca
  // eski kuru göstermeye devam eder.
  invalidateRateCache();
}

async function fetchWithTimeout(url: string, accept: string, ms = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: accept },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// TCMB
// ---------------------------------------------------------------------------

async function fetchFromTcmb(): Promise<{ rates: FetchedRate[]; rateDate: Date | null }> {
  const response = await fetchWithTimeout(env.tcmbUrl, 'application/xml, text/xml');
  const xml = await response.text();
  return { rates: parseTcmbXml(xml), rateDate: parseTcmbDate(xml) };
}

/**
 * TCMB `today.xml` çözümleyicisi.
 *
 * Efektif satış (`BanknoteSelling`) tercih edilir; bazı para birimlerinde
 * bu alan boş gelebildiği için `ForexSelling` yedek olarak kullanılır.
 *
 * XML bağımlılığı eklemek yerine hedefli düzenli ifade kullanılır: belge
 * şeması sabittir ve yalnızca üç para birimi okunur.
 */
export function parseTcmbXml(xml: string): FetchedRate[] {
  const results: FetchedRate[] = [];

  for (const code of TRACKED) {
    const blockMatch = new RegExp(
      `<Currency[^>]*CurrencyCode="${code}"[^>]*>([\\s\\S]*?)</Currency>`,
      'i',
    ).exec(xml);
    if (!blockMatch?.[1]) continue;

    const block = blockMatch[1];
    const rate =
      readNumber(block, 'BanknoteSelling') ??
      readNumber(block, 'ForexSelling') ??
      readNumber(block, 'BanknoteBuying');

    if (rate !== null && rate > 0) results.push({ code, rate });
  }

  return results;
}

/** <Tarih_Date Tarih="17.09.2026" ...> → Date */
export function parseTcmbDate(xml: string): Date | null {
  const match = /Tarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!match) return null;
  const [, day, month, year] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readNumber(block: string, tag: string): number | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(block);
  const raw = match?.[1]?.trim();
  if (!raw) return null;
  // TCMB ondalık ayracı virgüldür.
  const parsed = Number.parseFloat(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Yedek kaynak
// ---------------------------------------------------------------------------

/**
 * Anahtarsız, açık kaynak yedek (Frankfurter — ECB referans kurları).
 *
 * TCMB efektif satış kuru DEĞİLDİR; ECB referans kurudur ve genellikle
 * bir miktar düşüktür. Bu yüzden kayıtlar `FALLBACK_ECB` olarak
 * işaretlenir ve arayüzde kaynak açıkça gösterilir — kullanıcı hangi
 * kuru gördüğünü bilir.
 */
async function fetchFromFallback(): Promise<{ rates: FetchedRate[]; rateDate: Date | null }> {
  const url = `${env.exchangeFallbackUrl}?from=TRY&to=${TRACKED.join(',')}`;
  const response = await fetchWithTimeout(url, 'application/json');
  const body = (await response.json()) as {
    date?: string;
    rates?: Record<string, number>;
  };

  const rates: FetchedRate[] = [];
  for (const code of TRACKED) {
    // Yanıt "1 TRY = X USD" biçimindedir; bize "1 USD = ? TRY" gerekir.
    const perTry = body.rates?.[code];
    if (typeof perTry === 'number' && perTry > 0) {
      rates.push({ code, rate: Math.round((1 / perTry) * 10_000) / 10_000 });
    }
  }

  const rateDate = body.date ? new Date(`${body.date}T00:00:00Z`) : null;
  return { rates, rateDate: rateDate && !Number.isNaN(rateDate.getTime()) ? rateDate : null };
}

// ---------------------------------------------------------------------------
// Zamanlama
// ---------------------------------------------------------------------------

/**
 * TCMB kurları iş günlerinde 15:30 civarında yayımlar ve gün içinde
 * güncellenmez. Bu yüzden gece boyunca dakikada bir çekmenin faydası yok;
 * ancak günde tek çekim de 15:30 sonrası güncellemeyi kaçırır.
 *
 * Yaklaşım: iş günü (Pzt–Cum) ve İstanbul saatiyle 08:00–20:00 arasında
 * `EXCHANGE_SYNC_INTERVAL_MINUTES` (varsayılan 30 dk) aralıkla, dışında
 * ise yalnızca 4 saatte bir dener.
 */
function isTcmbBusinessWindow(now = new Date()): boolean {
  // Sunucu saat diliminden bağımsız olmak için İstanbul saatine çeviririz.
  const istanbul = new Date(
    now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }),
  );
  const day = istanbul.getDay(); // 0 Pazar, 6 Cumartesi
  const hour = istanbul.getHours();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 20;
}

export function scheduleExchangeRateSync(): NodeJS.Timeout {
  const activeMs = env.exchangeSyncIntervalMinutes * 60_000;
  const idleMs = 4 * 60 * 60_000;

  const run = (): void => {
    void syncExchangeRates().catch((e) => console.error('[exchangeRateSync] hata:', e));
  };

  // Açılışta bir kez: kurlar boşsa sistem 1.0 ile çalışmaya başlamasın.
  setTimeout(run, 10_000);

  let lastRun = 0;
  // Zamanlayıcı sık tetiklenir ama iş penceresine göre gerçekten çalışır;
  // böylece pencereye girildiği an ilk çekim gecikmez.
  const timer = setInterval(() => {
    const required = isTcmbBusinessWindow() ? activeMs : idleMs;
    if (Date.now() - lastRun < required) return;
    lastRun = Date.now();
    run();
  }, 60_000);

  timer.unref?.();
  return timer;
}
