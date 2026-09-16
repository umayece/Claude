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
import { AiAssistant } from '../components/AiAssistant';
import { ScoreBadge, LOSS_REASONS } from './Deals';
import {
  IconAlert, IconEdit, IconGavel, IconPlus, IconSearch, IconSparkles, IconTrash,
} from '../components/Icons';
import type { Company, CurrencyCode, Paginated, Tender } from '../types';

const TENDER_STAGES = [
  'Takipte', 'Şartname Alındı', 'Teklif Hazırlanıyor', 'Teklif Verildi',
  'Değerlendirmede', 'Kazanıldı', 'Kaybedildi', 'İptal',
] as const;

const CURRENCIES: CurrencyCode[] = ['TRY', 'USD', 'EUR', 'GBP'];

interface FormState {
  title: string;
  companyId: string | null;
  tenderNumber: string;
  status: string;
  method: string;
  estimatedValue: string;
  currency: CurrencyCode;
  submissionDeadline: string;
  announcementDate: string;
  description: string;
  specificationText: string;
  lossReason: string;
  lossDetail: string;
}

const EMPTY: FormState = {
  title: '', companyId: null, tenderNumber: '', status: 'Takipte', method: '',
  estimatedValue: '0', currency: 'TRY', submissionDeadline: '', announcementDate: '',
  description: '', specificationText: '', lossReason: '', lossDetail: '',
};

