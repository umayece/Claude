import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CurrencyCode, ExchangeRate } from '../types';

interface RatesResponse {
  base: string;
  data: ExchangeRate[];
  meta: { lastUpdatedAt: string | null; isStale: boolean; source: string };
}

interface UseExchangeRates {
  rates: Record<CurrencyCode, number>;
  lastUpdatedAt: string | null;
  isStale: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Tutarı TL'ye çevirir (kayıt üstündeki donmuş kur verilirse onu kullanır). */
  toTry: (amount: number, currency: CurrencyCode, frozenRate?: number) => number;
  format: (amount: number, currency: CurrencyCode) => string;
}

const DEFAULTS: Record<CurrencyCode, number> = { TRY: 1, USD: 1, EUR: 1, GBP: 1 };

// Kurlar oturum boyunca birden fazla bileşende kullanılır; modül düzeyinde
// önbellek her bileşenin ayrı istek atmasını önler.
let cache: { rates: Record<CurrencyCode, number>; meta: RatesResponse['meta'] } | null = null;

export function useExchangeRates(): UseExchangeRates {
  const [rates, setRates] = useState<Record<CurrencyCode, number>>(cache?.rates ?? DEFAULTS);
  const [meta, setMeta] = useState<RatesResponse['meta'] | null>(cache?.meta ?? null);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<RatesResponse>('/exchange-rates');
      const next: Record<CurrencyCode, number> = { ...DEFAULTS };
      for (const rate of response.data) next[rate.code] = rate.rate;
      cache = { rates: next, meta: response.meta };
      setRates(next);
      setMeta(response.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kurlar alınamadı.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cache) void reload();
  }, [reload]);

  const toTry = useCallback(
    (amount: number, currency: CurrencyCode, frozenRate?: number) => {
      const rate = frozenRate ?? rates[currency] ?? 1;
      return Math.round(amount * rate * 100) / 100;
    },
    [rates],
  );

  const format = useCallback((amount: number, currency: CurrencyCode) => {
    try {
      return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount.toLocaleString('tr-TR')} ${currency}`;
    }
  }, []);

  return {
    rates,
    lastUpdatedAt: meta?.lastUpdatedAt ?? null,
    isStale: meta?.isStale ?? false,
    loading,
    error,
    reload,
    toTry,
    format,
  };
}
