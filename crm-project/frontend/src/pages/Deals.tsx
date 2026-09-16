import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useExchangeRates } from '../hooks/useExchangeRates';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { PipelineBar } from '../components/PipelineBar';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { IconEdit, IconPlus, IconSearch, IconTrash, IconTrending } from '../components/Icons';
import type { Company, CurrencyCode, Deal, Paginated } from '../types';

export const DEAL_STAGES = [
  'Potansiyel', 'İletişime Geçildi', 'Teklif Hazırlanıyor',
  'Teklif Verildi', 'Müzakere', 'Kazanıldı', 'Kaybedildi',
] as const;

export const LOSS_REASONS = [
  'Yüksek Fiyat', 'Şartname Uyumsuzluğu', 'Teslimat Süresi',
  'Rakip Tercihi', 'İhale İptali',
] as const;

const CURRENCIES: CurrencyCode[] = ['TRY', 'USD', 'EUR', 'GBP'];

/** Skoru renkli rozet olarak gösterir. */
export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-faint">—</span>;
  const cls = score >= 70 ? 'badge badge-success'
    : score >= 40 ? 'badge badge-warning'
    : 'badge badge-danger';
  return <span className={cls}>%{score}</span>;
}

interface FormState {
  title: string;
  companyId: string | null;
  stage: string;
  amount: string;
  currency: CurrencyCode;
  expectedCloseDate: string;
  description: string;
  lossReason: string;
  lossDetail: string;
}

const EMPTY: FormState = {
  title: '', companyId: null, stage: 'Potansiyel', amount: '0',
  currency: 'TRY', expectedCloseDate: '', description: '',
  lossReason: '', lossDetail: '',
};

