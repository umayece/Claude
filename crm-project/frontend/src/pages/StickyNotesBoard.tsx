import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { IconNote, IconPlus, IconTrash } from '../components/Icons';
import { useDeleteConfirm } from '../components/ConfirmDialog';
import type { StickyNote } from '../types';

const COLORS = ['#fef3c7', '#dcfce7', '#dbeafe', '#fce7f3', '#ede9fe', '#fee2e2'];

export function StickyNotesBoard() {
  const confirmDelete = useDeleteConfirm();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<'all' | 'personal' | 'linked'>('all');
  const debouncedTerm = useDebounce(term, 350);
  // Not başına bekleyen kaydetme zamanlayıcısı.
  const timers = useRef(new Map<string, number>());

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await api.get<Paginated<StickyNote>>(
        '/notes', { pageSize: 100, q: debouncedTerm || undefined, kind }, signal,
      );
      setNotes(response.data);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Notlar yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [debouncedTerm, kind]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Bileşen ayrılırken bekleyen zamanlayıcılar temizlenir.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  /**
   * Yazarken her tuş vuruşunda PUT atmak yerine 700 ms'lik sessizlikten
   * sonra tek istek gönderilir.
   */
  const scheduleSave = (id: string, patch: Partial<StickyNote>): void => {
    const existing = timers.current.get(id);
    if (existing) window.clearTimeout(existing);

    const timer = window.setTimeout(() => {
      timers.current.delete(id);
      void api.put(`/notes/${id}`, patch).catch(() => {
        setError('Not kaydedilemedi. Bağlantınızı kontrol edin.');
      });
    }, 700);

    timers.current.set(id, timer);
  };

  const create = async (): Promise<void> => {
    try {
      const note = await api.post<StickyNote>('/notes', {
        body: '',
        color: COLORS[notes.length % COLORS.length],
      });
      setNotes((prev) => [note, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not eklenemedi.');
    }
  };

  const update = (id: string, patch: Partial<StickyNote>): void => {
    setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, ...patch } : note)));
    scheduleSave(id, patch);
  };

  const remove = async (id: string): Promise<void> => {
    if (!(await confirmDelete('Bu not'))) return;
    // İyimser silme: sunucu hatasında liste yeniden yüklenir.
    setNotes((prev) => prev.filter((note) => note.id !== id));
    try {
      await api.delete(`/notes/${id}`);
    } catch {
      await load();
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Notlarım</h1>
          <p>
            Kişisel yapışkan notlar ve müşteri zaman tünelinden eklediğiniz notlar
            birlikte listelenir.
          </p>
        </div>

        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => void create()}>
            <IconPlus size={15} /> Yeni Not
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card mb-4">
        <div className="card-header" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <IconSearch
              size={15}
              style={{
                position: 'absolute', left: 11, top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-faint)',
              }}
            />
            <input
              className="input" style={{ paddingLeft: 33 }}
              placeholder="Not içeriği veya müşteri adı ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Not ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={kind}
            onChange={(event) => setKind(event.target.value as 'all' | 'personal' | 'linked')}
            aria-label="Not türü"
          >
            <option value="all">Tüm notlar</option>
            <option value="personal">Yalnızca kişisel</option>
            <option value="linked">Yalnızca müşteriye bağlı</option>
          </select>
        </div>
      </div>

      {loading && <div className="loading-center"><span className="spinner spinner-lg" /></div>}

      {!loading && notes.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <IconNote size={42} />
            <h3>Henüz not yok</h3>
            <p>Hızlı hatırlatmalar için yapışkan not ekleyin.</p>
            <button type="button" className="btn btn-primary" onClick={() => void create()}>
              <IconPlus size={15} /> İlk Notu Ekle
            </button>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <div className="notes-board">
          {notes.map((note) => (
            <div className="sticky-note" key={note.id} style={{ background: note.color }}>
              <input
                className="w-full"
                style={{
                  border: 0, background: 'transparent', fontWeight: 700,
                  fontSize: 13.5, color: '#422006', outline: 'none', marginBottom: 6,
                }}
                placeholder="Başlık"
                value={note.title ?? ''}
                onChange={(event) => update(note.id, { title: event.target.value })}
                aria-label="Not başlığı"
              />

              <textarea
                value={note.body}
                placeholder="Not…"
                onChange={(event) => update(note.id, { body: event.target.value })}
                aria-label="Not içeriği"
              />

              {note.company && (
                <button
                  type="button"
                  className="badge badge-info"
                  style={{
                    alignSelf: 'flex-start', marginBottom: 6, border: 0,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                  title="Müşteri kartını aç"
                  onClick={() => navigate(`/companies/${note.companyId}`)}
                >
                  <IconBuilding size={10} /> {note.company.name}
                </button>
              )}

              <div className="sticky-note-bar">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Renk: ${color}`}
                    onClick={() => update(note.id, { color })}
                    style={{
                      width: 15, height: 15, borderRadius: '50%', background: color,
                      border: note.color === color
                        ? '2px solid rgba(0,0,0,0.45)'
                        : '1px solid rgba(0,0,0,0.14)',
                      cursor: 'pointer', padding: 0,
                    }}
                  />
                ))}

                <button
                  type="button"
                  className="btn btn-ghost btn-icon ml-auto"
                  style={{ color: '#991b1b', width: 24, height: 24 }}
                  aria-label="Notu sil"
                  onClick={() => void remove(note.id)}
                >
                  <IconTrash size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