export function Tenders() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { format } = useExchangeRates();

  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:tenders:pageSize', 25);

  const [result, setResult] = useState<Paginated<Tender> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Tender | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [riskTender, setRiskTender] = useState<Tender | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyTerm, setCompanyTerm] = useState('');
  const debouncedCompanyTerm = useDebounce(companyTerm, 300);
  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Tender>>(
        '/tenders',
        { page, pageSize, q: debouncedTerm || undefined, status: statusFilter || undefined },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'İhaleler yüklenemedi.');
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
        // Yardımcı liste; hata yutulur.
      }
    })();
    return () => controller.abort();
  }, [formOpen, debouncedCompanyTerm]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const tender = await api.get<Tender>(`/tenders/${id}`);
        openEdit(tender);
      } catch {
        navigate('/tenders', { replace: true });
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

  function openEdit(tender: Tender): void {
    setEditing(tender);
    setForm({
      title: tender.title,
      companyId: tender.companyId,
      tenderNumber: tender.tenderNumber,
      status: tender.status,
      method: tender.method ?? '',
      estimatedValue: String(tender.estimatedValue),
      currency: tender.currency,
      submissionDeadline: tender.submissionDeadline ? tender.submissionDeadline.slice(0, 10) : '',
      announcementDate: tender.announcementDate ? tender.announcementDate.slice(0, 10) : '',
      description: tender.description ?? '',
      specificationText: tender.specificationText ?? '',
      lossReason: tender.lossReason ?? '',
      lossDetail: tender.lossDetail ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  const save = async (): Promise<void> => {
    if (!form.companyId) {
      setFormError('İdare / kurum seçimi zorunludur.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const isLost = form.status === 'Kaybedildi' || form.status === 'İptal';
      const payload = {
        title: form.title.trim(),
        companyId: form.companyId,
        tenderNumber: form.tenderNumber || undefined,
        status: form.status,
        method: form.method || null,
        estimatedValue: Number(form.estimatedValue) || 0,
        currency: form.currency,
        submissionDeadline: form.submissionDeadline || null,
        announcementDate: form.announcementDate || null,
        description: form.description || null,
        specificationText: form.specificationText || null,
        lossReason: isLost && form.lossReason ? form.lossReason : null,
        lossDetail: isLost ? form.lossDetail || null : null,
      };

      if (editing) await api.put(`/tenders/${editing.id}`, payload);
      else await api.post('/tenders', payload);

      setFormOpen(false);
      if (id) navigate('/tenders', { replace: true });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'İhale kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tender: Tender): Promise<void> => {
    if (!window.confirm(`"${tender.title}" silinsin mi?`)) return;
    try {
      await api.delete(`/tenders/${tender.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
    }
  };

  const closeForm = (): void => {
    setFormOpen(false);
    if (id) navigate('/tenders', { replace: true });
  };

  const deadlineBadge = (days: number | null | undefined) => {
    if (days === null || days === undefined) return <span className="text-faint">—</span>;
    if (days < 0) return <span className="badge badge-danger">{Math.abs(days)} gün geçti</span>;
    if (days <= 7) return <span className="badge badge-warning">{days} gün kaldı</span>;
    return <span className="badge">{days} gün</span>;
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>İhaleler</h1>
          <p>Şartname takibi, AI risk analizi ve teslim tarihi uyarıları.</p>
        </div>

        {can('tender:write') && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <IconPlus size={15} /> Yeni İhale
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
              placeholder="İhale başlığı veya numarası ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="İhale ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Durum filtresi"
          >
            <option value="">Tüm durumlar</option>
            {TENDER_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </select>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconGavel size={42} />
            <h3>İhale kaydı yok</h3>
            <p>Takip etmek istediğiniz ihaleleri ekleyin; şartname yükleyip risk analizi çıkarın.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>İhale No</th>
                    <th>Başlık</th>
                    <th>İdare</th>
                    <th>Durum</th>
                    <th className="text-right">Yaklaşık Bedel</th>
                    <th className="text-right">Skor</th>
                    <th>Son Teklif</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((tender) => (
                    <tr key={tender.id}>
                      <td className="mono">{tender.tenderNumber}</td>

                      <td>
                        <div className="font-semibold">{tender.title}</div>
                        {tender.hasSpecification ? (
                          <span className="badge badge-success">şartname yüklü</span>
                        ) : (
                          <span className="badge">şartname yok</span>
                        )}
                      </td>

                      <td
                        className="text-sm"
                        style={{ color: 'var(--info)', cursor: 'pointer' }}
                        onClick={() => navigate(`/companies/${tender.companyId}`)}
                      >
                        {tender.company?.name ?? '—'}
                      </td>

                      <td><span className="badge badge-info">{tender.status}</span></td>
                      <td className="text-right nowrap">
                        {format(tender.estimatedValue, tender.currency)}
                      </td>
                      <td className="text-right"><ScoreBadge score={tender.winProbabilityScore} /></td>
                      <td className="nowrap">{deadlineBadge(tender.daysUntilDeadline)}</td>

                      <td className="col-actions">
                        <span className="row-actions">
                          {can('ai:use') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Risk analizi"
                              title="AI şartname risk analizi"
                              style={{ color: 'var(--mke-accent-dim)' }}
                              onClick={() => setRiskTender(tender)}
                            >
                              <IconSparkles size={15} />
                            </button>
                          )}
                          {can('tender:write') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Düzenle" onClick={() => openEdit(tender)}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}
                          {can('tender:delete') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Sil" style={{ color: 'var(--danger)' }}
                              onClick={() => void remove(tender)}
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

      {/* Risk analizi */}
      <Modal
        open={riskTender !== null}
        title={riskTender ? `${riskTender.tenderNumber} — Şartname Risk Analizi` : ''}
        onClose={() => setRiskTender(null)}
        size="xl"
      >
        {riskTender && (
          <>
            {!riskTender.hasSpecification && (
              <div className="alert alert-warning">
                <IconAlert size={16} />
                <span>
                  Bu ihaleye şartname metni yüklenmemiş. Analiz yalnızca künye
                  verisine dayanacaktır; daha isabetli sonuç için şartnameyi ekleyin.
                </span>
              </div>
            )}

            <AiAssistant
              task="TENDER_RISK"
              entityId={riskTender.id}
              autoStart
              saveContext={{ tenderId: riskTender.id, companyId: riskTender.companyId }}
            />
          </>
        )}
      </Modal>

      <Modal
        open={formOpen}
        title={editing ? `${editing.tenderNumber} — Düzenle` : 'Yeni İhale'}
        onClose={closeForm}
        size="xl"
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
              stages={TENDER_STAGES}
              current={form.status}
              onChange={async (status) => {
                setForm((prev) => ({ ...prev, status }));
                await api.put(`/tenders/${editing.id}/stage`, { status });
                await load();
              }}
              disabled={!can('tender:write')}
            />
          </div>
        )}

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="tn-title">Başlık<span className="req">*</span></label>
            <input
              id="tn-title" className="input" value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tn-number">İhale No</label>
            <input
              id="tn-number" className="input mono" value={form.tenderNumber}
              placeholder="Boş bırakılırsa otomatik üretilir"
              onChange={(event) => setForm((prev) => ({ ...prev, tenderNumber: event.target.value }))}
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="tn-company">İdare / Kurum<span className="req">*</span></label>
          <SearchableSelect
            id="tn-company"
            options={companyOptions}
            value={form.companyId}
            onChange={(value) => setForm((prev) => ({ ...prev, companyId: value }))}
            onSearch={setCompanyTerm}
            placeholder="Kurum seçiniz…"
          />
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="tn-value">Yaklaşık Bedel</label>
            <input
              id="tn-value" className="input" type="number" min={0} step="0.01"
              value={form.estimatedValue}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, estimatedValue: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tn-currency">Para Birimi</label>
            <select
              id="tn-currency" className="select" value={form.currency}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, currency: event.target.value as CurrencyCode }))}
            >
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tn-method">İhale Usulü</label>
            <input
              id="tn-method" className="input" value={form.method}
              placeholder="Açık ihale, pazarlık…"
              onChange={(event) => setForm((prev) => ({ ...prev, method: event.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="tn-announce">İlan Tarihi</label>
            <input
              id="tn-announce" className="input" type="date" value={form.announcementDate}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, announcementDate: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tn-deadline">Son Teklif Tarihi</label>
            <input
              id="tn-deadline" className="input" type="date" value={form.submissionDeadline}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, submissionDeadline: event.target.value }))}
            />
          </div>
        </div>

        {(form.status === 'Kaybedildi' || form.status === 'İptal') && (
          <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
            <div className="field">
              <label className="field-label" htmlFor="tn-loss">Kayıp Nedeni</label>
              <select
                id="tn-loss" className="select" value={form.lossReason}
                onChange={(event) => setForm((prev) => ({ ...prev, lossReason: event.target.value }))}
              >
                <option value="">Seçiniz…</option>
                {LOSS_REASONS.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="tn-lossdetail">Kayıp Detayı</label>
              <input
                id="tn-lossdetail" className="input" value={form.lossDetail}
                onChange={(event) => setForm((prev) => ({ ...prev, lossDetail: event.target.value }))}
              />
            </div>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="tn-desc">Açıklama</label>
          <textarea
            id="tn-desc" className="textarea" rows={3} value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="tn-spec">
            Şartname Metni
            <span className="text-xs text-muted" style={{ fontWeight: 400, marginLeft: 6 }}>
              (AI risk analizinin girdisi)
            </span>
          </label>
          <textarea
            id="tn-spec" className="textarea" rows={10} value={form.specificationText}
            placeholder="Şartname metnini buraya yapıştırın…"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, specificationText: event.target.value }))}
          />
          <div className="field-hint">
            {form.specificationText.length.toLocaleString('tr-TR')} karakter
            {form.specificationText.length > 40000 &&
              ' — analizde ilk 40.000 karakter kullanılır.'}
          </div>
        </div>
      </Modal>
    </>
  );
}
