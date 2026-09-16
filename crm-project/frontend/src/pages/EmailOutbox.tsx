import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useDebounce } from '../hooks/useDebounce';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { IconAlert, IconInbox, IconSearch } from '../components/Icons';
import type { EmailMessage, Paginated } from '../types';

export function EmailOutbox() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<EmailMessage> | null>(null);
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<EmailMessage>>(
        '/email/outbox', { page, pageSize: 25, q: debouncedTerm || undefined }, signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Giden kutusu yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedTerm]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm]);

  const openMessage = async (message: EmailMessage): Promise<void> => {
    try {
      // Liste yalnızca önizleme taşır; tam gövde ayrı uçtan çekilir.
      setSelected(await api.get<EmailMessage>(`/email/${message.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'E-posta açılamadı.');
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Giden Kutusu</h1>
          <p>CRM üzerinden gönderilen tüm e-postalar.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="alert alert-info">
        <IconAlert size={16} />
        <span>
          Kurumsal SMTP sunucusu tanımlanana kadar <strong>Yerel E-Posta Simülatörü</strong>
          {' '}kullanılıyor. Mesajlar gerçekten gönderilmez; burada ve müşterinin
          zaman tünelinde kayıt altına alınır.
        </span>
      </div>

      <div className="card">
        <div className="card-header">
          <div style={{ position: 'relative', flex: 1 }}>
            <IconSearch
              size={15}
              style={{
                position: 'absolute', left: 11, top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-faint)',
              }}
            />
            <input
              className="input" style={{ paddingLeft: 33 }}
              placeholder="Konu, alıcı veya içerik ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="E-posta ara"
            />
          </div>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconInbox size={42} />
            <h3>Giden e-posta yok</h3>
            <p>Müşteri kartından e-posta gönderdiğinizde burada listelenir.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tarih</th><th>Alıcı</th><th>Konu</th>
                    <th>Müşteri</th><th>Gönderen</th><th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((message) => (
                    <tr
                      key={message.id} className="clickable"
                      onClick={() => void openMessage(message)}
                    >
                      <td className="text-sm nowrap">
                        {new Date(message.sentAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="text-sm">{message.toAddress}</td>
                      <td>
                        <div className="font-semibold">{message.subject}</div>
                        {message.preview && (
                          <div className="text-xs text-muted truncate" style={{ maxWidth: 340 }}>
                            {message.preview}
                          </div>
                        )}
                      </td>
                      <td className="text-sm">{message.company?.name ?? '—'}</td>
                      <td className="text-sm">{message.user?.name ?? '—'}</td>
                      <td>
                        <span className={
                          message.status === 'SENT' ? 'badge badge-success' : 'badge badge-warning'
                        }>
                          {message.status === 'SENT' ? 'Gönderildi' : message.status}
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
            />
          </>
        )}
      </div>

      <Modal
        open={selected !== null}
        title={selected?.subject ?? ''}
        onClose={() => setSelected(null)}
        size="lg"
      >
        {selected && (
          <>
            <div className="spec-list mb-3">
              <div className="spec-row">
                <span className="spec-key">Alıcı</span>
                <span className="spec-val">{selected.toAddress}</span>
              </div>
              {selected.ccAddress && (
                <div className="spec-row">
                  <span className="spec-key">CC</span>
                  <span className="spec-val">{selected.ccAddress}</span>
                </div>
              )}
              <div className="spec-row">
                <span className="spec-key">Tarih</span>
                <span className="spec-val">
                  {new Date(selected.sentAt).toLocaleString('tr-TR')}
                </span>
              </div>
              <div className="spec-row">
                <span className="spec-key">Sağlayıcı</span>
                <span className="spec-val mono text-xs">{selected.provider}</span>
              </div>
            </div>

            {/* Gövde düz metin olarak gösterilir: kaydedilmiş HTML'i
                render etmek saklanan-XSS yüzeyi açardı. */}
            <div
              className="card"
              style={{ padding: 16, whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6 }}
            >
              {selected.bodyText ?? '(içerik yok)'}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
