import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useDebounce } from '../hooks/useDebounce';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { IconSearch, IconShield } from '../components/Icons';
import type { AuditLog, Paginated } from '../types';

export function AuditLogs() {
  const [term, setTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:audit:pageSize', 50);

  const [result, setResult] = useState<Paginated<AuditLog> | null>(null);
  const [actions, setActions] = useState<{ action: string; count: number }[]>([]);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<AuditLog>>(
        '/audit-logs',
        {
          page, pageSize,
          q: debouncedTerm || undefined,
          action: actionFilter || undefined,
          from: from || undefined,
          to: to || undefined,
        },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Denetim kayıtları yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedTerm, actionFilter, from, to]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm, actionFilter, from, to, pageSize]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await api.get<{ data: { action: string; count: number }[] }>(
          '/audit-logs/actions',
        );
        setActions(response.data);
      } catch {
        // Filtre listesi olmadan da tablo çalışır.
      }
    })();
  }, []);

  const statusClass = (code: number | null): string => {
    if (code === null) return 'badge';
    if (code >= 500) return 'badge badge-danger';
    if (code >= 400) return 'badge badge-warning';
    return 'badge badge-success';
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Denetim İzleri</h1>
          <p>
            Tüm veri değişiklikleri ve kimlik doğrulama olayları. Hassas alanlar
            (şifre, MFA anahtarı, token) kayıtlara maskelenerek yazılır.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card">
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
              placeholder="Kullanıcı e-postası, eylem veya varlık ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Denetim kaydı ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto', maxWidth: 240 }}
            value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}
            aria-label="Eylem filtresi"
          >
            <option value="">Tüm eylemler</option>
            {actions.map((item) => (
              <option key={item.action} value={item.action}>
                {item.action} ({item.count})
              </option>
            ))}
          </select>

          <input
            className="input" style={{ width: 'auto' }} type="date"
            value={from} onChange={(event) => setFrom(event.target.value)}
            aria-label="Başlangıç tarihi"
          />
          <input
            className="input" style={{ width: 'auto' }} type="date"
            value={to} onChange={(event) => setTo(event.target.value)}
            aria-label="Bitiş tarihi"
          />
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconShield size={42} />
            <h3>Kayıt bulunamadı</h3>
            <p>Seçtiğiniz aralıkta denetim kaydı yok.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Zaman</th><th>Kullanıcı</th><th>Eylem</th>
                    <th>Varlık</th><th>IP</th><th>Sonuç</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((log) => (
                    <tr key={log.id} className="clickable" onClick={() => setSelected(log)}>
                      <td className="text-sm nowrap">
                        {new Date(log.createdAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="text-sm">
                        {log.user?.name ?? log.userEmail ?? <span className="text-faint">sistem</span>}
                      </td>
                      <td><span className="badge mono">{log.action}</span></td>
                      <td className="text-sm">
                        {log.entityType}
                        {log.entityId && (
                          <div className="text-xs text-faint mono truncate" style={{ maxWidth: 190 }}>
                            {log.entityId}
                          </div>
                        )}
                      </td>
                      <td className="mono text-xs">{log.ip ?? '—'}</td>
                      <td>
                        <span className={statusClass(log.statusCode)}>
                          {log.statusCode ?? '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={result.meta.page}
              pageSize={result.meta.pageSize}
              total={result.meta.total}
              totalPages={result.meta.totalPages}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </div>

      <Modal
        open={selected !== null}
        title="Denetim Kaydı Ayrıntısı"
        onClose={() => setSelected(null)}
        size="lg"
      >
        {selected && (
          <>
            <div className="spec-list mb-3">
              <div className="spec-row">
                <span className="spec-key">Zaman</span>
                <span className="spec-val">
                  {new Date(selected.createdAt).toLocaleString('tr-TR')}
                </span>
              </div>
              <div className="spec-row">
                <span className="spec-key">Kullanıcı</span>
                <span className="spec-val">
                  {selected.user?.name ?? '—'}{' '}
                  {selected.userEmail && <span className="text-muted">({selected.userEmail})</span>}
                </span>
              </div>
              <div className="spec-row">
                <span className="spec-key">Eylem</span>
                <span className="spec-val mono">{selected.action}</span>
              </div>
              <div className="spec-row">
                <span className="spec-key">Varlık</span>
                <span className="spec-val mono">
                  {selected.entityType}{selected.entityId ? ` / ${selected.entityId}` : ''}
                </span>
              </div>
              <div className="spec-row">
                <span className="spec-key">IP</span>
                <span className="spec-val mono">{selected.ip ?? '—'}</span>
              </div>
              <div className="spec-row">
                <span className="spec-key">Tarayıcı</span>
                <span className="spec-val text-xs">{selected.userAgent ?? '—'}</span>
              </div>
            </div>

            <h3 className="mb-2">Değişiklikler</h3>
            <pre
              className="mono"
              style={{
                background: 'var(--surface-alt)', padding: 12, borderRadius: 8,
                overflowX: 'auto', fontSize: 12, margin: 0, maxHeight: 340,
              }}
            >
              {selected.changes
                ? JSON.stringify(selected.changes, null, 2)
                : 'Değişiklik verisi kaydedilmemiş.'}
            </pre>
          </>
        )}
      </Modal>
    </>
  );
}
