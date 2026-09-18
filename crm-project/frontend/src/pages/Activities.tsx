import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { SplitDrawer, SpecRow } from '../components/SplitDrawer';
import { useDeleteConfirm } from '../components/ConfirmDialog';
import {
  IconAlert, IconCalendar, IconCheck, IconDownload, IconEdit, IconFile, IconFlag,
  IconPlus, IconSearch, IconTrash, IconUpload, IconUsers, IconX,
} from '../components/Icons';
import { ACTIVITY_KINDS, ACTIVITY_STATUSES, INTEREST_LEVELS } from '../types';
import type {
  ActivityContactLink, ActivityKind, ActivityStatus, ActivitySummary,
  ActivityTeamMember, BusinessActivity, Contact, CurrencyCode, InterestLevel,
  Paginated,
} from '../types';

const CURRENCIES: CurrencyCode[] = ['USD', 'TRY', 'EUR', 'GBP'];
const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

/** Etkinlik türünün okunabilir adı. */
function kindLabel(kind: ActivityKind): string {
  return ACTIVITY_KINDS.find((item) => item.key === kind)?.label ?? kind;
}

function statusBadge(status: ActivityStatus): string {
  switch (status) {
    case 'Tamamlandı': return 'badge-success';
    case 'Devam Ediyor': return 'badge-info';
    case 'İptal': return 'badge-danger';
    default: return '';
  }
}

function interestBadge(level: InterestLevel): string {
  switch (level) {
    case 'Sıcak': return 'badge-danger';
    case 'Soğuk': return 'badge-info';
    default: return 'badge-warning';
  }
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('tr-TR') : '—';
}

/** Tarih aralığı: tek günlük etkinlikte bitiş tekrarlanmaz. */
function dateRange(start: string, end: string | null): string {
  const from = formatDate(start);
  if (!end) return from;
  const to = formatDate(end);
  return from === to ? from : `${from} – ${to}`;
}

interface FormState {
  title: string;
  type: ActivityKind;
  status: ActivityStatus;
  startDate: string;
  endDate: string;
  location: string;
  venue: string;
  country: string;
  countryCode: string;
  objective: string;
  budgetAmount: string;
  budgetCurrency: CurrencyCode;
  companyId: string | null;
}

const EMPTY: FormState = {
  title: '', type: 'FUAR', status: 'Planlandı',
  startDate: new Date().toISOString().slice(0, 10), endDate: '',
  location: '', venue: '', country: 'Türkiye', countryCode: 'TR',
  objective: '', budgetAmount: '', budgetCurrency: 'USD', companyId: null,
};

interface LeadDraft {
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  phone: string;
  companyName: string;
  interest: InterestLevel;
  note: string;
}

const EMPTY_LEAD: LeadDraft = {
  firstName: '', lastName: '', title: '', email: '', phone: '',
  companyName: '', interest: 'Ilık', note: '',
};

