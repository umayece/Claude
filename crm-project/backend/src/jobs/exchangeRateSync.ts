import { prisma } from '../lib/prisma';
import { env } from '../lib/env';

export interface SyncResult {
  success: boolean;
  source: 'TCMB' | 'CACHE';
  updated: { code: string; rate: number }[];
  message: string;
  fetchedAt: Date;
}

const TRACKED = ['USD', 'EUR', 'GBP'] as const;

/**
 * TCMB günlük kur senkronizasyonu.
 *
 * GİZLİLİK: Bu istek TCMB'ye YALNIZCA bir GET çağrısıdır. Hiçbir müşteri,
 * kişi, tutar veya kimlik bilgisi gövdeye, sorgu dizesine ya da başlıklara
 * konmaz — dışarı giden tek bilgi "kur listesi istiyorum"dur.
 *
 * İnternet yoksa veya TCMB yanıt vermezse veritabanındaki son geçerli kur
 * korunur; kayıt SİLİNMEZ veya 1.0'a düşürülmez (aksi halde tüm TL
 * karşılıkları bir anda bozulurdu).
 */
export async function syncExchangeRates(): Promise<SyncResult> {
  const fetchedAt = new Date();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(env.tcmbUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/xml, text/xml' },
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) throw new Error(`TCMB HTTP ${response.status}`);

    const xml = await response.text();
    const parsed = parseTcmbXml(xml);

    if (parsed.length === 0) throw new Error('TCMB yanıtında kur bulunamadı.');

    const updated: { code: string; rate: number }[] = [];
    for (const item of parsed) {
      await prisma.exchangeRateCache.upsert({
        where: { code: item.code },
        update: { rate: item.rate, source: 'TCMB' },
        create: { code: item.code, rate: item.rate, source: 'TCMB' },
      });
      updated.push(item);
    }

    console.log('[exchangeRateSync] güncellendi:', updated.map((u) => `${u.code}=${u.rate}`).join(', '));
    return {
      success: true,
      source: 'TCMB',
      updated,
      message: `${updated.length} para birimi TCMB efektif satış kuruyla güncellendi.`,
      fetchedAt,
    };
  } catch (error) {
    const cached = await prisma.exchangeRateCache.findMany({
      where: { code: { in: [...TRACKED] } },
    });

    const reason = error instanceof Error ? error.message : 'bilinmeyen hata';
    console.warn(`[exchangeRateSync] TCMB'ye ulaşılamadı (${reason}); önbellekteki kur kullanılıyor.`);

    return {
      success: false,
      source: 'CACHE',
      updated: cached.map((c) => ({ code: c.code, rate: c.rate })),
      message: cached.length
        ? `TCMB'ye ulaşılamadı (${reason}). Veritabanındaki son geçerli kurlar korunuyor.`
        : `TCMB'ye ulaşılamadı (${reason}) ve önbellekte kur yok. Tutarlar 1.0 kuruyla hesaplanacak.`,
      fetchedAt,
    };
  }
}

interface TcmbRate {
  code: string;
  rate: number;
}

/**
 * TCMB `today.xml` çözümleyicisi.
 *
 * Belge şekli: <Currency CurrencyCode="USD"><BanknoteSelling>34,1234</BanknoteSelling>...
 * Efektif satış (`BanknoteSelling`) tercih edilir; bazı para birimlerinde bu
 * alan boş gelebildiği için `ForexSelling` yedek olarak kullanılır.
 *
 * XML bağımlılığı eklemek yerine hedefli bir düzenli ifade kullanılır:
 * belge şeması sabittir ve yalnızca üç para birimi okunur.
 */
export function parseTcmbXml(xml: string): TcmbRate[] {
  const results: TcmbRate[] = [];

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

function readNumber(block: string, tag: string): number | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(block);
  const raw = match?.[1]?.trim();
  if (!raw) return null;
  // TCMB ondalık ayracı virgüldür.
  const parsed = Number.parseFloat(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Günde bir kez çalışacak zamanlayıcı. */
export function scheduleExchangeRateSync(): NodeJS.Timeout {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Açılışta bir kez: kurlar boşsa sistem 1.0 ile çalışmaya başlamasın.
  setTimeout(() => {
    void syncExchangeRates().catch((e) => console.error('[exchangeRateSync] hata:', e));
  }, 10_000);

  const timer = setInterval(() => {
    void syncExchangeRates().catch((e) => console.error('[exchangeRateSync] hata:', e));
  }, DAY_MS);
  timer.unref?.();
  return timer;
}
