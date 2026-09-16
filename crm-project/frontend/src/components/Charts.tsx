import { useMemo } from 'react';
import type { FunnelStage } from '../types';

const STAGE_COLORS = [
  '#0a192f', '#14304f', '#1e4976', '#2563eb', '#0ea5e9', '#16a34a',
];

function formatTry(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} M ₺`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} B ₺`;
  }
  return `${value.toLocaleString('tr-TR')} ₺`;
}

/**
 * Kademeli satış hunisi.
 *
 * Genişlik, adet yerine "en geniş aşamaya oran" ile hesaplanır ve tabanda
 * %22'lik bir alt sınır uygulanır: aksi halde 0 kayıtlı aşamalar görünmez
 * olur ve huninin hangi adımda koptuğu anlaşılmaz.
 */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const maxCount = useMemo(
    () => Math.max(1, ...stages.map((stage) => stage.count)),
    [stages],
  );

  if (stages.length === 0) {
    return <div className="empty-state" style={{ padding: 28 }}><p>Gösterilecek fırsat yok.</p></div>;
  }

  return (
    <div className="funnel">
      {stages.map((stage, index) => {
        const ratio = Math.max(0.22, stage.count / maxCount);
        const color = STAGE_COLORS[Math.min(index, STAGE_COLORS.length - 1)];

        return (
          <div className="funnel-row" key={stage.stage}>
            <span className="funnel-conv">
              {stage.conversionRate !== null ? `↓ %${stage.conversionRate}` : ''}
            </span>

            <div className="funnel-bar-wrap">
              <div
                className="funnel-bar"
                style={{ width: `${ratio * 100}%`, background: color }}
                title={`${stage.stage}: ${stage.count} fırsat · ${formatTry(stage.totalTry)}`}
              >
                <span className="truncate">{stage.stage}</span>
                <span>{stage.count}</span>
              </div>
            </div>

            <span className="funnel-amount">{formatTry(stage.totalTry)}</span>
          </div>
        );
      })}
    </div>
  );
}

const PIE_COLORS = ['#dc2626', '#d97706', '#7c3aed', '#2563eb', '#0d9488', '#64748b'];

interface PieDatum {
  label: string;
  value: number;
}

/**
 * Pasta grafiği — saf SVG.
 *
 * Grafik kütüphanesi eklemek yerine `stroke-dasharray` ile çizilen halka:
 * paket boyutu artmaz ve tema renkleri doğrudan uygulanır.
 */
export function PieChart({ data, size = 150 }: { data: PieDatum[]; size?: number }) {
  const total = useMemo(() => data.reduce((sum, item) => sum + item.value, 0), [data]);

  if (total === 0) {
    return (
      <div className="empty-state" style={{ padding: 28 }}>
        <p>Bu dönemde kaybedilen anlaşma kaydı yok.</p>
      </div>
    );
  }

  const radius = size / 2 - 14;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="pie-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Kayıp nedenleri dağılımı">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((item, index) => {
            const fraction = item.value / total;
            const dash = fraction * circumference;
            const element = (
              <circle
                key={item.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={PIE_COLORS[index % PIE_COLORS.length]}
                strokeWidth={22}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${item.label}: ${item.value} (%${Math.round(fraction * 100)})`}</title>
              </circle>
            );
            offset += dash;
            return element;
          })}
        </g>

        <text
          x="50%" y="48%" textAnchor="middle"
          style={{ fontSize: 21, fontWeight: 700, fill: 'var(--text)' }}
        >
          {total}
        </text>
        <text
          x="50%" y="62%" textAnchor="middle"
          style={{ fontSize: 10.5, fill: 'var(--text-muted)' }}
        >
          kayıp
        </text>
      </svg>

      <div className="pie-legend">
        {data.map((item, index) => (
          <div className="pie-legend-row" key={item.label}>
            <span
              className="pie-swatch"
              style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}
            />
            <span className="truncate">{item.label}</span>
            <span className="pie-legend-count">
              {item.value} (%{Math.round((item.value / total) * 100)})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Basit çubuk zaman serisi — dashboard eğilim grafiği. */
export function SparkBars({ data, height = 90 }: { data: { date: string; totalTry: number }[]; height?: number }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.totalTry)), [data]);

  if (data.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1"
      style={{ height, alignItems: 'flex-end' }}
      role="img"
      aria-label="Dönem içi fırsat tutarı eğilimi"
    >
      {data.map((item) => (
        <div
          key={item.date}
          title={`${new Date(item.date).toLocaleDateString('tr-TR')}: ${formatTry(item.totalTry)}`}
          style={{
            flex: 1,
            minWidth: 2,
            height: `${Math.max(2, (item.totalTry / max) * 100)}%`,
            background: item.totalTry > 0 ? 'var(--mke-accent-dim)' : 'var(--border)',
            borderRadius: '2px 2px 0 0',
          }}
        />
      ))}
    </div>
  );
}
