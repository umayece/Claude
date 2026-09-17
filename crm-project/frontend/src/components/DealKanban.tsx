import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExchangeRates } from '../hooks/useExchangeRates';
import { IconEdit, IconFile, IconTrash, IconTrending } from './Icons';
import type { Deal } from '../types';

const STAGE_COLORS: Record<string, string> = {
  'Potansiyel': '#64748b',
  'İletişime Geçildi': '#0ea5e9',
  'Teklif Hazırlanıyor': '#6366f1',
  'Teklif Verildi': '#8b5cf6',
  'Müzakere': '#b8860b',
  'Kazanıldı': '#15803d',
  'Kaybedildi': '#b91c1c',
};

interface Props {
  deals: Deal[];
  stages: readonly string[];
  onStageChange: (deal: Deal, stage: string) => Promise<void>;
  onEdit: (deal: Deal) => void;
  onDelete: (deal: Deal) => void;
  onCreateOffer: (deal: Deal) => void;
  canWrite: boolean;
  canDelete: boolean;
}

/**
 * Sürükle-bırak fırsat hattı.
 *
 * Tarayıcının yerel HTML5 Drag & Drop API'si kullanılır — ek bağımlılık
 * yoktur ve klavye/dokunmatik geri dönüşü (kart üzerindeki aşama seçici)
 * korunur, çünkü HTML5 DnD dokunmatik cihazlarda çalışmaz.
 *
 * Aşama güncellemesi İYİMSER YAPILMAZ: sunucu yanıtı beklenir. Aksi halde
 * başarısız bir istekten sonra kart yanlış sütunda kalırdı.
 */