export function Activities() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const confirmDelete = useDeleteConfirm();

  const [term, setTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:activities:pageSize', 25);

  const [result, setResult] = useState<Paginated<BusinessActivity> | null>(null);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<BusinessActivity | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<'leads' | 'team' | 'report'>('leads');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessActivity | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [companies, setCompanies] = useState<SelectOption[]>([]);

  // Kartvizit ekleme
  const [leadOpen, setLeadOpen] = useState(false);
  const [lead, setLead] = useState<LeadDraft>(EMPTY_LEAD);
  const [existingContactId, setExistingContactId] = useState<string | null>(null);
  const [contactOptions, setContactOptions] = useState<SelectOption[]>([]);
  const [leadError, setLeadError] = useState<string | null>(null);

  // Ekip üyesi
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState('');

  // Sonuç raporu
  const [outcomeNote, setOutcomeNote] = useState('');
  const [leadCount, setLeadCount] = useState('0');
  const [reportSaving, setReportSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [list, stats] = await Promise.all([
        api.get<Paginated<BusinessActivity>>('/activities', {
          page, pageSize,
          q: debouncedTerm || undefined,
          type: typeFilter || undefined,
          status: statusFilter || undefined,
        }, signal),
        api.get<ActivitySummary>('/activities/summary', undefined, signal),
      ]);
      setResult(list);
      setSummary(stats);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Aktiviteler alınamadı.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedTerm, typeFilter, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.get<{ data: { id: string; name: string }[] }>(
          '/companies', { pageSize: 200, sort: 'name' }, controller.signal,
        );
        setCompanies(response.data.map((row) => ({ value: row.id, label: row.name })));
      } catch {
        // Kurum listesi isteğe bağlıdır.
      }
    })();
    return () => controller.abort();
  }, []);

  const openDetail = useCallback(async (activityId: string) => {
    setDetailLoading(true);
    try {
      const data = await api.get<BusinessActivity>(`/activities/${activityId}`);
      setDetail(data);
      setOutcomeNote(data.outcomeNote ?? '');
      setLeadCount(String(data.leadCount));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktivite açılamadı.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Derin bağlantı: /activities/:id doğrudan detayı açar.
  useEffect(() => {
    if (id) void openDetail(id);
  }, [id, openDetail]);

  const startCreate = (): void => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setFormOpen(true);
  };

  const startEdit = (activity: BusinessActivity): void => {
    setEditing(activity);
    setForm({
      title: activity.title,
      type: activity.type,
      status: activity.status,
      startDate: activity.startDate.slice(0, 10),
      endDate: activity.endDate ? activity.endDate.slice(0, 10) : '',
      location: activity.location ?? '',
      venue: activity.venue ?? '',
      country: activity.country,
      countryCode: activity.countryCode,
      objective: activity.objective ?? '',
      budgetAmount: activity.budgetAmount != null ? String(activity.budgetAmount) : '',
      budgetCurrency: activity.budgetCurrency,
      companyId: activity.companyId,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async (): Promise<void> => {
    if (form.title.trim().length < 2) {
      setFormError('Başlık zorunludur.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        title: form.title.trim(),
        type: form.type,
        status: form.status,
        startDate: form.startDate,
        endDate: form.endDate || null,
        location: form.location || null,
        venue: form.venue || null,
        country: form.country.trim() || 'Türkiye',
        countryCode: (form.countryCode.trim() || 'TR').toUpperCase(),
        objective: form.objective || null,
        budgetAmount: form.budgetAmount === '' ? null : Number(form.budgetAmount) || 0,
        budgetCurrency: form.budgetCurrency,
        companyId: form.companyId,
      };
      if (editing) await api.put(`/activities/${editing.id}`, payload);
      else await api.post('/activities', payload);

      setFormOpen(false);
      await load();
      if (detail) await openDetail(detail.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Aktivite kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (activity: BusinessActivity): Promise<void> => {
    if (!(await confirmDelete(activity.title, 'Aktivite çöp kutusuna taşınır.'))) return;
    try {
      await api.delete(`/activities/${activity.id}`);
      if (detail?.id === activity.id) setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktivite silinemedi.');
    }
  };

  // --- Ekip ---

  const addMember = async (): Promise<void> => {
    if (!detail || memberName.trim().length < 2) return;
    try {
      await api.post(`/activities/${detail.id}/team`, {
        fullName: memberName.trim(),
        role: memberRole || null,
        isAttending: true,
      });
      setMemberName('');
      setMemberRole('');
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Katılımcı eklenemedi.');
    }
  };

  /** Katılım durumunu çevirir; kişi listeden SİLİNMEZ, üstü çizilir. */
  const toggleAttendance = async (member: ActivityTeamMember): Promise<void> => {
    if (!detail) return;
    try {
      await api.put(`/activities/${detail.id}/team/${member.id}`, {
        isAttending: !member.isAttending,
      });
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Katılım durumu güncellenemedi.');
    }
  };

  const removeMember = async (member: ActivityTeamMember): Promise<void> => {
    if (!detail) return;
    try {
      await api.delete(`/activities/${detail.id}/team/${member.id}`);
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Katılımcı silinemedi.');
    }
  };

  // --- Kartvizitler / görüşülen kişiler ---

  const searchContacts = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setContactOptions([]);
      return;
    }
    try {
      const response = await api.get<Paginated<Contact>>('/contacts', {
        q: query, pageSize: 20,
      });
      setContactOptions(response.data.map((row) => ({
        value: row.id,
        label: `${row.firstName} ${row.lastName}${row.company ? ` — ${row.company.name}` : ' (bağımsız)'}`,
      })));
    } catch {
      setContactOptions([]);
    }
  }, []);

  const saveLead = async (): Promise<void> => {
    if (!detail) return;
    const hasNew = lead.firstName.trim() && lead.lastName.trim();
    if (!existingContactId && !hasNew) {
      setLeadError('Mevcut bir kişi seçin veya ad-soyad girin.');
      return;
    }
    setLeadError(null);
    try {
      await api.post(`/activities/${detail.id}/contacts`, {
        contactId: existingContactId ?? undefined,
        newContact: existingContactId
          ? undefined
          : {
            firstName: lead.firstName.trim(),
            lastName: lead.lastName.trim(),
            title: lead.title || null,
            email: lead.email || '',
            phone: lead.phone || null,
            contactType: 'Diğer',
            companyName: lead.companyName || null,
          },
        note: lead.note || null,
        interest: lead.interest,
      });
      setLeadOpen(false);
      setLead(EMPTY_LEAD);
      setExistingContactId(null);
      await openDetail(detail.id);
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : 'Kişi bağlanamadı.');
    }
  };

  const unlinkLead = async (link: ActivityContactLink): Promise<void> => {
    if (!detail) return;
    try {
      await api.delete(`/activities/${detail.id}/contacts/${link.id}`);
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bağlantı kaldırılamadı.');
    }
  };

  // --- Sonuç raporu ---

  const saveReport = async (): Promise<void> => {
    if (!detail) return;
    setReportSaving(true);
    try {
      await api.put(`/activities/${detail.id}`, {
        outcomeNote: outcomeNote || null,
        leadCount: Number(leadCount) || 0,
      });
      await openDetail(detail.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rapor kaydedilemedi.');
    } finally {
      setReportSaving(false);
    }
  };

  /** Raporu dosya olarak yükler (PDF/Word). */
  const uploadReport = async (file: File): Promise<void> => {
    if (!detail) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError('Dosya 7 MB sınırını aşıyor.');
      return;
    }
    setUploadError(null);
    try {
      // Dosya base64 olarak gönderilir; `readAsDataURL` başlık ekler,
      // virgülden sonrası saf base64 gövdedir.
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Dosya okunamadı.'));
        reader.readAsDataURL(file);
      });

      await api.post('/documents', {
        title: `${detail.title} — Sonuç Raporu`,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64: base64,
        category: detail.type === 'FUAR' ? 'FUAR_SONUC_RAPORU' : 'ETKINLIK_BELGESI',
        classification: 'Hizmete Özel',
        activityId: detail.id,
      });
      await openDetail(detail.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Dosya yüklenemedi.');
    }
  };

  /**
   * Belge indirme.
   *
   * Uç nokta Authorization başlığı ister; ham bir <a href> anonim istek
   * atıp 401 alırdı. `downloadFile` başlığı ekleyip blob'u kaydeder.
   */
  const downloadDocument = async (docId: string, fileName: string): Promise<void> => {
    setDownloadingId(docId);
    try {
      await downloadFile(`/documents/${docId}/download`, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya indirilemedi.');
    } finally {
      setDownloadingId(null);
    }
  };

  const attending = useMemo(
    () => (detail?.team ?? []).filter((member) => member.isAttending).length,
    [detail],
  );

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Aktiviteler</h1>
          <p>
            Fuar, toplantı, saha ziyareti ve fabrika gezileri. Kuruma bağlı olma
            zorunluluğu yoktur.
          </p>
        </div>
        {can('activity:write') && (
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            <IconPlus size={15} /> Yeni Aktivite
          </button>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {summary && (
        <div className="grid grid-4 mb-4">
          <div className="kpi">
            <div className="kpi-label"><IconCalendar size={13} /> Toplam Aktivite</div>
            <div className="kpi-value">{summary.total}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label"><IconCalendar size={13} /> Yaklaşan</div>
            <div className="kpi-value">{summary.upcoming}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label"><IconFlag size={13} /> Fuar</div>
            <div className="kpi-value">{summary.fairs}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label"><IconAlert size={13} /> Raporu Bekleyen</div>
            <div
              className="kpi-value"
              style={{ color: summary.awaitingReport > 0 ? 'var(--warning)' : undefined }}
            >
              {summary.awaitingReport}
            </div>
            <div className="kpi-sub">Bitmiş ama sonuç raporu yazılmamış fuarlar</div>
          </div>
        </div>
      )}

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
              placeholder="Etkinlik adı, yer veya ülke ara…"
              value={term} onChange={(event) => { setTerm(event.target.value); setPage(1); }}
              aria-label="Aktivite ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={typeFilter}
            onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}
            aria-label="Tür filtresi"
          >
            <option value="">Tüm türler</option>
            {ACTIVITY_KINDS.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>

          <select
            className="select" style={{ width: 'auto' }}
            value={statusFilter}
            onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}
            aria-label="Durum filtresi"
          >
            <option value="">Tüm durumlar</option>
            {ACTIVITY_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconCalendar size={42} />
            <h3>Aktivite bulunamadı</h3>
            <p>IDEF, Saha Expo veya DSEI gibi fuarları etkinlik olarak açabilirsiniz.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Etkinlik</th>
                    <th>Tür</th>
                    <th>Tarih</th>
                    <th>Yer</th>
                    <th>Durum</th>
                    <th className="text-right">Kişi</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((activity) => (
                    <tr
                      key={activity.id} className="clickable"
                      onClick={() => void openDetail(activity.id)}
                    >
                      <td>
                        <div className="font-semibold">{activity.title}</div>
                        <div className="text-xs text-muted mono">{activity.activityCode}</div>
                      </td>
                      <td className="text-sm nowrap">{kindLabel(activity.type)}</td>
                      <td className="text-sm nowrap">
                        {dateRange(activity.startDate, activity.endDate)}
                      </td>
                      <td className="text-sm">
                        {activity.location ?? '—'}
                        <div className="text-xs text-muted">{activity.country}</div>
                      </td>
                      <td>
                        <span className={`badge ${statusBadge(activity.status)}`}>
                          {activity.status}
                        </span>
                        {activity.type === 'FUAR' && !activity.outcomeReportAt
                          && new Date(activity.startDate) < new Date() && (
                          <div>
                            <span className="badge badge-warning" style={{ marginTop: 3 }}>
                              Rapor bekliyor
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="text-right nowrap">
                        {activity._count?.contacts ?? 0}
                        <span className="text-xs text-muted"> / {activity.leadCount}</span>
                      </td>
                      <td className="col-actions">
                        <span className="row-actions">
                          {can('activity:write') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon" aria-label="Düzenle"
                              onClick={(event) => { event.stopPropagation(); startEdit(activity); }}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}
                          {can('activity:delete') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Sil" style={{ color: 'var(--danger)' }}
                              onClick={(event) => { event.stopPropagation(); void remove(activity); }}
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

      {detail && (
        <SplitDrawer
          open
          title={`${detail.activityCode} — ${detail.title}`}
          subtitle={`${kindLabel(detail.type)} · ${detail.country}`}
          onClose={() => { setDetail(null); if (id) navigate('/activities', { replace: true }); }}
          left={
            <>
              <h3 className="mb-2">Künye</h3>
              <div className="spec-list mb-4">
                <SpecRow label="Durum">
                  <span className={`badge ${statusBadge(detail.status)}`}>{detail.status}</span>
                </SpecRow>
                <SpecRow label="Tarih">{dateRange(detail.startDate, detail.endDate)}</SpecRow>
                <SpecRow label="Yer">{detail.location}</SpecRow>
                <SpecRow label="Salon / Stand">{detail.venue}</SpecRow>
                <SpecRow label="Ülke">{`${detail.country} (${detail.countryCode})`}</SpecRow>
                <SpecRow label="Sorumlu">{detail.owner?.name}</SpecRow>
                <SpecRow label="Kurum">{detail.company?.name}</SpecRow>
                {detail.budgetAmount !== null && (
                  <SpecRow label="Bütçe">
                    {`${detail.budgetAmount.toLocaleString('tr-TR')} ${detail.budgetCurrency}`}
                  </SpecRow>
                )}
                <SpecRow label="Ekip">
                  {`${attending} katılıyor / ${detail.team?.length ?? 0} davetli`}
                </SpecRow>
                <SpecRow label="Sonuç Raporu">
                  {detail.outcomeReportAt
                    ? formatDate(detail.outcomeReportAt)
                    : <span className="badge badge-warning">Yazılmadı</span>}
                </SpecRow>
              </div>

              {detail.objective && (
                <>
                  <h3 className="mb-2 mt-3">Hedef</h3>
                  <p className="text-sm text-muted">{detail.objective}</p>
                </>
              )}
            </>
          }
          tabs={[
            { key: 'leads', label: 'Görüşülen Kişiler', icon: <IconUsers size={14} /> },
            { key: 'team', label: 'Ekip', icon: <IconCheck size={14} /> },
            { key: 'report', label: 'Sonuç Raporu', icon: <IconFile size={14} /> },
          ]}
          activeTab={tab}
          onTabChange={(key) => setTab(key as 'leads' | 'team' | 'report')}
          headerActions={
            can('activity:write') ? (
              <button type="button" className="btn btn-sm" onClick={() => startEdit(detail)}>
                <IconEdit size={13} /> Düzenle
              </button>
            ) : undefined
          }
        >
          {detailLoading && <div className="loading-center"><span className="spinner" /></div>}

          {tab === 'leads' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3>Toplanan Kartvizitler</h3>
                {can('activity:write') && (
                  <button
                    type="button" className="btn btn-sm btn-primary"
                    onClick={() => {
                      setLead(EMPTY_LEAD);
                      setExistingContactId(null);
                      setLeadError(null);
                      setLeadOpen(true);
                    }}
                  >
                    <IconPlus size={13} /> Kartvizit Ekle
                  </button>
                )}
              </div>

              <p className="text-xs text-muted mb-3">
                Yeni kişi açarken kurum bilgisi zorunlu değildir; kişi bağımsız olarak
                kaydedilir ve varsayılan olarak etkinliğin ülkesine ({detail.country})
                bağlanır.
              </p>

              {(detail.contacts?.length ?? 0) === 0 ? (
                <div className="empty-state" style={{ padding: 28 }}>
                  <p>Bu etkinliğe henüz kişi bağlanmadı.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Kişi</th>
                        <th>Ülke</th>
                        <th>İlgi</th>
                        <th>Not</th>
                        <th className="col-actions">İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.contacts?.map((link) => (
                        <tr key={link.id}>
                          <td>
                            <div className="font-semibold text-sm">
                              {link.contact?.firstName} {link.contact?.lastName}
                            </div>
                            <div className="text-xs text-muted">
                              {link.contact?.title ?? link.contact?.contactType}
                              {link.contact?.company && ` · ${link.contact.company.name}`}
                            </div>
                          </td>
                          <td className="text-sm nowrap">{link.contact?.country}</td>
                          <td>
                            <span className={`badge ${interestBadge(link.interest)}`}>
                              {link.interest}
                            </span>
                          </td>
                          <td className="text-xs text-muted">{link.note ?? '—'}</td>
                          <td className="col-actions">
                            <span className="row-actions">
                              <button
                                type="button" className="btn btn-ghost btn-icon"
                                aria-label="Kişi kartını aç"
                                onClick={() => navigate(`/contacts/${link.contactId}`)}
                              >
                                <IconUsers size={15} />
                              </button>
                              {can('activity:write') && (
                                <button
                                  type="button" className="btn btn-ghost btn-icon"
                                  aria-label="Bağlantıyı kaldır"
                                  style={{ color: 'var(--danger)' }}
                                  onClick={() => void unlinkLead(link)}
                                >
                                  <IconX size={15} />
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'team' && (
            <>
              <h3 className="mb-2">Katılımcı Ekip</h3>
              <p className="text-xs text-muted mb-3">
                Katılamayacağını bildiren kişi listeden silinmez, adının üzeri çizilir —
                kimin davet edildiği kaydın bir parçasıdır.
              </p>

              {can('activity:write') && (
                <div className="flex gap-2 mb-3" style={{ alignItems: 'flex-end' }}>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="field-label" htmlFor="ac-member">Ad Soyad</label>
                    <input
                      id="ac-member" className="input" value={memberName}
                      onChange={(event) => setMemberName(event.target.value)}
                    />
                  </div>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="field-label" htmlFor="ac-role">Görev</label>
                    <input
                      id="ac-role" className="input" value={memberRole}
                      onChange={(event) => setMemberRole(event.target.value)}
                      placeholder="Pazarlama Müdürü"
                    />
                  </div>
                  <button
                    type="button" className="btn btn-primary"
                    onClick={() => void addMember()}
                    disabled={memberName.trim().length < 2}
                  >
                    <IconPlus size={14} /> Ekle
                  </button>
                </div>
              )}

              {(detail.team?.length ?? 0) === 0 ? (
                <div className="empty-state" style={{ padding: 28 }}>
                  <p>Ekip listesi boş.</p>
                </div>
              ) : (
                detail.team?.map((member) => (
                  <div
                    key={member.id}
                    className={`participant-row${member.isAttending ? '' : ' absent'}`}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="participant-name">{member.fullName}</div>
                      <div className="participant-meta">
                        {member.role ?? '—'}
                        {!member.isAttending && ' · Katılmıyor'}
                      </div>
                    </div>

                    {can('activity:write') && (
                      <>
                        <button
                          type="button"
                          className={`btn btn-sm${member.isAttending ? '' : ' btn-primary'}`}
                          onClick={() => void toggleAttendance(member)}
                        >
                          {member.isAttending ? 'Katılmıyor' : 'Katılıyor'}
                        </button>
                        <button
                          type="button" className="btn btn-ghost btn-icon"
                          aria-label="Çıkar" style={{ color: 'var(--danger)' }}
                          onClick={() => void removeMember(member)}
                        >
                          <IconTrash size={15} />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {tab === 'report' && (
            <>
              <h3 className="mb-2">Fuar / Etkinlik Sonuç Raporu</h3>
              <p className="text-xs text-muted mb-3">
                Özet değerlendirme notu aşağıya yazılır; hazırlanan PDF veya Word
                dosyası ayrıca yüklenir. Rapor tarihi ilk kaydetmede damgalanır.
              </p>

              <div className="field">
                <label className="field-label" htmlFor="ac-outcome">Özet Değerlendirme</label>
                <textarea
                  id="ac-outcome" className="textarea" rows={7} value={outcomeNote}
                  onChange={(event) => setOutcomeNote(event.target.value)}
                  placeholder="Görüşülen heyetler, öne çıkan talepler, rakip gözlemleri, takip edilecek fırsatlar…"
                  disabled={!can('activity:write')}
                />
              </div>

              <div className="field" style={{ maxWidth: 220 }}>
                <label className="field-label" htmlFor="ac-leads">Toplanan Kartvizit Adedi</label>
                <input
                  id="ac-leads" className="input" type="number" min={0} value={leadCount}
                  onChange={(event) => setLeadCount(event.target.value)}
                  disabled={!can('activity:write')}
                />
                <span className="text-xs text-muted">
                  Sisteme işlenen: {detail.contacts?.length ?? 0}
                </span>
              </div>

              {can('activity:write') && (
                <button
                  type="button" className="btn btn-primary mb-4"
                  onClick={() => void saveReport()}
                  disabled={reportSaving}
                >
                  {reportSaving ? <span className="spinner" /> : <IconCheck size={14} />}
                  {' '}Raporu Kaydet
                </button>
              )}

              <h3 className="mb-2 mt-3">Rapor Dosyaları</h3>

              {uploadError && <div className="alert alert-danger">{uploadError}</div>}

              {can('document:write') && (
                <label className="dropzone mb-3" style={{ display: 'block' }}>
                  <IconUpload size={20} />
                  <div className="mt-2">PDF veya Word dosyası seçin (en fazla 7 MB)</div>
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadReport(file);
                      event.target.value = '';
                    }}
                  />
                </label>
              )}

              {(detail.documents?.length ?? 0) === 0 ? (
                <div className="empty-state" style={{ padding: 28 }}>
                  <p>Bu etkinliğe henüz dosya yüklenmedi.</p>
                </div>
              ) : (
                detail.documents?.map((doc) => (
                  <div key={doc.id} className="participant-row">
                    <IconFile size={17} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="participant-name">{doc.title}</div>
                      <div className="participant-meta">
                        {doc.fileName} · {(doc.sizeBytes / 1024).toFixed(0)} KB
                        {' · '}{formatDate(doc.createdAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={downloadingId === doc.id}
                      onClick={() => void downloadDocument(doc.id, doc.fileName)}
                    >
                      {downloadingId === doc.id
                        ? <span className="spinner" />
                        : <IconDownload size={13} />} İndir
                    </button>
                  </div>
                ))
              )}
            </>
          )}
        </SplitDrawer>
      )}

      {/* --- Aktivite formu --- */}
      <Modal
        open={formOpen}
        title={editing ? 'Aktiviteyi Düzenle' : 'Yeni Aktivite'}
        onClose={() => setFormOpen(false)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setFormOpen(false)}>
              Vazgeç
            </button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void save()} disabled={saving}
            >
              {saving ? <span className="spinner" /> : <IconCheck size={15} />} Kaydet
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-danger">{formError}</div>}

        <div className="field">
          <label className="field-label" htmlFor="ac-title">Başlık<span className="req">*</span></label>
          <input
            id="ac-title" className="input" value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="IDEF 2026 Uluslararası Savunma Sanayii Fuarı"
          />
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="ac-type">Tür</label>
            <select
              id="ac-type" className="select" value={form.type}
              onChange={(event) => setForm((prev) => ({
                ...prev, type: event.target.value as ActivityKind,
              }))}
            >
              {ACTIVITY_KINDS.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ac-status">Durum</label>
            <select
              id="ac-status" className="select" value={form.status}
              onChange={(event) => setForm((prev) => ({
                ...prev, status: event.target.value as ActivityStatus,
              }))}
            >
              {ACTIVITY_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label">Kurum <span className="text-faint">(isteğe bağlı)</span></label>
            <SearchableSelect
              options={companies}
              value={form.companyId}
              onChange={(value) => setForm((prev) => ({ ...prev, companyId: value }))}
              placeholder="Bağımsız etkinlik"
              clearable
            />
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="ac-start">Başlangıç<span className="req">*</span></label>
            <input
              id="ac-start" className="input" type="date" value={form.startDate}
              onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ac-end">Bitiş</label>
            <input
              id="ac-end" className="input" type="date" value={form.endDate}
              onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="ac-loc">Yer</label>
            <input
              id="ac-loc" className="input" value={form.location}
              onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
              placeholder="İstanbul Fuar Merkezi"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ac-venue">Salon / Stand</label>
            <input
              id="ac-venue" className="input" value={form.venue}
              onChange={(event) => setForm((prev) => ({ ...prev, venue: event.target.value }))}
              placeholder="Hall 3 · Stand B-114"
            />
          </div>
        </div>

        <div className="grid grid-4" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="ac-country">Ülke</label>
            <input
              id="ac-country" className="input" value={form.country}
              onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ac-cc">Ülke Kodu</label>
            <input
              id="ac-cc" className="input mono" maxLength={2} value={form.countryCode}
              onChange={(event) => setForm((prev) => ({
                ...prev, countryCode: event.target.value.toUpperCase(),
              }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ac-budget">Bütçe</label>
            <input
              id="ac-budget" className="input" type="number" min={0} step="0.01"
              value={form.budgetAmount}
              onChange={(event) => setForm((prev) => ({
                ...prev, budgetAmount: event.target.value,
              }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ac-budget-cur">Para Birimi</label>
            <select
              id="ac-budget-cur" className="select" value={form.budgetCurrency}
              onChange={(event) => setForm((prev) => ({
                ...prev, budgetCurrency: event.target.value as CurrencyCode,
              }))}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="ac-objective">Hedef / Amaç</label>
          <textarea
            id="ac-objective" className="textarea" rows={3} value={form.objective}
            onChange={(event) => setForm((prev) => ({ ...prev, objective: event.target.value }))}
          />
        </div>
      </Modal>

      {/* --- Kartvizit ekleme --- */}
      <Modal
        open={leadOpen}
        title="Kartvizit / Görüşülen Kişi"
        onClose={() => setLeadOpen(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setLeadOpen(false)}>
              Vazgeç
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void saveLead()}>
              <IconCheck size={15} /> Bağla
            </button>
          </>
        }
      >
        {leadError && <div className="alert alert-danger">{leadError}</div>}

        <div className="field">
          <label className="field-label">Sistemdeki Kişi</label>
          <SearchableSelect
            options={contactOptions}
            value={existingContactId}
            onChange={setExistingContactId}
            onSearch={(query) => void searchContacts(query)}
            placeholder="Ad yazarak arayın (en az 2 harf)"
            clearable
          />
        </div>

        {existingContactId === null && (
          <>
            <div className="alert alert-info">
              Kişi sistemde yoksa aşağıya girin. Kurum alanı serbest metindir; sahte
              şirket kaydı açılmaz, kişi bağımsız olarak kaydedilir.
            </div>

            <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
              <div className="field">
                <label className="field-label" htmlFor="ld-first">Ad</label>
                <input
                  id="ld-first" className="input" value={lead.firstName}
                  onChange={(event) => setLead((prev) => ({
                    ...prev, firstName: event.target.value,
                  }))}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ld-last">Soyad</label>
                <input
                  id="ld-last" className="input" value={lead.lastName}
                  onChange={(event) => setLead((prev) => ({
                    ...prev, lastName: event.target.value,
                  }))}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ld-title">Unvan / Rütbe</label>
                <input
                  id="ld-title" className="input" value={lead.title}
                  onChange={(event) => setLead((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="Savunma Ataşesi, Albay"
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ld-company">Kurum</label>
                <input
                  id="ld-company" className="input" value={lead.companyName}
                  onChange={(event) => setLead((prev) => ({
                    ...prev, companyName: event.target.value,
                  }))}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ld-email">E-Posta</label>
                <input
                  id="ld-email" className="input" type="email" value={lead.email}
                  onChange={(event) => setLead((prev) => ({ ...prev, email: event.target.value }))}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ld-phone">Telefon</label>
                <input
                  id="ld-phone" className="input" value={lead.phone}
                  onChange={(event) => setLead((prev) => ({ ...prev, phone: event.target.value }))}
                />
              </div>
            </div>
          </>
        )}

        <div className="field">
          <label className="field-label" htmlFor="ld-interest">İlgi Seviyesi</label>
          <select
            id="ld-interest" className="select" value={lead.interest}
            onChange={(event) => setLead((prev) => ({
              ...prev, interest: event.target.value as InterestLevel,
            }))}
          >
            {INTEREST_LEVELS.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="ld-note">Görüşme Notu</label>
          <textarea
            id="ld-note" className="textarea" rows={3} value={lead.note}
            onChange={(event) => setLead((prev) => ({ ...prev, note: event.target.value }))}
            placeholder="155mm mühimmat ile ilgilendi, numune ve fiyat listesi talep etti."
          />
        </div>
      </Modal>
    </>
  );
}
