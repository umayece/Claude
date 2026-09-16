import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Task } from '../types';
import {
  IconBell, IconCalendar, IconCheck, IconClock, IconMail, IconPhone, IconRefresh,
} from './Icons';

function typeIcon(type: string) {
  switch (type) {
    case 'Arama': return <IconPhone size={15} />;
    case 'E-Posta': return <IconMail size={15} />;
    case 'Toplantı': return <IconCalendar size={15} />;
    default: return <IconClock size={15} />;
  }
}

function formatDueDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/** Gecikmiş görevler için zil menüsü. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: Task[]; meta: { total: number } }>(
        '/tasks/overdue', { limit: 20 },
      );
      setTasks(response.data);
      setTotal(response.meta.total);
    } catch {
      // Bildirim listesi kritik değil; sessizce boş kalır.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Dakikada bir tazele: yeni gecikmeler zile düşsün.
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

  const complete = async (taskId: string): Promise<void> => {
    setCompleting(taskId);
    try {
      await api.post(`/tasks/${taskId}/complete`);
      // Listeden çıkar ve sayacı düşür — yeniden yükleme beklemeden.
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch {
      await load();
    } finally {
      setCompleting(null);
    }
  };

  const goToTask = (task: Task): void => {
    setOpen(false);
    if (task.companyId) navigate(`/companies/${task.companyId}`);
    else navigate('/tasks');
  };

  return (
    <div className="bell" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Bildirimler${total > 0 ? ` (${total} gecikmiş görev)` : ''}`}
        aria-expanded={open}
      >
        <IconBell size={18} />
        {total > 0 && <span className="bell-badge">{total > 99 ? '99+' : total}</span>}
      </button>

      {open && (
        <div className="dropdown">
          <div className="dropdown-header">
            <span>Gecikmiş Görevler {total > 0 && `(${total})`}</span>
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
            {loading && tasks.length === 0 && (
              <div className="dropdown-empty"><span className="spinner" /></div>
            )}

            {!loading && tasks.length === 0 && (
              <div className="dropdown-empty">
                <IconCheck size={26} style={{ color: 'var(--success)' }} />
                <div className="mt-2">Gecikmiş göreviniz yok.</div>
              </div>
            )}

            {tasks.map((task) => (
              <div
                key={task.id}
                className="notif-item"
                role="button"
                tabIndex={0}
                onClick={() => goToTask(task)}
                onKeyDown={(event) => { if (event.key === 'Enter') goToTask(task); }}
              >
                <div className="notif-icon">{typeIcon(task.type)}</div>

                <div className="notif-main">
                  {task.company && <div className="notif-company">{task.company.name}</div>}
                  <div className="notif-title">{task.title}</div>
                  <div className="notif-badge">
                    {task.daysOverdue && task.daysOverdue > 0
                      ? `${task.daysOverdue} Gün Gecikti`
                      : 'Süresi Doldu'}
                    {task.dueDate && ` — ${formatDueDate(task.dueDate)}`}
                  </div>
                </div>

                <button
                  type="button"
                  className="notif-complete"
                  title="Tamamlandı olarak işaretle"
                  aria-label={`${task.title} görevini tamamla`}
                  disabled={completing === task.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void complete(task.id);
                  }}
                >
                  {completing === task.id
                    ? <span className="spinner" style={{ width: 12, height: 12 }} />
                    : <IconCheck size={14} />}
                </button>
              </div>
            ))}
          </div>

          {total > tasks.length && (
            <div className="card-footer text-center text-sm">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => { setOpen(false); navigate('/tasks?overdue=true'); }}
              >
                Tümünü gör ({total})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