export function DealKanban({
  deals, stages, onStageChange, onEdit, onDelete, onCreateOffer, canWrite, canDelete,
}: Props) {
  const navigate = useNavigate();
  const { format } = useExchangeRates();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of stages) map.set(stage, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage);
      if (bucket) bucket.push(deal);
      // Bilinmeyen aşamadaki kayıt sessizce kaybolmasın diye ilk sütuna düşer.
      else map.get(stages[0] ?? '')?.push(deal);
    }
    return map;
  }, [deals, stages]);

  const move = async (deal: Deal, stage: string): Promise<void> => {
    if (deal.stage === stage) return;
    setPendingId(deal.id);
    try {
      await onStageChange(deal, stage);
    } finally {
      setPendingId(null);
    }
  };

  const handleDrop = async (stage: string): Promise<void> => {
    setDropStage(null);
    const deal = deals.find((d) => d.id === draggingId);
    setDraggingId(null);
    if (deal) await move(deal, stage);
  };

  return (
    <div className="kanban">
      {stages.map((stage) => {
        const items = byStage.get(stage) ?? [];
        const total = items.reduce(
          (sum, d) => sum + (d.amountTry ?? d.amount * d.exchangeRate), 0,
        );
        const color = STAGE_COLORS[stage] ?? '#64748b';

        return (
          <div
            key={stage}
            className={`kanban-column${dropStage === stage ? ' drop-target' : ''}`}
            onDragOver={(event) => {
              if (!canWrite) return;
              // preventDefault çağrılmazsa tarayıcı bırakmaya izin vermez.
              event.preventDefault();
              setDropStage(stage);
            }}
            onDragLeave={(event) => {
              // Alt öğeler arasında gezinirken sütunun vurgusu titremesin.
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDropStage((current) => (current === stage ? null : current));
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              void handleDrop(stage);
            }}
          >
            <div className="kanban-stripe" style={{ background: color }} />

            <div className="kanban-column-head">
              <span className="kanban-column-title" title={stage}>{stage}</span>
              <span className="kanban-column-count">{items.length}</span>
            </div>

            <div className="kanban-column-total">{format(total, 'TRY')}</div>

            <div className="kanban-column-body">
              {items.length === 0 && (
                <div className="kanban-empty">
                  {canWrite ? 'Kart sürükleyip bırakın' : 'Kayıt yok'}
                </div>
              )}

              {items.map((deal) => (
                <article
                  key={deal.id}
                  className={`kanban-card${draggingId === deal.id ? ' dragging' : ''}`}
                  draggable={canWrite && pendingId !== deal.id}
                  onDragStart={(event) => {
                    setDraggingId(deal.id);
                    event.dataTransfer.effectAllowed = 'move';
                    // Firefox sürüklemeyi başlatmak için veri taşınmasını ister.
                    event.dataTransfer.setData('text/plain', deal.id);
                  }}
                  onDragEnd={() => { setDraggingId(null); setDropStage(null); }}
                >
                  <div className="kanban-card-title">{deal.title}</div>

                  {deal.company && (
                    <div
                      className="kanban-card-company"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/companies/${deal.companyId}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') navigate(`/companies/${deal.companyId}`);
                      }}
                    >
                      {deal.company.name}
                    </div>
                  )}

                  <div className="kanban-card-foot">
                    <span className="kanban-card-amount">
                      {format(deal.amount, deal.currency)}
                    </span>
                    {deal.winProbabilityScore !== null && (
                      <span className={
                        deal.winProbabilityScore >= 70 ? 'badge badge-success'
                          : deal.winProbabilityScore >= 40 ? 'badge badge-warning'
                          : 'badge'
                      }>
                        %{deal.winProbabilityScore}
                      </span>
                    )}
                  </div>

                  {deal.expectedCloseDate && (
                    <div className="text-xs text-muted mt-1">
                      Kapanış: {new Date(deal.expectedCloseDate).toLocaleDateString('tr-TR')}
                    </div>
                  )}

                  {deal.lossReason && (
                    <div className="text-xs text-danger mt-1">Kayıp: {deal.lossReason}</div>
                  )}

                  {canWrite && (
                    <div className="kanban-card-actions">
                      {/* Dokunmatik cihazlarda HTML5 sürükleme çalışmaz;
                          aşama seçici her zaman kullanılabilir bir yedektir. */}
                      <select
                        className="select"
                        style={{ padding: '2px 5px', fontSize: 11, width: 'auto', flex: 1 }}
                        value={deal.stage}
                        disabled={pendingId === deal.id}
                        onChange={(event) => void move(deal, event.target.value)}
                        aria-label={`${deal.title} aşaması`}
                      >
                        {stages.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>

                      <button
                        type="button" className="btn btn-ghost btn-icon"
                        style={{ width: 24, height: 24 }}
                        title="Teklif oluştur"
                        aria-label="Teklif oluştur"
                        onClick={() => onCreateOffer(deal)}
                      >
                        <IconFile size={13} />
                      </button>

                      <button
                        type="button" className="btn btn-ghost btn-icon"
                        style={{ width: 24, height: 24 }}
                        title="Düzenle" aria-label="Düzenle"
                        onClick={() => onEdit(deal)}
                      >
                        <IconEdit size={13} />
                      </button>

                      {canDelete && (
                        <button
                          type="button" className="btn btn-ghost btn-icon"
                          style={{ width: 24, height: 24, color: 'var(--danger)' }}
                          title="Sil" aria-label="Sil"
                          onClick={() => onDelete(deal)}
                        >
                          <IconTrash size={13} />
                        </button>
                      )}
                    </div>
                  )}

                  {pendingId === deal.id && (
                    <div className="text-xs text-muted mt-1 flex items-center gap-1">
                      <span className="spinner" style={{ width: 10, height: 10 }} /> Güncelleniyor…
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        );
      })}

      {deals.length === 0 && (
        <div className="empty-state" style={{ flex: 1 }}>
          <IconTrending size={40} />
          <h3>Fırsat yok</h3>
          <p>Bu filtreyle eşleşen fırsat bulunamadı.</p>
        </div>
      )}
    </div>
  );
}
