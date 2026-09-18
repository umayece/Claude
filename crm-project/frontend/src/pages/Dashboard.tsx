import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { FunnelChart, PieChart, SparkBars } from '../components/Charts';
import {
  IconAlert, IconBuilding, IconGavel, IconTrending, IconTruck, IconUsers, IconWrench,
} from '../components/Icons';
import type { DashboardData, NotificationItem } from '../types';

type RangePreset = '7d' | '30d' | 'quarter' | 'year' | 'custom';

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: '7d', label: 'Son 7 Gün' },
  { key: '30d', label: 'Son 30 Gün' },
  { key: 'quarter', label: 'Bu Çeyrek' },
  { key: 'year', label: 'Bu Yıl' },
  { key: 'custom', label: 'Özel Tarih' },
];

function formatCompact(value: number, symbol: string): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} M ${symbol}`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} B ${symbol}`;
  }
  return `${value.toLocaleString('tr-TR')} ${symbol}`;
}

function formatTry(value: number): string {
  return formatCompact(value, '₺');
}

function formatUsd(value: number): string {
  return formatCompact(value, '$');
}

/** Değerleme anını "14:35 kuruyla" biçiminde gösterir. */
function valuationLabel(valuedAt: string | undefined): string | null {
  if (!valuedAt) return null;
  const at = new Date(valuedAt);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} kuruyla`;
}

export function Dashboard() {
  const navigate = useNavigate();
  // Seçilen dönem oturumlar arasında hatırlanır.
  const [range, setRange] = useLocalStorage<RangePreset>('crm:dashboard:range', '30d');
  const [customFrom, setCustomFrom] = useLocalStorage('crm:dashboard:from', '');
  const [customTo, setCustomTo] = useLocalStorage('crm:dashboard:to', '');

  const [data, setData] = useState<DashboardData | null>(null);
  // Termin uyarıları zil ile aynı uç noktadan gelir: iki ekran asla
  // birbirinden farklı bir liste göstermez.
  const [alerts, setAlerts] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<DashboardData>(
        '/dashboard',
        {
          range,
          from: range === 'custom' ? customFrom : undefined,
          to: range === 'custom' ? customTo : undefined,
        },
        signal,
      );
      setData(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Kontrol paneli yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [range, customFrom, customTo]);

  useEffect(() => {
    // Özel tarih seçiliyken iki uç da girilmeden istek atılmaz.
    if (range === 'custom' && (!customFrom || !customTo)) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, range, customFrom, customTo]);

  // Termin uyarıları dönem filtresinden BAĞIMSIZDIR: "son 7 gün" seçili
  // olsa bile 30 gün sonra terminlenen bir sipariş görünmelidir.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.get<{ data: NotificationItem[] }>(
          '/notifications', undefined, controller.signal,
        );
        setAlerts(response.data.filter((item) => item.kind !== 'TASK_OVERDUE'));
      } catch {
        // Uyarı şeridi kritik değil; alınamazsa gizlenir.
      }
    })();
    return () => controller.abort();
  }, []);

  const kpis = data?.kpis;

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Kontrol Paneli</h1>
          <p>Satış hunisi, kayıp analizi ve dönemsel performans.</p>
        </div>

        <div className="page-actions">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`btn btn-sm${range === preset.key ? ' btn-primary' : ''}`}
              onClick={() => setRange(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {range === 'custom' && (
        <div className="card mb-4">
          <div className="card-body flex items-center gap-3 flex-wrap">
            <label className="field-label" style={{ marginBottom: 0 }} htmlFor="range-from">Başlangıç</label>
            <input
              id="range-from" type="date" className="input" style={{ width: 'auto' }}
              value={customFrom} onChange={(event) => setCustomFrom(event.target.value)}
            />
            <label className="field-label" style={{ marginBottom: 0 }} htmlFor="range-to">Bitiş</label>
            <input
              id="range-to" type="date" className="input" style={{ width: 'auto' }}
              value={customTo} onChange={(event) => setCustomTo(event.target.value)}
            />
            {(!customFrom || !customTo) && (
              <span className="text-sm text-muted">İki tarihi de seçin.</span>
            )}
          </div>
        </div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      {loading && !data && (
        <div className="loading-center"><span className="spinner spinner-lg" /><span>Yükleniyor…</span></div>
      )}

      {kpis && data && (
        <>
          <div className="grid grid-4 mb-4">
            <button
              type="button" className="kpi" style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => navigate('/companies')}
            >
              <div className="kpi-label"><IconBuilding size={13} /> Toplam Kurum</div>
              <div className="kpi-value">{kpis.companyCount.toLocaleString('tr-TR')}</div>
              <div className="kpi-sub">Dönemde +{kpis.newCompanyCount} yeni</div>
            </button>

            <div className="kpi">
              <div className="kpi-label"><IconTrending size={13} /> Kazanılan Tutar</div>
              <div className="kpi-value">{formatTry(kpis.wonAmountTry)}</div>
              <div className="kpi-sub">
                {formatUsd(kpis.wonAmountUsd)} ·{' '}
                {kpis.winRate !== null ? `Kazanma oranı %${kpis.winRate}` : 'Kapanan iş yok'}
              </div>
            </div>

            <div className="kpi">
              <div className="kpi-label"><IconTrending size={13} /> Açık Fırsat Tutarı</div>
              <div className="kpi-value">{formatTry(kpis.openAmountTry)}</div>
              <div className="kpi-sub">
                {formatUsd(kpis.openAmountUsd)} · {kpis.dealCount} fırsat kaydı
              </div>
            </div>

            <button
              type="button" className="kpi" style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => navigate('/tenders')}
            >
              <div className="kpi-label"><IconGavel size={13} /> Açık İhale</div>
              <div className="kpi-value">{kpis.openTenders}</div>
              <div className="kpi-sub">{kpis.activeContracts} aktif sözleşme</div>
            </button>
          </div>

          {/*
            Tutarlar kayıt anındaki kurla değil, ANLIK kurla değerlenir.
            Kullanıcı hangi kurun kullanıldığını bilmeli — aksi halde iki
            farklı zamanda açılan ekranlardaki fark hata sanılır.
          */}
          {/*
            Termin uyarı şeridi.

            30/15/7 gün eşikleri ve gecikenler; zil ile aynı kaynaktan
            geldiği için iki ekran asla çelişmez.
          */}
          {alerts.length > 0 && (
            <div className="card mb-4">
              <div className="card-header">
                <h3><IconTruck size={15} /> Termin Uyarıları ({alerts.length})</h3>
                <button
                  type="button" className="btn btn-sm btn-ghost"
                  onClick={() => navigate('/contracts')}
                >
                  Sözleşmeler
                </button>
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                {alerts.slice(0, 6).map((alert) => (
                  <button
                    key={alert.id}
                    type="button"
                    className="delivery-alert"
                    onClick={() => navigate(alert.href)}
                  >
                    <span
                      className={`delivery-dot ${
                        alert.kind === 'DELIVERY_OVERDUE'
                          ? 'is-overdue'
                          : (alert.daysUntil ?? 99) <= 7 ? 'is-critical' : 'is-near'
                      }`}
                    />
                    <span className="delivery-alert-main">
                      <span className="delivery-alert-title">{alert.title}</span>
                      <span className="delivery-alert-meta">{alert.body}</span>
                    </span>
                    <span className="delivery-alert-days">
                      {alert.daysUntil === null
                        ? '—'
                        : alert.daysUntil < 0
                          ? `${Math.abs(alert.daysUntil)} gün geç`
                          : `${alert.daysUntil} gün`}
                    </span>
                  </button>
                ))}
                {alerts.length > 6 && (
                  <p className="text-xs text-muted mt-2">
                    +{alerts.length - 6} uyarı daha. Tümü için sözleşmeler ekranına bakın.
                  </p>
                )}
              </div>
            </div>
          )}

          {valuationLabel(data.valuation?.valuedAt) && (
            <p className="text-xs text-muted mb-4">
              Döviz tutarları bugünkü {valuationLabel(data.valuation?.valuedAt)} TL karşılığına
              çevrilmiştir. Sözleşme ve onaylı tekliflerde imza tarihindeki kur ayrıca gösterilir.
            </p>
          )}

          <div className="grid grid-4 mb-4">
            <button
              type="button" className="kpi" style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => navigate('/contacts')}
            >
              <div className="kpi-label"><IconUsers size={13} /> Kayıtlı Kişi</div>
              <div className="kpi-value">{kpis.contactCount.toLocaleString('tr-TR')}</div>
            </button>

            <button
              type="button" className="kpi" style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => navigate('/tickets')}
            >
              <div className="kpi-label"><IconWrench size={13} /> Açık Servis Talebi</div>
              <div className="kpi-value">{kpis.openTickets}</div>
            </button>

            <button
              type="button" className="kpi" style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => navigate('/tasks')}
            >
              <div className="kpi-label" style={{ color: kpis.overdueTasks > 0 ? 'var(--danger)' : undefined }}>
                <IconAlert size={13} /> Gecikmiş Görev
              </div>
              <div className="kpi-value" style={{ color: kpis.overdueTasks > 0 ? 'var(--danger)' : undefined }}>
                {kpis.overdueTasks}
              </div>
            </button>

            <div className="kpi">
              <div className="kpi-label">Dönem Eğilimi</div>
              <div className="mt-2">
                <SparkBars data={data.series} height={54} />
              </div>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <div className="card-header">
                <h2>Satış Hunisi</h2>
                <span className="text-sm text-muted">Aşamalar arası dönüşüm</span>
              </div>
              <div className="card-body">
                <FunnelChart stages={data.funnel} />
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2>Kayıp Nedenleri Dağılımı</h2>
                <span className="text-sm text-muted">{kpis.lostCount} kayıp</span>
              </div>
              <div className="card-body">
                <PieChart
                  data={data.lossReasons.map((item) => ({ label: item.reason, value: item.count }))}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
