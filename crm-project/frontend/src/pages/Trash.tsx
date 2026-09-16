import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Pagination } from '../components/Pagination';
import { IconAlert, IconArchive, IconRefresh, IconTrash } from '../components/Icons';
import type { Company, Paginated } from '../types';

export function Trash() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Company> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Company>>(
        '/companies/trash', { page, pageSize: 25 }, signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Çöp kutusu yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const restore = async (company: Company): Promise<void> => {
    setBusyId(company.id);
    try {
      await api.post(`/companies/${company.id}/restore`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Geri yüklenemedi.');
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (company: Company): Promise<void> => {
    const confirmed = window.confirm(
      `"${company.name}" KALICI olarak silinecek.\n\n` +
      'Bu işlem geri alınamaz; kişiler, fırsatlar, teklifler, sözleşmeler ve ' +
      'destek kayıtları da birlikte silinir. Devam edilsin mi?',
    );
    if (!confirmed) return;

    setBusyId(company.id);
    try {
      await api.delete(`/companies/${company.id}/permanent`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kalıcı silme başarısız.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Çöp Kutusu</h1>
          <p>Silinen kayıtlar 30 gün saklanır; süre dolduğunda otomatik temizlenir.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="alert alert-info">
        <IconAlert size={16} />
        <span>
          Bir kurumu geri yüklediğinizde, onunla <strong>birlikte</strong> silinen
          kişi, fırsat, teklif, sözleşme ve destek kayıtları da geri gelir.
          Daha önce ayrı olarak silinmiş kayıtlar çöp kutusunda kalmaya devam eder.
        </span>
      </div>

      <div className="card">
        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconArchive size={42} />
            <h3>Çöp kutusu boş</h3>
            <p>Silinen kurumlar burada 30 gün boyunca saklanır.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Kurum</th><th>Tip</th><th>Silinme Tarihi</th>
                    <th>Kalıcı Silinmesine</th><th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((company) => (
                    <tr key={company.id}>
                      <td className="font-semibold">{company.name}</td>
                      <td><span className="badge">{company.type}</span></td>
                      <td className="text-sm nowrap">
                        {company.deletedAt
                          ? new Date(company.deletedAt).toLocaleString('tr-TR')
                          : '—'}
                      </td>
                      <td>
                        <span className={
                          (company.daysUntilPurge ?? 0) <= 3
                            ? 'badge badge-danger' : 'badge badge-warning'
                        }>
                          {company.daysUntilPurge ?? 0} gün
                        </span>
                      </td>
                      <td className="col-actions">
                        <span className="row-actions" style={{ opacity: 1 }}>
                          <button
                            type="button" className="btn btn-sm"
                            disabled={busyId === company.id}
                            onClick={() => void restore(company)}
                          >
                            <IconRefresh size={13} /> Geri Yükle
                          </button>

                          {user?.role === 'ADMIN' && (
                            <button
                              type="button" className="btn btn-sm btn-danger"
                              disabled={busyId === company.id}
                              onClick={() => void purge(company)}
                            >
                              <IconTrash size={13} /> Kalıcı Sil
                            </button>
                          )}
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
    </>
  );
}