export function Deals() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { format } = useExchangeRates();

  const [term, setTerm] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:deals:pageSize', 25);

  const [result, setResult] = useState<Paginated<Deal> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyTerm, setCompanyTerm] = useState('');
  const debouncedCompanyTerm = useDebounce(companyTerm, 300);
  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Deal>>(
        '/deals',
        { page, pageSize, q: debouncedTerm || undefined, stage: stageFilter || undefined },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Fırsatlar yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedTerm, stageFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm, stageFilter, pageSize]);

  useEffect(() => {
    if (!formOpen) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.get<Paginated<Company>>(
          '/companies', { q: debouncedCompanyTerm || undefined, pageSize: 30 }, controller.signal,
        );
        setCompanies(response.data);
      } catch {
        // Liste boş kalsa da form kullanılabilir.
      }
    })();
    return () => controller.abort();
  }, [formOpen, debouncedCompanyTerm]);

  // Derin bağlantı: /deals/:id doğrudan düzenlemeyi açar.
  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const deal = await api.get<Deal>(`/deals/${id}`);
        openEdit(deal);
      } catch {
        navigate('/deals', { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const companyOptions: SelectOption[] = useMemo(
    () => companies.map((company) => ({
      value: company.id,
      label: company.name,
      description: [company.type, company.city?.name].filter(Boolean).join(' · '),
    })),
    [companies],
  );

  function openCreate(): void {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(deal: Deal): void {
    setEditing(deal);
    setForm({
      title: deal.title,
      companyId: deal.companyId,
      stage: deal.stage,
      amount: String(deal.amount),
      currency: deal.currency,
      expectedCloseDate: deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : '',
      description: deal.description ?? '',
      lossReason: deal.lossReason ?? '',
      lossDetail: deal.lossDetail ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  const save = async (): Promise<void> => {
    if (!form.companyId) {
      setFormError('Müşteri seçimi zorunludur.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        title: form.title.trim(),
        companyId: form.companyId,
        stage: form.stage,
        amount: Number(form.amount) || 0,
        currency: form.currency,
        expectedCloseDate: form.expectedCloseDate || null,
        description: form.description || null,
        lossReason: form.stage === 'Kaybedildi' && form.lossReason ? form.lossReason : null,
        lossDetail: form.stage === 'Kaybedildi' ? form.lossDetail || null : null,
      };

      if (editing) await api.put(`/deals/${editing.id}`, payload);
      else await api.post('/deals', payload);

      setFormOpen(false);
      if (id) navigate('/deals', { replace: true });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Fırsat kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const changeStage = async (deal: Deal, stage: string): Promise<void> => {
    await api.put(`/deals/${deal.id}/stage`, { stage });
    await load();
  };

  const remove = async (deal: Deal): Promise<void> => {
    if (!window.confirm(`"${deal.title}" silinsin mi?`)) return;
    try {
      await api.delete(`/deals/${deal.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
    }
  };

  const closeForm = (): void => {
    setFormOpen(false);
    if (id) navigate('/deals', { replace: true });
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Satış Fırsatları</h1>
          <p>Aşama takibi, otomatik kazanma skoru ve kayıp analizi.</p>
        </div>

        {can('deal:write') && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <IconPlus size={15} /> Yeni Fırsat
            </button>
          </div>
        )}
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
              placeholder="Fırsat başlığı ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Fırsat ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}
            aria-label="Aşama filtresi"
          >
            <option value="">Tüm aşamalar</option>
            {DEAL_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </select>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconTrending size={42} />
            <h3>Fırsat bulunamadı</h3>
            <p>Yeni bir satış fırsatı oluşturarak süreci başlatabilirsiniz.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fırsat</th>
                    <th>Müşteri</th>
                    <th>Aşama</th>
                    <th className="text-right">Tutar</th>
                    <th className="text-right">TL Karşılığı</th>
                    <th className="text-right">Skor</th>
                    <th>Beklenen Kapanış</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((deal) => (
                    <tr key={deal.id}>
                      <td>
                        <div className="font-semibold">{deal.title}</div>
                        {deal.lossReason && (
                          <div className="text-xs text-danger">Kayıp: {deal.lossReason}</div>
                        )}
                      </td>

                      <td
                        className="text-sm"
                        style={{ color: 'var(--info)', cursor: 'pointer' }}
                        onClick={() => navigate(`/companies/${deal.companyId}`)}
                      >
                        {deal.company?.name ?? '—'}
                      </td>

                      <td><span className="badge badge-info">{deal.stage}</span></td>
                      <td className="text-right nowrap">{format(deal.amount, deal.currency)}</td>
                      <td className="text-right nowrap text-muted">
                        {format(deal.amountTry ?? deal.amount * deal.exchangeRate, 'TRY')}
                      </td>
                      <td className="text-right"><ScoreBadge score={deal.winProbabilityScore} /></td>
                      <td className="text-sm nowrap">
                        {deal.expectedCloseDate
                          ? new Date(deal.expectedCloseDate).toLocaleDateString('tr-TR')
                          : '—'}
                      </td>

                      <td className="col-actions">
                        <span className="row-actions">
                          {can('deal:write') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Düzenle" onClick={() => openEdit(deal)}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}
                          {can('deal:delete') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Sil" style={{ color: 'var(--danger)' }}
                              onClick={() => void remove(deal)}
                            >
                              <IconTrash size={15} />
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
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </div>

      <Modal
        open={formOpen}
        title={editing ? `${editing.title} — Düzenle` : 'Yeni Fırsat'}
        onClose={closeForm}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={closeForm}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving || form.title.trim().length < 2 || !form.companyId}
            >
              {saving && <span className="spinner" />} Kaydet
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-danger">{formError}</div>}

        {editing && (
          <div className="mb-4">
            <label className="field-label">Süreç Aşaması</label>
            <PipelineBar
              stages={DEAL_STAGES}
              current={form.stage}
              onChange={async (stage) => {
                setForm((prev) => ({ ...prev, stage }));
                await changeStage(editing, stage);
              }}
              disabled={!can('deal:write')}
            />
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="d-title">Başlık<span className="req">*</span></label>
          <input
            id="d-title" className="input" value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="d-company">Müşteri<span className="req">*</span></label>
          <SearchableSelect
            id="d-company"
            options={companyOptions}
            value={form.companyId}
            onChange={(value) => setForm((prev) => ({ ...prev, companyId: value }))}
            onSearch={setCompanyTerm}
            placeholder="Müşteri seçiniz…"
          />
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="d-amount">Tutar</label>
            <input
              id="d-amount" className="input" type="number" min={0} step="0.01"
              value={form.amount}
              onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="d-currency">Para Birimi</label>
            <select
              id="d-currency" className="select" value={form.currency}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, currency: event.target.value as CurrencyCode }))}
            >
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
            <div className="field-hint">TCMB kuru kayıt anında dondurulur.</div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="d-close">Beklenen Kapanış</label>
            <input
              id="d-close" className="input" type="date" value={form.expectedCloseDate}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, expectedCloseDate: event.target.value }))}
            />
          </div>
        </div>

        {!editing && (
          <div className="field">
            <label className="field-label" htmlFor="d-stage">Aşama</label>
            <select
              id="d-stage" className="select" value={form.stage}
              onChange={(event) => setForm((prev) => ({ ...prev, stage: event.target.value }))}
            >
              {DEAL_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
          </div>
        )}

        {form.stage === 'Kaybedildi' && (
          <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
            <div className="field">
              <label className="field-label" htmlFor="d-loss">Kayıp Nedeni</label>
              <select
                id="d-loss" className="select" value={form.lossReason}
                onChange={(event) => setForm((prev) => ({ ...prev, lossReason: event.target.value }))}
              >
                <option value="">Seçiniz…</option>
                {LOSS_REASONS.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="d-lossdetail">Kayıp Detayı</label>
              <input
                id="d-lossdetail" className="input" value={form.lossDetail}
                onChange={(event) => setForm((prev) => ({ ...prev, lossDetail: event.target.value }))}
              />
            </div>
          </div>
        )}

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="d-desc">Açıklama</label>
          <textarea
            id="d-desc" className="textarea" rows={3} value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
      </Modal>
    </>
  );
}
