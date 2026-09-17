import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { CurrencyCode, ExchangeRate } from '../types';

interface RatesResponse {
  base: string;
  data: ExchangeRate[];
  meta: {
    lastUpdatedAt: string | null;
    ageMinutes: number | null;
    isStale: boolean;
    sources: string[];
  };
}

export type RateMap = Record<CurrencyCode, number>;

export interface LiveValue {
  amountTry: number;
  amountUsd: number;
  rate: number;
}

interface UseExchangeRates {
  rates: RateMap;
  lastUpdatedAt: string | null;
  ageMinutes: number | null;
  isStale: boolean;
  sources: string[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** TCMB'den elle çekim tetikler (yetkisi olan roller için). */
  syncNow: () => Promise<string>;
  /** Tutarı GÜNCEL kurla TL'ye çevirir. */
  toTry: (amount: number, currency: CurrencyCode) => number;
  /** Tutarı GÜNCEL kurla USD'ye çevirir. */
  toUsd: (amount: number, currency: CurrencyCode) => number;
  /** TL + USD karşılığını birlikte verir. */
  value: (amount: number, currency: CurrencyCode) => LiveValue;
  format: (amount: number, currency: CurrencyCode) => string;
  /** Kısa biçim: 1,2 M ₺ */
  formatCompact: (amount: number, currency?: CurrencyCode) => string;
}

const DEFAULTS: RateMap = { TRY: 1, USD: 1, EUR: 1, GBP: 1 };

/**
 * Kurlar oturum boyunca birçok bileşende kullanılır; modül düzeyinde
 * önbellek her bileşenin ayrı istek atmasını önler. Abone listesi sayesinde
 * bir bileşen kuru tazelediğinde diğerleri de anında güncellenir — aksi
 * halde sol alttaki gösterge yenilenirken listeler eski kuru göstermeye
 * devam ederdi.
 */
let cache: { rates: RateMap; meta: RatesResponse['meta'] } | null = null;
const subscribers = new Set<() => void>();

function publish(): void {
  for (const notify of subscribers) notify();
}

export function useExchangeRates(): UseExchangeRates {
  const [, forceRender] = useState(0);
  const [loading, setLoading] = useState(!cache);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const notify = (): void => forceRender((n) => n + 1);
    subscribers.add(notify);
    return () => { subscribers.delete(notify); };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<RatesResponse>('/exchange-rates');
      const next: RateMap = { ...DEFAULTS };
      for (const rate of response.data) next[rate.code] = rate.rate;
      cache = { rates: next, meta: response.meta };
      publish();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kurlar alınamadı.');
    } finally {
      setLoading(false);
    }
  }, []);

  const syncNow = useCallback(async (): Promise<string> => {
    setSyncing(true);
    setError(null);
    try {
      const response = await api.post<{ success: boolean; message: string }>(
        '/exchange-rates/sync',
      );
      await reload();
      return response.message;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Senkronizasyon başarısız.';
      setError(message);
      return message;
    } finally {
      setSyncing(false);
    }
  }, [reload]);

  useEffect(() => {
    if (!cache) void reload();
  }, [reload]);

  // Kur arka planda güncellenebilir; ekran açık kaldıkça tazelensin.
  useEffect(() => {
    const timer = setInterval(() => { void reload(); }, 10 * 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  const rates = cache?.rates ?? DEFAULTS;

  const toTry = useCallback(
    (amount: number, currency: CurrencyCode) =>
      Math.round(amount * (rates[currency] ?? 1) * 100) / 100,
    [rates],
  );

  const toUsd = useCallback(
    (amount: number, currency: CurrencyCode) => {
      if (currency === 'USD') return Math.round(amount * 100) / 100;
      const inTry = amount * (rates[currency] ?? 1);
      return Math.round((inTry / (rates.USD || 1)) * 100) / 100;
    },
    [rates],
  );

  const value = useCallback(
    (amount: number, currency: CurrencyCode): LiveValue => ({
      amountTry: toTry(amount, currency),
      amountUsd: toUsd(amount, currency),
      rate: rates[currency] ?? 1,
    }),
    [toTry, toUsd, rates],
  );

  const format = useCallback((amount: number, currency: CurrencyCode) => {
    try {
      return new Intl.NumberFormat('tr-TR', {
        style: 'currency', currency, maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount.toLocaleString('tr-TR')} ${currency}`;
    }
  }, []);

  const formatCompact = useCallback((amount: number, currency: CurrencyCode = 'TRY') => {
    const symbol = currency === 'TRY' ? '₺' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
    if (Math.abs(amount) >= 1_000_000) {
      return `${(amount / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} M ${symbol}`;
    }
    if (Math.abs(amount) >= 1_000) {
      return `${(amount / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} B ${symbol}`;
    }
    return `${amount.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ${symbol}`;
  }, []);

  return useMemo(
    () => ({
      rates,
      lastUpdatedAt: cache?.meta.lastUpdatedAt ?? null,
      ageMinutes: cache?.meta.ageMinutes ?? null,
      isStale: cache?.meta.isStale ?? false,
      sources: cache?.meta.sources ?? [],
      loading, syncing, error,
      reload, syncNow, toTry, toUsd, value, format, formatCompact,
    }),
    [rates, loading, syncing, error, reload, syncNow, toTry, toUsd, value, format, formatCompact],
  );
}
