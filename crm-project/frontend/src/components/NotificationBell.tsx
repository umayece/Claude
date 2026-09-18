import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { NotificationItem, NotificationKind } from '../types';
import {
  IconAlert, IconBell, IconCheck, IconClock, IconRefresh, IconTruck,
} from './Icons';

/**
 * Bildirim zili.
 *
 * Tek bir uç noktadan (`/notifications`) beslenir: gecikmiş görevler ve
 * termin uyarıları (30/15/7 gün kala ve gecikenler) aynı sıralı listede
 * gelir. Kaynaklar ayrı ayrı çekilseydi sayaç tutarsız olur, kullanıcı
 * "3 bildirim" görüp listede 5 satır bulurdu.
 */

function kindIcon(kind: NotificationKind) {
  switch (kind) {
    case 'DELIVERY_OVERDUE': return <IconAlert size={15} />;
    case 'DELIVERY_DUE': return <IconTruck size={15} />;
    default: return <IconClock size={15} />;
  }
}

/** Satırın renk sınıfı: geciken kırmızı, yaklaşan sarı. */
function kindClass(item: NotificationItem): string {
  if (item.kind === 'DELIVERY_OVERDUE') return 'notif-danger';
  if (item.kind === 'TASK_OVERDUE') return 'notif-danger';
  // Termine 7 günden az kaldıysa uyarı rengine geçer.
  if (item.daysUntil !== null && item.daysUntil <= 7) return 'notif-warning';
  return '';
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{
        data: NotificationItem[];
        meta: { total: number };
      }>('/notifications');
      setItems(response.data);
      setTotal(response.meta.total);
    } catch {
      // Bildirim listesi kritik değil; sessizce boş kalır.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Dakikada bir tazele: yeni gecikmeler ve terminler zile düşsün.
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  /** Görev bildiriminde tamamlama kısayolu; termin uyarısında yoktur. */
  const complete = async (item: NotificationItem): Promise<void> => {
    const taskId = item.id.startsWith('task:') ? item.id.slice(5) : null;
    if (!taskId) return;

    setCompleting(item.id);
    try {
      await api.post(`/tasks/${taskId}/complete`);
      // Listeden çıkar ve sayacı düşür — yeniden yükleme beklemeden.
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch {
      await load();
    } finally {
      setCompleting(null);
    }
  };

  const go = (item: NotificationItem): void => {
    setOpen(false);
    navigate(item.href);
  };

  return (
    <div className="bell" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Bildirimler${total > 0 ? ` (${total})` : ''}`}
        aria-expanded={open}
      >
        <IconBell size={18} />
        {total > 0 && <span className="bell-badge">{total > 99 ? '99+' : total}</span>}
      </button>

      {open && (
        <div className="dropdown">
          <div className="dropdown-header">
            <span>Bildirimler {total > 0 && `(${total})`}</span>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => void load()}
              aria-label="Yenile"
              disabled={loading}
            >
              <IconRefresh size={14} />
            </button>
          </div>

          <div className="dropdown-list">
            {loading && items.length === 0 && (
              <div className="dropdown-empty"><span className="spinner" /></div>
            )}

            {!loading && items.length === 0 && (
              <div className="dropdown-empty">
                <IconCheck size={26} style={{ color: 'var(--success)' }} />
                <div className="mt-2">Bekleyen bildiriminiz yok.</div>
                <div className="text-xs text-muted mt-1">
                  Gecikmiş görev ve yaklaşan termin bulunmuyor.
                </div>
              </div>
            )}

            {items.map((item) => (
              <div
                key={item.id}
                className={`notif-item ${kindClass(item)}`}
                role="button"
                tabIndex={0}
                onClick={() => go(item)}
                onKeyDown={(event) => { if (event.key === 'Enter') go(item); }}
              >
                <div className="notif-icon">{kindIcon(item.kind)}</div>

                <div className="notif-main">
                  <div className="notif-title">{item.title}</div>
                  <div className="notif-company">{item.body}</div>
                  {item.dueDate && (
                    <div className="notif-badge">{formatDate(item.dueDate)}</div>
                  )}
                </div>

                {item.kind === 'TASK_OVERDUE' && (
                  <button
                    type="button"
                    className="notif-complete"
                    title="Tamamlandı olarak işaretle"
                    aria-label={`${item.title} görevini tamamla`}
                    disabled={completing === item.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void complete(item);
                    }}
                  >
                    {completing === item.id
                      ? <span className="spinner" style={{ width: 12, height: 12 }} />
                      : <IconCheck size={14} />}
                  </button>
                )}
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <div className="card-footer text-center text-sm">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => { setOpen(false); navigate('/tasks?overdue=true'); }}
              >
                Görev listesini aç
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
