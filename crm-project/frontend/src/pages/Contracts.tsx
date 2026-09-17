import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useExchangeRates } from '../hooks/useExchangeRates';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { SplitDrawer, SpecRow } from '../components/SplitDrawer';
import { printCorporateDocument } from '../utils/corporatePrint';
import { useDeleteConfirm } from '../components/ConfirmDialog';
import {
  IconCredit, IconDownload, IconEdit, IconFile, IconPlus, IconSearch, IconTrash,
} from '../components/Icons';
import type {
  Company, Contract, CurrencyCode, Paginated, PaymentMilestone,
} from '../types';

const CONTRACT_STATUSES = ['Taslak', 'Aktif', 'Askıda', 'Tamamlandı', 'Feshedildi'] as const;
const MILESTONE_STATUSES = ['Bekliyor', 'Faturalandı', 'Tahsil Edildi', 'Gecikti'] as const;
const CURRENCIES: CurrencyCode[] = ['TRY', 'USD', 'EUR', 'GBP'];

interface FormState {
  title: string;
  companyId: string | null;
  contractNumber: string;
  status: string;
  amount: string;
  currency: CurrencyCode;
  startDate: string;
  endDate: string;
  renewalDate: string;
  description: string;
}

const EMPTY: FormState = {
  title: '', companyId: null, contractNumber: '', status: 'Aktif', amount: '0',
  currency: 'TRY', startDate: '', endDate: '', renewalDate: '', description: '',
};

interface MilestoneForm {
  title: string;
  amount: string;
  currency: CurrencyCode;
  dueDate: string;
  status: string;
  invoiceNumber: string;
}

const EMPTY_MILESTONE: MilestoneForm = {
  title: '', amount: '0', currency: 'TRY',
  dueDate: new Date().toISOString().slice(0, 10),
  status: 'Bekliyor', invoiceNumber: '',
};

