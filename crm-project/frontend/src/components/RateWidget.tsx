import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useExchangeRates } from '../hooks/useExchangeRates';
import { IconAlert, IconCheck, IconRefresh } from './Icons';
import type { CurrencyCode } from '../types';

const SOURCE_LABELS: Record<string, string> = {
  TCMB: 'TCMB efektif satış',
  FALLBACK_ECB: 'ECB referans (yedek)',
  MANUEL: 'Elle girilmiş',
  SEED: 'Başlangıç verisi',
  SABIT: 'Sabit',
};

function formatAge(minutes: number | null): string {
  if (minutes === null) return 'bilinmiyor';
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  return `${Math.round(hours / 24)} gün önce`;
}

/**
 * Sol alt köşedeki kur göstergesi.
 *
 * Tıklandığında açılan panelde her para biriminin kaynağı, tazeliği ve
 * "Kurları Şimdi Güncelle" düğmesi bulunur. Kaynak açıkça gösterilir:
 * TCMB efektif satış kuru ile yedek ECB referans kuru farklı değerlerdir
 * ve kullanıcı hangisine baktığını bilmelidir.
 */
export function RateWidget() {
  const { user } = useAuth();
  const {
    rates, isStale, ageMinutes, sources, syncing, syncNow, reload, loading,
  } = useExchangeRates();

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const canSync = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setMessage(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const handleSync = async (): Promise<void> => {
    setMessage(await syncNow());
  };

  return (
    <div className="rate-widget" ref={rootRef}>
      <button
        type="button"
        className="rate-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Döviz kurları"
      >
        <span className="rate-pair">
          <span>USD</span>
          <strong>{rates.USD.toFixed(2)}</strong>
        </span>
        <span className="rate-pair">
          <span>EUR</span>
          <strong>{rates.EUR.toFixed(2)}</strong>
        </span>
        {isStale && <IconAlert size={12} className="rate-stale-icon" />}
      </button>

      {open && (
        <div className="rate-panel">
          <div className="rate-panel-head">
            <span>Döviz Kurları</span>
            <span className="text-xs">{formatAge(ageMinutes)}</span>
          </div>

          <div className="rate-panel-body">
            {(['USD', 'EUR', 'GBP'] as CurrencyCode[]).map((code) => (
              <div className="rate-row" key={code}>
                <span className="rate-code">{code}</span>
                <span className="rate-value">{rates[code].toFixed(4)} ₺</span>
              </div>
            ))}

            <div className="rate-source">
              Kaynak: {sources.map((s) => SOURCE_LABELS[s] ?? s).join(', ') || 'bilinmiyor'}
            </div>

            {isStale && (
              <div className="rate-warning">
                <IconAlert size={12} /> Kurlar bayat. Değerlemeler bu kurla yapılıyor.
              </div>
            )}

            {message && (
              <div className="rate-message">
                <IconCheck size={12} /> {message}
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <button
                type="button"
                className="btn btn-sm flex-1"
                onClick={() => void reload()}
                disabled={loading}
              >
                Yenile
              </button>

              {canSync && (
                <button
                  type="button"
                  className="btn btn-sm btn-accent flex-1"
                  onClick={() => void handleSync()}
                  disabled={syncing}
                >
                  {syncing
                    ? <span className="spinner" style={{ width: 12, height: 12 }} />
                    : <IconRefresh size={12} />}
                  Şimdi Güncelle
                </button>
              )}
            </div>

            <div className="rate-note">
              Fırsat ve ihale tutarları <strong>anlık kurla</strong> değerlenir;
              sözleşmeler imza tarihi kurunu da gösterir.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
