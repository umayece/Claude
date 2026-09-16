import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useDebounce } from '../hooks/useDebounce';
import { useExchangeRates } from '../hooks/useExchangeRates';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { IconFile, IconSearch } from '../components/Icons';
import type { Offer, Paginated } from '../types';

const OFFER_STATUSES = ['Taslak', 'Gönderildi', 'Revize', 'Kabul', 'Ret', 'Süresi Doldu'] as const;

export function Offers() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { format } = useExchangeRates();

  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:offers:pageSize', 25);

  const [result, setResult] = useState<Paginated<Offer> | null>(null);
  const [detail, setDetail] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Offer>>(
        '/offers',
        { page, pageSize, q: debouncedTerm || undefined, status: statusFilter || undefined },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Teklifler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedTerm, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm, statusFilter, pageSize]);

  const openDetail = useCallback(async (offerId: string) => {
    try {
      setDetail(await api.get<Offer>(`/offers/${offerId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teklif yüklenemedi.');
    }
  }, []);

  useEffect(() => {
    if (id) void openDetail(id);
  }, [id, openDetail]);

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Teklifler</h1>
          <p>Kalem bazlı fiyatlandırma, KDV ve iskonto hesabı sunucu tarafında yapılır.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card">
        <div className="card-header" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <IconSearch
              size={15}
              style={{
                position: 'absolute', left: 11, top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-faint)',
              }}
            />
            <input
              className="input" style={{ paddingLeft: 33 }}
              placeholder="Teklif başlığı veya numarası ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Teklif ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Durum filtresi"
          >
            <option value="">Tüm durumlar</option>
            {OFFER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconFile size={42} />
            <h3>Teklif yok</h3>
            <p>Fırsatlarınızdan teklif oluşturarak süreci ilerletin.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Teklif No</th><th>Başlık</th><th>Müşteri</th><th>Durum</th>
                    <th className="text-right">Tutar</th><th>Geçerlilik</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((offer) => (
                    <tr key={offer.id} className="clickable" onClick={() => void openDetail(offer.id)}>
                      <td className="mono">{offer.offerNumber}</td>
                      <td className="font-semibold">{offer.title}</td>
                      <td className="text-sm">{offer.company?.name ?? '—'}</td>
                      <td><span className="badge badge-info">{offer.status}</span></td>
                      <td className="text-right nowrap">{format(offer.total, offer.currency)}</td>
                      <td className="text-sm nowrap">
                        {offer.validUntil
                          ? new Date(offer.validUntil).toLocaleDateString('tr-TR')
                          : '—'}
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
        open={detail !== null}
        title={detail ? `${detail.offerNumber} — ${detail.title}` : ''}
        onClose={() => { setDetail(null); if (id) navigate('/offers', { replace: true }); }}
        size="xl"
      >
        {detail && (
          <>
            <div className="grid grid-3 mb-4">
              <div className="kpi">
                <div className="kpi-label">Ara Toplam</div>
                <div className="kpi-value" style={{ fontSize: 19 }}>
                  {format(detail.subtotal, detail.currency)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">KDV</div>
                <div className="kpi-value" style={{ fontSize: 19 }}>
                  {format(detail.taxTotal, detail.currency)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Genel Toplam</div>
                <div className="kpi-value" style={{ fontSize: 19 }}>
                  {format(detail.total, detail.currency)}
                </div>
              </div>
            </div>

            <h3 className="mb-2">Teklif Kalemleri</h3>
            {detail.items && detail.items.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Kalem</th><th className="text-right">Miktar</th><th>Birim</th>
                      <th className="text-right">Birim Fiyat</th><th className="text-right">İskonto</th>
                      <th className="text-right">KDV</th><th className="text-right">Satır Toplamı</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="font-semibold">{item.name}</div>
                          {item.description && (
                            <div className="text-xs text-muted">{item.description}</div>
                          )}
                        </td>
                        <td className="text-right">{item.quantity.toLocaleString('tr-TR')}</td>
                        <td className="text-sm">{item.unit}</td>
                        <td className="text-right nowrap">
                          {format(item.unitPrice, detail.currency)}
                        </td>
                        <td className="text-right">%{item.discountRate}</td>
                        <td className="text-right">%{item.taxRate}</td>
                        <td className="text-right nowrap font-semibold">
                          {format(item.lineTotal, detail.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">Bu teklifte kalem yok.</p>
            )}

            {detail.notes && (
              <>
                <h3 className="mb-2 mt-4">Notlar</h3>
                <p className="text-sm text-muted">{detail.notes}</p>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