export function Contracts() {
  const confirmDelete = useDeleteConfirm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { format } = useExchangeRates();

  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:contracts:pageSize', 25);

  const [result, setResult] = useState<Paginated<Contract> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<Contract | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<PaymentMilestone | null>(null);
  const [milestoneForm, setMilestoneForm] = useState<MilestoneForm>(EMPTY_MILESTONE);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyTerm, setCompanyTerm] = useState('');
  const debouncedCompanyTerm = useDebounce(companyTerm, 300);
  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Contract>>(
        '/contracts',
        { page, pageSize, q: debouncedTerm || undefined, status: statusFilter || undefined },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Sözleşmeler yüklenemedi.');
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
        // Yardımcı liste.
      }
    })();
    return () => controller.abort();
  }, [formOpen, debouncedCompanyTerm]);

  const openDetail = useCallback(async (contractId: string) => {
    setDetailLoading(true);
    try {
      const contract = await api.get<Contract>(`/contracts/${contractId}`);
      setDetail(contract);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sözleşme yüklenemedi.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) void openDetail(id);
  }, [id, openDetail]);

  const companyOptions: SelectOption[] = useMemo(
    () => companies.map((company) => ({
      value: company.id, label: company.name,
      description: company.city?.name ?? undefined,
    })),
    [companies],
  );

  const openCreate = (): void => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (contract: Contract): void => {
    setEditing(contract);
    setForm({
      title: contract.title,
      companyId: contract.companyId,
      contractNumber: contract.contractNumber,
      status: contract.status,
      amount: String(contract.amount),
      currency: contract.currency,
      startDate: contract.startDate ? contract.startDate.slice(0, 10) : '',
      endDate: contract.endDate ? contract.endDate.slice(0, 10) : '',
      renewalDate: contract.renewalDate ? contract.renewalDate.slice(0, 10) : '',
      description: contract.description ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

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
        contractNumber: form.contractNumber || undefined,
        status: form.status,
        amount: Number(form.amount) || 0,
        currency: form.currency,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        renewalDate: form.renewalDate || null,
        description: form.description || null,
      };

      if (editing) await api.put(`/contracts/${editing.id}`, payload);
      else await api.post('/contracts', payload);

      setFormOpen(false);
      await load();
      if (detail) await openDetail(detail.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sözleşme kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (contract: Contract): Promise<void> => {
    const ok = await confirmDelete(contract.title, 'Bağlı hakediş kayıtları da silinir.');
    if (!ok) return;
    try {
      await api.delete(`/contracts/${contract.id}`);
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
    }
  };

  const saveMilestone = async (): Promise<void> => {
    if (!detail) return;
    const payload = {
      title: milestoneForm.title.trim(),
      amount: Number(milestoneForm.amount) || 0,
      currency: milestoneForm.currency,
      dueDate: milestoneForm.dueDate,
      status: milestoneForm.status,
      invoiceNumber: milestoneForm.invoiceNumber || null,
    };

    try {
      if (editingMilestone) {
        await api.put(`/contracts/${detail.id}/milestones/${editingMilestone.id}`, payload);
      } else {
        await api.post(`/contracts/${detail.id}/milestones`, payload);
      }
      setMilestoneOpen(false);
      setEditingMilestone(null);
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hakediş kaydedilemedi.');
    }
  };

  const removeMilestone = async (milestone: PaymentMilestone): Promise<void> => {
    if (!detail) return;
    if (!(await confirmDelete(milestone.title, 'Hakediş kaydı kalıcı olarak silinir.'))) return;
    try {
      await api.delete(`/contracts/${detail.id}/milestones/${milestone.id}`);
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hakediş silinemedi.');
    }
  };

  /**
   * Resmî PDF çıktısı — MKE kurumsal antetli şablon.
   *
   * Şablon `corporatePrint` modülünde tutulur; teklif ve sözleşme aynı
   * antet, taraflar tablosu ve kaşe/imza düzenini paylaşır.
   */
  const printContract = (contract: Contract): void => {
    const milestones = contract.milestones ?? [];

    const ok = printCorporateDocument({
      documentType: 'SÖZLEŞME',
      documentNumber: contract.contractNumber,
      title: contract.title,
      classification: 'Hizmete Özel',
      parties: [
        {
          label: 'Yüklenici (Satıcı)',
          name: 'MKE A.Ş.',
          lines: [
            'Makina ve Kimya Endüstrisi Anonim Şirketi',
            'Tandoğan, Ankara / Türkiye',
            'Vergi Dairesi: Başkent V.D.',
          ],
        },
        {
          label: 'İdare / Müşteri',
          name: contract.company?.name ?? '—',
          lines: [
            contract.company?.name ? 'Sözleşme tarafı' : '',
            contract.tender ? `İlgili ihale: ${contract.tender.tenderNumber}` : '',
            contract.offer ? `İlgili teklif: ${contract.offer.offerNumber}` : '',
          ].filter(Boolean),
        },
      ],
      sections: [
        {
          heading: 'Sözleşme Künyesi',
          rows: [
            ['Sözleşme No', contract.contractNumber],
            ['Konu', contract.title],
            ['Durum', contract.status],
            ['Sözleşme Bedeli', `${contract.amount.toLocaleString('tr-TR')} ${contract.currency}`],
            ...(contract.amountTryAtCreation
              ? ([['İmza Tarihindeki Değeri',
                  `${Math.round(contract.amountTryAtCreation).toLocaleString('tr-TR')} ₺`]] as [string, string][])
              : []),
            ['Güncel Piyasa Değeri',
              `${Math.round(contract.amountTry ?? 0).toLocaleString('tr-TR')} ₺`],
            ['Başlangıç Tarihi',
              contract.startDate ? new Date(contract.startDate).toLocaleDateString('tr-TR') : '—'],
            ['Bitiş Tarihi',
              contract.endDate ? new Date(contract.endDate).toLocaleDateString('tr-TR') : '—'],
            ['Yenileme Tarihi',
              contract.renewalDate ? new Date(contract.renewalDate).toLocaleDateString('tr-TR') : '—'],
          ],
        },
        ...(contract.description
          ? [{ heading: 'Sözleşmenin Konusu', paragraphs: [contract.description] }]
          : []),
        ...(milestones.length
          ? [{
              heading: 'Ödeme Planı (Hakedişler)',
              table: {
                headers: ['Hakediş', 'Tutar', 'Vade', 'Durum', 'Fatura No'],
                align: ['left', 'right', 'left', 'left', 'left'] as ('left' | 'right')[],
                rows: milestones.map((m) => [
                  m.title,
                  `${m.amount.toLocaleString('tr-TR')} ${m.currency}`,
                  new Date(m.dueDate).toLocaleDateString('tr-TR'),
                  m.effectiveStatus ?? m.status,
                  m.invoiceNumber ?? '—',
                ]),
              },
            }]
          : []),
        {
          heading: 'Genel Hükümler',
          paragraphs: [
            contract.terms?.trim() ||
              'Taraflar, işbu sözleşmede yer alan hükümleri eksiksiz yerine getirmeyi ' +
              'kabul ve taahhüt eder. Teslimat, muayene ve kabul işlemleri sözleşme ' +
              'eki teknik şartname hükümlerine göre yürütülür. Ödemeler, ödeme planında ' +
              'belirtilen hakediş takvimine uygun olarak gerçekleştirilir.',
            'İşbu sözleşmeden doğabilecek uyuşmazlıklarda Ankara Mahkemeleri ve ' +
            'İcra Daireleri yetkilidir.',
          ],
        },
      ],
      signatures: [
        { label: 'MKE A.Ş.', name: 'Yetkili İmza' },
        { label: contract.company?.name ?? 'İdare / Müşteri', name: 'Yetkili İmza' },
      ],
      footerNote: 'MKE A.Ş. · Makina ve Kimya Endüstrisi A.Ş. — Hizmete Özel',
    });

    if (!ok) setError('Açılır pencere engellendi. Tarayıcı ayarlarından izin verin.');
  };

  const closeDetail = (): void => {
    setDetail(null);
    if (id) navigate('/contracts', { replace: true });
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Sözleşmeler</h1>
          <p>Hakediş takvimi, tahsilat takibi ve resmî çıktı.</p>
        </div>

        {can('contract:write') && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <IconPlus size={15} /> Yeni Sözleşme
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
              placeholder="Sözleşme başlığı veya numarası ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Sözleşme ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Durum filtresi"
          >
            <option value="">Tüm durumlar</option>
            {CONTRACT_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconFile size={42} />
            <h3>Sözleşme yok</h3>
            <p>Kazanılan işlerinizi sözleşmeye dönüştürerek hakediş takibi yapın.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Sözleşme No</th>
                    <th>Başlık</th>
                    <th>Müşteri</th>
                    <th>Durum</th>
                    <th className="text-right">Tutar</th>
                    <th className="text-right">Hakediş</th>
                    <th>Bitiş</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((contract) => (
                    <tr key={contract.id}>
                      <td className="mono">{contract.contractNumber}</td>
                      <td className="font-semibold">{contract.title}</td>
                      <td className="text-sm">{contract.company?.name ?? '—'}</td>
                      <td><span className="badge badge-info">{contract.status}</span></td>
                      <td className="text-right nowrap">
                        {format(contract.amount, contract.currency)}
                      </td>
                      <td className="text-right">{contract._count?.milestones ?? 0}</td>
                      <td className="text-sm nowrap">
                        {contract.endDate
                          ? new Date(contract.endDate).toLocaleDateString('tr-TR')
                          : '—'}
                      </td>

                      <td className="col-actions">
                        <span className="row-actions">
                          <button
                            type="button" className="btn btn-sm"
                            onClick={() => void openDetail(contract.id)}
                          >
                            <IconCredit size={13} /> Detay / Hakedişler
                          </button>

                          {can('contract:write') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Düzenle" onClick={() => openEdit(contract)}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}

                          <button
                            type="button" className="btn btn-ghost btn-icon"
                            aria-label="Resmî PDF indir" title="Resmî PDF İndir"
                            onClick={() => void (async () => {
                              // Hakedişlerin çıktıya girebilmesi için detay yüklenir.
                              const full = await api.get<Contract>(`/contracts/${contract.id}`);
                              printContract(full);
                            })()}
                          >
                            <IconDownload size={15} />
                          </button>

                          {can('contract:delete') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Sil" style={{ color: 'var(--danger)' }}
                              onClick={() => void remove(contract)}
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

      {/* Hakediş çekmecesi */}
      {detail && (
        <SplitDrawer
          open
          title={`${detail.contractNumber} — ${detail.title}`}
          subtitle={detail.company?.name}
          onClose={closeDetail}
          left={
            <>
              <h3 className="mb-2">Künye</h3>
              <div className="spec-list mb-4">
                <SpecRow label="Durum"><span className="badge badge-info">{detail.status}</span></SpecRow>
                <SpecRow label="Tutar">{format(detail.amount, detail.currency)}</SpecRow>
                {/* Resmiyet kazanmış sözleşmede iki değerleme YAN YANA:
                    imza tarihindeki muhasebe değeri ve bugünkü piyasa değeri. */}
                {detail.amountTryAtCreation !== null && detail.amountTryAtCreation !== undefined && (
                  <SpecRow label="İmza Tarihi Değeri">
                    {format(detail.amountTryAtCreation, 'TRY')}
                  </SpecRow>
                )}
                <SpecRow label="Güncel Piyasa Değeri">
                  <span className="dual-amount">
                    <span className="dual-primary">{format(detail.amountTry ?? 0, 'TRY')}</span>
                    <span className="dual-secondary">
                      ≈ {format(detail.amountUsd ?? 0, 'USD')}
                    </span>
                    {detail.hasDrift && detail.driftPercent !== null
                      && detail.driftPercent !== undefined && (
                      <span className="rate-drift">
                        {detail.driftPercent > 0 ? '▲' : '▼'} %{Math.abs(detail.driftPercent).toFixed(1)}
                        {' '}kur farkı
                      </span>
                    )}
                  </span>
                </SpecRow>
                <SpecRow label="Başlangıç">
                  {detail.startDate ? new Date(detail.startDate).toLocaleDateString('tr-TR') : null}
                </SpecRow>
                <SpecRow label="Bitiş">
                  {detail.endDate ? new Date(detail.endDate).toLocaleDateString('tr-TR') : null}
                </SpecRow>
                <SpecRow label="Yenileme">
                  {detail.renewalDate ? new Date(detail.renewalDate).toLocaleDateString('tr-TR') : null}
                </SpecRow>
                <SpecRow label="Bağlı Teklif">{detail.offer?.offerNumber}</SpecRow>
                <SpecRow label="Bağlı İhale">{detail.tender?.tenderNumber}</SpecRow>
              </div>

              {detail.milestoneSummary && (
                <>
                  <h3 className="mb-2">Tahsilat Özeti</h3>
                  <div className="spec-list">
                    <SpecRow label="Tahsil Edilen">
                      <strong className="text-success">
                        {format(detail.milestoneSummary.collectedTry, 'TRY')}
                      </strong>
                    </SpecRow>
                    <SpecRow label="Bekleyen">
                      {format(detail.milestoneSummary.pendingTry, 'TRY')}
                    </SpecRow>
                    <SpecRow label="Geciken">
                      {detail.milestoneSummary.overdueCount > 0 ? (
                        <span className="badge badge-danger">
                          {detail.milestoneSummary.overdueCount} hakediş
                        </span>
                      ) : (
                        <span className="badge badge-success">yok</span>
                      )}
                    </SpecRow>
                  </div>
                </>
              )}

              {detail.description && (
                <>
                  <h3 className="mb-2 mt-4">Açıklama</h3>
                  <p className="text-sm text-muted">{detail.description}</p>
                </>
              )}
            </>
          }
          tabs={[{ key: 'milestones', label: 'Hakediş Takvimi', icon: <IconCredit size={14} /> }]}
          activeTab="milestones"
          onTabChange={() => undefined}
          headerActions={
            <button type="button" className="btn btn-sm" onClick={() => printContract(detail)}>
              <IconDownload size={13} /> Resmî PDF
            </button>
          }
        >
          {detailLoading && <div className="loading-center"><span className="spinner" /></div>}

          <div className="flex items-center justify-between mb-3">
            <h3>Ödeme Kilometre Taşları</h3>
            {can('contract:write') && (
              <button
                type="button" className="btn btn-sm btn-primary"
                onClick={() => {
                  setEditingMilestone(null);
                  setMilestoneForm({ ...EMPTY_MILESTONE, currency: detail.currency });
                  setMilestoneOpen(true);
                }}
              >
                <IconPlus size={13} /> Hakediş Ekle
              </button>
            )}
          </div>

          {detail.milestones && detail.milestones.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Hakediş</th>
                    <th className="text-right">Tutar</th>
                    <th>Vade</th>
                    <th>Durum</th>
                    <th>Fatura No</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.milestones.map((milestone) => (
                    <tr key={milestone.id}>
                      <td className="font-semibold">{milestone.title}</td>
                      <td className="text-right nowrap">
                        {format(milestone.amount, milestone.currency)}
                      </td>
                      <td className="text-sm nowrap">
                        {new Date(milestone.dueDate).toLocaleDateString('tr-TR')}
                      </td>
                      <td>
                        <span className={
                          milestone.isOverdue ? 'badge badge-danger'
                            : milestone.effectiveStatus === 'Tahsil Edildi' ? 'badge badge-success'
                            : 'badge'
                        }>
                          {milestone.effectiveStatus ?? milestone.status}
                          {milestone.isOverdue && ` (${milestone.daysOverdue} gün)`}
                        </span>
                      </td>
                      <td className="mono text-sm">{milestone.invoiceNumber ?? '—'}</td>
                      <td className="col-actions">
                        {can('contract:write') && (
                          <span className="row-actions">
                            <button
                              type="button" className="btn btn-ghost btn-icon" aria-label="Düzenle"
                              onClick={() => {
                                setEditingMilestone(milestone);
                                setMilestoneForm({
                                  title: milestone.title,
                                  amount: String(milestone.amount),
                                  currency: milestone.currency,
                                  dueDate: milestone.dueDate.slice(0, 10),
                                  status: milestone.status,
                                  invoiceNumber: milestone.invoiceNumber ?? '',
                                });
                                setMilestoneOpen(true);
                              }}
                            >
                              <IconEdit size={14} />
                            </button>
                            <button
                              type="button" className="btn btn-ghost btn-icon" aria-label="Sil"
                              style={{ color: 'var(--danger)' }}
                              onClick={() => void removeMilestone(milestone)}
                            >
                              <IconTrash size={14} />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 28 }}>
              <IconCredit size={34} />
              <p>Henüz hakediş tanımlanmamış. Örn: %20 Avans, %50 İlk Parti, %30 Kabul Testi.</p>
            </div>
          )}
        </SplitDrawer>
      )}

      {/* Hakediş formu */}
      <Modal
        open={milestoneOpen}
        title={editingMilestone ? 'Hakedişi Düzenle' : 'Yeni Hakediş'}
        onClose={() => setMilestoneOpen(false)}
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setMilestoneOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void saveMilestone()}
              disabled={milestoneForm.title.trim().length < 2}
            >
              Kaydet
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field-label" htmlFor="m-title">Başlık<span className="req">*</span></label>
          <input
            id="m-title" className="input" value={milestoneForm.title}
            placeholder="%20 Avans"
            onChange={(event) =>
              setMilestoneForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="m-amount">Tutar</label>
            <input
              id="m-amount" className="input" type="number" min={0} step="0.01"
              value={milestoneForm.amount}
              onChange={(event) =>
                setMilestoneForm((prev) => ({ ...prev, amount: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="m-currency">Para Birimi</label>
            <select
              id="m-currency" className="select" value={milestoneForm.currency}
              onChange={(event) =>
                setMilestoneForm((prev) => ({
                  ...prev, currency: event.target.value as CurrencyCode,
                }))}
            >
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="m-due">Vade Tarihi</label>
            <input
              id="m-due" className="input" type="date" value={milestoneForm.dueDate}
              onChange={(event) =>
                setMilestoneForm((prev) => ({ ...prev, dueDate: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="m-status">Durum</label>
            <select
              id="m-status" className="select" value={milestoneForm.status}
              onChange={(event) =>
                setMilestoneForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              {MILESTONE_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="m-invoice">Fatura No</label>
          <input
            id="m-invoice" className="input mono" value={milestoneForm.invoiceNumber}
            onChange={(event) =>
              setMilestoneForm((prev) => ({ ...prev, invoiceNumber: event.target.value }))}
          />
        </div>
      </Modal>

      {/* Sözleşme formu */}
      <Modal
        open={formOpen}
        title={editing ? `${editing.contractNumber} — Düzenle` : 'Yeni Sözleşme'}
        onClose={() => setFormOpen(false)}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setFormOpen(false)}>Vazgeç</button>
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

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="ct-title">Başlık<span className="req">*</span></label>
            <input
              id="ct-title" className="input" value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ct-number">Sözleşme No</label>
            <input
              id="ct-number" className="input mono" value={form.contractNumber}
              placeholder="Otomatik üretilir"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, contractNumber: event.target.value }))}
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ct-company">Müşteri<span className="req">*</span></label>
          <SearchableSelect
            id="ct-company"
            options={companyOptions}
            value={form.companyId}
            onChange={(value) => setForm((prev) => ({ ...prev, companyId: value }))}
            onSearch={setCompanyTerm}
            placeholder="Müşteri seçiniz…"
          />
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="ct-amount">Tutar</label>
            <input
              id="ct-amount" className="input" type="number" min={0} step="0.01"
              value={form.amount}
              onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ct-currency">Para Birimi</label>
            <select
              id="ct-currency" className="select" value={form.currency}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, currency: event.target.value as CurrencyCode }))}
            >
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ct-status">Durum</label>
            <select
              id="ct-status" className="select" value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              {CONTRACT_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="ct-start">Başlangıç</label>
            <input
              id="ct-start" className="input" type="date" value={form.startDate}
              onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ct-end">Bitiş</label>
            <input
              id="ct-end" className="input" type="date" value={form.endDate}
              onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ct-renewal">Yenileme</label>
            <input
              id="ct-renewal" className="input" type="date" value={form.renewalDate}
              onChange={(event) => setForm((prev) => ({ ...prev, renewalDate: event.target.value }))}
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="ct-desc">Açıklama</label>
          <textarea
            id="ct-desc" className="textarea" rows={3} value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
      </Modal>
    </>
  );
}
