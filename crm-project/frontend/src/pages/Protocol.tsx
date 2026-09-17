import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { SplitDrawer, SpecRow, type DrawerTab } from '../components/SplitDrawer';
import { useConfirm, useDeleteConfirm } from '../components/ConfirmDialog';
import {
  IconAlert, IconCalendar, IconCheck, IconClock, IconEdit, IconFile,
  IconPlus, IconSearch, IconShield, IconTrash, IconUsers,
} from '../components/Icons';
import type {
  Paginated, ProtocolVisit, VisitAgendaItem, VisitParticipant,
} from '../types';

const VISIT_TYPES = [
  'ATAŞE_ZİYARETİ', 'DELEGASYON', 'FABRİKA_GEZİSİ', 'POLİGON_TESTİ', 'DİĞER',
] as const;
const VISIT_STATUSES = [
  'Planlandı', 'Onay Bekliyor', 'Devam Ediyor', 'Tamamlandı', 'İptal',
] as const;
const CLASSIFICATIONS = ['Tasnif Dışı', 'Hizmete Özel', 'Gizli'] as const;
const ACTIVITY_TYPES = [
  'KARŞILAMA', 'BRİFİNG', 'FABRİKA_GEZİSİ', 'POLİGON_TESTİ', 'YEMEK', 'TRANSFER', 'DİĞER',
] as const;
const CHECKLIST_CATEGORIES = [
  'HEDİYELİK', 'ARAÇ', 'YEMEK', 'GÜVENLİK', 'KONAKLAMA', 'SUNUM', 'DİĞER',
] as const;

const TYPE_LABELS: Record<string, string> = {
  'ATAŞE_ZİYARETİ': 'Ataşe Ziyareti',
  'DELEGASYON': 'Delegasyon',
  'FABRİKA_GEZİSİ': 'Fabrika Gezisi',
  'POLİGON_TESTİ': 'Poligon Testi',
  'DİĞER': 'Diğer',
};

function classificationClass(value: string): string {
  if (value === 'Gizli') return 'classification-badge cls-secret';
  if (value === 'Hizmete Özel') return 'classification-badge cls-internal';
  return 'classification-badge cls-public';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

interface VisitForm {
  title: string;
  visitType: string;
  status: string;
  country: string;
  countryCode: string;
  startDate: string;
  endDate: string;
  location: string;
  classification: string;
  summary: string;
}

const EMPTY_VISIT: VisitForm = {
  title: '', visitType: 'DELEGASYON', status: 'Planlandı',
  country: '', countryCode: 'TR',
  startDate: new Date().toISOString().slice(0, 10), endDate: '',
  location: '', classification: 'Hizmete Özel', summary: '',
};

type TabKey = 'agenda' | 'participants' | 'checklist' | 'documents';

export function Protocol() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const confirm = useConfirm();
  const confirmDelete = useDeleteConfirm();

  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [upcomingOnly, setUpcomingOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<Paginated<ProtocolVisit> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<ProtocolVisit | null>(null);
  const [tab, setTab] = useState<TabKey>('agenda');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProtocolVisit | null>(null);
  const [form, setForm] = useState<VisitForm>(EMPTY_VISIT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Alt kayıt formları
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [agendaForm, setAgendaForm] = useState({
    day: '', startTime: '09:00', endTime: '10:00', title: '',
    activityType: 'DİĞER', location: '', responsible: '', notes: '',
  });
  const [participantOpen, setParticipantOpen] = useState(false);
  const [participantForm, setParticipantForm] = useState({
    side: 'MISAFIR' as 'MISAFIR' | 'EV_SAHIBI',
    fullName: '', title: '', rank: '', organization: '', nationality: '',
    passportNo: '', email: '', phone: '',
  });
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistForm, setChecklistForm] = useState({ title: '', category: 'DİĞER', note: '' });

  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<ProtocolVisit>>(
        '/protocol-visits',
        {
          page, pageSize: 25,
          q: debouncedTerm || undefined,
          status: statusFilter || undefined,
          upcoming: upcomingOnly || undefined,
        },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Ziyaretler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedTerm, statusFilter, upcomingOnly]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm, statusFilter, upcomingOnly]);

  const openDetail = useCallback(async (visitId: string) => {
    try {
      setDetail(await api.get<ProtocolVisit>(`/protocol-visits/${visitId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ziyaret yüklenemedi.');
    }
  }, []);

  useEffect(() => {
    if (id) void openDetail(id);
  }, [id, openDetail]);

  const openCreate = (): void => {
    setEditing(null);
    setForm(EMPTY_VISIT);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (visit: ProtocolVisit): void => {
    setEditing(visit);
    setForm({
      title: visit.title,
      visitType: visit.visitType,
      status: visit.status,
      country: visit.country,
      countryCode: visit.countryCode,
      startDate: visit.startDate.slice(0, 10),
      endDate: visit.endDate ? visit.endDate.slice(0, 10) : '',
      location: visit.location ?? '',
      classification: visit.classification,
      summary: visit.summary ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const saveVisit = async (): Promise<void> => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        title: form.title.trim(),
        visitType: form.visitType,
        status: form.status,
        country: form.country.trim(),
        countryCode: form.countryCode.toUpperCase(),
        startDate: form.startDate,
        endDate: form.endDate || null,
        location: form.location || null,
        classification: form.classification,
        summary: form.summary || null,
      };

      if (editing) await api.put(`/protocol-visits/${editing.id}`, payload);
      else await api.post('/protocol-visits', payload);

      setFormOpen(false);
      await load();
      if (detail) await openDetail(detail.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ziyaret kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const removeVisit = async (visit: ProtocolVisit): Promise<void> => {
    if (!(await confirmDelete(visit.title, 'Program, katılımcı ve kontrol listesi de silinir.'))) return;
    try {
      await api.delete(`/protocol-visits/${visit.id}`);
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
    }
  };

  const toggleChecklist = async (itemId: string, isDone: boolean): Promise<void> => {
    if (!detail) return;
    try {
      await api.put(`/protocol-visits/${detail.id}/checklist/${itemId}`, { isDone });
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Güncellenemedi.');
    }
  };

  /** Katılımcı silinmez; gelmedi olarak işaretlenir (resmî heyet listesi). */
  const toggleAttendance = async (participant: VisitParticipant): Promise<void> => {
    if (!detail) return;

    if (participant.isAttending) {
      const ok = await confirm({
        title: 'Katılım Durumu',
        message: <><strong>{participant.fullName}</strong> gelmedi olarak işaretlensin mi?</>,
        detail: 'Kayıt silinmez; listede üstü çizili görünür ve heyet listesinde kalır.',
        confirmLabel: 'Gelmedi Olarak İşaretle',
        tone: 'warning',
      });
      if (!ok) return;
    }

    try {
      await api.put(`/protocol-visits/${detail.id}/participants/${participant.id}`, {
        isAttending: !participant.isAttending,
        absenceReason: participant.isAttending ? 'Katılmadı' : null,
      });
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Güncellenemedi.');
    }
  };

  const addAgenda = async (): Promise<void> => {
    if (!detail) return;
    try {
      await api.post(`/protocol-visits/${detail.id}/agenda`, {
        ...agendaForm,
        day: agendaForm.day || detail.startDate.slice(0, 10),
        endTime: agendaForm.endTime || null,
        location: agendaForm.location || null,
        responsible: agendaForm.responsible || null,
        notes: agendaForm.notes || null,
      });
      setAgendaOpen(false);
      setAgendaForm({
        day: '', startTime: '09:00', endTime: '10:00', title: '',
        activityType: 'DİĞER', location: '', responsible: '', notes: '',
      });
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Program maddesi eklenemedi.');
    }
  };

  const addParticipant = async (): Promise<void> => {
    if (!detail) return;
    try {
      await api.post(`/protocol-visits/${detail.id}/participants`, {
        ...participantForm,
        title: participantForm.title || null,
        rank: participantForm.rank || null,
        organization: participantForm.organization || null,
        nationality: participantForm.nationality || null,
        passportNo: participantForm.passportNo || null,
        email: participantForm.email || null,
        phone: participantForm.phone || null,
      });
      setParticipantOpen(false);
      setParticipantForm({
        side: 'MISAFIR', fullName: '', title: '', rank: '', organization: '',
        nationality: '', passportNo: '', email: '', phone: '',
      });
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Katılımcı eklenemedi.');
    }
  };

  const addChecklistItem = async (): Promise<void> => {
    if (!detail) return;
    try {
      await api.post(`/protocol-visits/${detail.id}/checklist`, {
        ...checklistForm,
        note: checklistForm.note || null,
      });
      setChecklistOpen(false);
      setChecklistForm({ title: '', category: 'DİĞER', note: '' });
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kontrol maddesi eklenemedi.');
    }
  };

  const seedChecklist = async (): Promise<void> => {
    if (!detail) return;
    try {
      await api.post(`/protocol-visits/${detail.id}/checklist/seed`);
      await openDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Standart liste eklenemedi.');
    }
  };

  /** Program maddeleri güne göre gruplanır. */
  const agendaByDay = useMemo(() => {
    const map = new Map<string, VisitAgendaItem[]>();
    for (const item of detail?.agenda ?? []) {
      const key = item.day.slice(0, 10);
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [detail]);

  const guests = detail?.participants?.filter((p) => p.side === 'MISAFIR') ?? [];
  const hosts = detail?.participants?.filter((p) => p.side === 'EV_SAHIBI') ?? [];

  const tabs: DrawerTab[] = [
    { key: 'agenda', label: 'Ziyaret Programı', icon: <IconClock size={14} />, badge: detail?.agenda?.length },
    { key: 'participants', label: 'Katılımcılar', icon: <IconUsers size={14} />, badge: detail?.participants?.length },
    { key: 'checklist', label: 'Kontrol Listesi', icon: <IconCheck size={14} />, badge: detail?.checklist?.filter((c) => !c.isDone).length },
    { key: 'documents', label: 'Evraklar', icon: <IconFile size={14} />, badge: detail?.documents?.length },
  ];

  const stats = detail?.summaryStats;
  const checklistPercent = stats && stats.checklistTotal > 0
    ? Math.round((stats.checklistDone / stats.checklistTotal) * 100)
    : 0;

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Protokol & Heyet Programı</h1>
          <p>Yabancı askerî ataşe ve delegasyon ziyaretlerinin planlanması ve takibi.</p>
        </div>

        {can('protocol:write') && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <IconPlus size={15} /> Yeni Ziyaret
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card">
        <div className="card-header" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 210 }}>
            <IconSearch
              size={15}
              style={{
                position: 'absolute', left: 11, top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-faint)',
              }}
            />
            <input
              className="input" style={{ paddingLeft: 33 }}
              placeholder="Ziyaret başlığı, kod veya ülke ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Ziyaret ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Durum filtresi"
          >
            <option value="">Tüm durumlar</option>
            {VISIT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>

          <label className="checkbox-row">
            <input
              type="checkbox" checked={upcomingOnly}
              onChange={(event) => setUpcomingOnly(event.target.checked)}
            />
            <span>Yalnızca yaklaşanlar</span>
          </label>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconShield size={42} />
            <h3>Ziyaret kaydı yok</h3>
            <p>Gelecek heyet ve ataşe ziyaretlerini buradan planlayın.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Kod</th><th>Ziyaret</th><th>Ülke</th><th>Tür</th>
                    <th>Tarih</th><th>Durum</th><th>Hazırlık</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((visit) => (
                    <tr
                      key={visit.id} className="clickable"
                      onClick={() => void openDetail(visit.id)}
                    >
                      <td className="mono">{visit.visitCode}</td>
                      <td>
                        <div className="font-semibold">{visit.title}</div>
                        <span className={classificationClass(visit.classification)}>
                          {visit.classification}
                        </span>
                      </td>
                      <td className="text-sm">{visit.country}</td>
                      <td className="text-sm">{TYPE_LABELS[visit.visitType] ?? visit.visitType}</td>
                      <td className="text-sm nowrap">
                        {fmtDate(visit.startDate)}
                        {visit.daysUntilStart !== undefined && visit.daysUntilStart >= 0 && (
                          <div className="text-xs text-muted">{visit.daysUntilStart} gün kaldı</div>
                        )}
                      </td>
                      <td><span className="badge badge-info">{visit.status}</span></td>
                      <td>
                        {visit.pendingChecklist && visit.pendingChecklist > 0 ? (
                          <span className="badge badge-warning">
                            <IconAlert size={10} /> {visit.pendingChecklist} açık
                          </span>
                        ) : (
                          <span className="badge badge-success">hazır</span>
                        )}
                      </td>
                      <td className="col-actions">
                        <span className="row-actions">
                          {can('protocol:write') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon" aria-label="Düzenle"
                              onClick={(event) => { event.stopPropagation(); openEdit(visit); }}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}
                          {can('protocol:delete') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Sil" style={{ color: 'var(--danger)' }}
                              onClick={(event) => { event.stopPropagation(); void removeVisit(visit); }}
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
            />
          </>
        )}
      </div>

      {detail && (
        <SplitDrawer
          open
          title={`${detail.visitCode} — ${detail.title}`}
          subtitle={
            <span className="flex items-center gap-2">
              <span className="badge badge-info">{detail.status}</span>
              <span className={classificationClass(detail.classification)}>
                {detail.classification}
              </span>
              <span className="text-muted">{detail.country}</span>
            </span>
          }
          onClose={() => { setDetail(null); if (id) navigate('/protocol', { replace: true }); }}
          left={
            <>
              <h3 className="mb-2">Künye</h3>
              <div className="spec-list mb-4">
                <SpecRow label="Tür">{TYPE_LABELS[detail.visitType] ?? detail.visitType}</SpecRow>
                <SpecRow label="Ülke">{detail.country}</SpecRow>
                <SpecRow label="Başlangıç">{fmtDate(detail.startDate)}</SpecRow>
                <SpecRow label="Bitiş">{fmtDate(detail.endDate)}</SpecRow>
                <SpecRow label="Yer">{detail.location}</SpecRow>
                <SpecRow label="Protokol Sorumlusu">{detail.host?.name}</SpecRow>
                <SpecRow label="İlgili Kurum">
                  {detail.company && (
                    <span
                      role="button" tabIndex={0}
                      style={{ color: 'var(--info)', cursor: 'pointer' }}
                      onClick={() => navigate(`/companies/${detail.companyId}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') navigate(`/companies/${detail.companyId}`);
                      }}
                    >
                      {detail.company.name}
                    </span>
                  )}
                </SpecRow>
              </div>

              {stats && (
                <>
                  <h3 className="mb-2">Hazırlık Durumu</h3>
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span>Kontrol listesi</span>
                      <strong>{stats.checklistDone} / {stats.checklistTotal}</strong>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${checklistPercent}%` }} />
                    </div>
                  </div>

                  <div className="spec-list">
                    <SpecRow label="Misafir">
                      {stats.guestAttending} / {stats.guestCount} katılıyor
                    </SpecRow>
                    <SpecRow label="MKE Personeli">{stats.hostCount} kişi</SpecRow>
                    <SpecRow label="Program">{stats.agendaDays} gün</SpecRow>
                  </div>
                </>
              )}

              {detail.summary && (
                <>
                  <h3 className="mb-2 mt-4">Özet</h3>
                  <p className="text-sm text-muted">{detail.summary}</p>
                </>
              )}
            </>
          }
          tabs={tabs}
          activeTab={tab}
          onTabChange={(key) => setTab(key as TabKey)}
          headerActions={
            can('protocol:write') ? (
              <button type="button" className="btn btn-sm" onClick={() => openEdit(detail)}>
                <IconEdit size={14} /> Düzenle
              </button>
            ) : undefined
          }
        >
          {tab === 'agenda' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3>Ziyaret Akış Programı</h3>
                {can('protocol:write') && (
                  <button
                    type="button" className="btn btn-sm btn-primary"
                    onClick={() => {
                      setAgendaForm((prev) => ({ ...prev, day: detail.startDate.slice(0, 10) }));
                      setAgendaOpen(true);
                    }}
                  >
                    <IconPlus size={13} /> Madde Ekle
                  </button>
                )}
              </div>

              {agendaByDay.length === 0 ? (
                <div className="empty-state" style={{ padding: 28 }}>
                  <IconCalendar size={34} />
                  <p>Henüz program maddesi eklenmemiş.</p>
                </div>
              ) : (
                agendaByDay.map(([day, items]) => (
                  <div className="agenda-day" key={day}>
                    <div className="agenda-day-head">{fmtDate(day)}</div>
                    {items.map((item) => (
                      <div className="agenda-item" key={item.id}>
                        <div className="agenda-time">
                          {item.startTime}
                          {item.endTime && <div className="text-xs text-muted">{item.endTime}</div>}
                        </div>
                        <div>
                          <div className="agenda-title">{item.title}</div>
                          <div className="agenda-meta">
                            {[
                              item.activityType.replace(/_/g, ' '),
                              item.location,
                              item.responsible,
                            ].filter(Boolean).join(' · ')}
                          </div>
                          {item.notes && <div className="agenda-meta">{item.notes}</div>}
                        </div>
                        {can('protocol:write') && (
                          <button
                            type="button" className="btn btn-ghost btn-icon"
                            style={{ color: 'var(--danger)' }}
                            aria-label="Maddeyi sil"
                            onClick={() => void (async () => {
                              if (!(await confirmDelete(item.title))) return;
                              await api.delete(`/protocol-visits/${detail.id}/agenda/${item.id}`);
                              await openDetail(detail.id);
                            })()}
                          >
                            <IconTrash size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </>
          )}

          {tab === 'participants' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3>Katılımcı Listesi</h3>
                {can('protocol:write') && (
                  <button
                    type="button" className="btn btn-sm btn-primary"
                    onClick={() => setParticipantOpen(true)}
                  >
                    <IconPlus size={13} /> Katılımcı Ekle
                  </button>
                )}
              </div>

              <div className="alert alert-info">
                <IconAlert size={15} />
                <span>
                  Gelmeyen katılımcılar listeden silinmez, <strong>üstü çizili</strong> gösterilir —
                  heyet listesi resmî bir belgedir.
                </span>
              </div>

              <h3 className="mb-2 mt-3">
                <span className="side-badge side-guest">MİSAFİR HEYET</span> ({guests.length})
              </h3>
              {guests.length === 0 && <p className="text-sm text-muted">Kayıt yok.</p>}
              {guests.map((participant) => (
                <ParticipantRow
                  key={participant.id}
                  participant={participant}
                  canWrite={can('protocol:write')}
                  onToggle={() => void toggleAttendance(participant)}
                  onDelete={() => void (async () => {
                    if (!(await confirmDelete(participant.fullName))) return;
                    await api.delete(`/protocol-visits/${detail.id}/participants/${participant.id}`);
                    await openDetail(detail.id);
                  })()}
                />
              ))}

              <h3 className="mb-2 mt-4">
                <span className="side-badge side-host">EŞLİK EDEN MKE PERSONELİ</span> ({hosts.length})
              </h3>
              {hosts.length === 0 && <p className="text-sm text-muted">Kayıt yok.</p>}
              {hosts.map((participant) => (
                <ParticipantRow
                  key={participant.id}
                  participant={participant}
                  canWrite={can('protocol:write')}
                  onToggle={() => void toggleAttendance(participant)}
                  onDelete={() => void (async () => {
                    if (!(await confirmDelete(participant.fullName))) return;
                    await api.delete(`/protocol-visits/${detail.id}/participants/${participant.id}`);
                    await openDetail(detail.id);
                  })()}
                />
              ))}
            </>
          )}

          {tab === 'checklist' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3>Karşılama Kontrol Listesi</h3>
                {can('protocol:write') && (
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-sm" onClick={() => void seedChecklist()}>
                      Standart Listeyi Ekle
                    </button>
                    <button
                      type="button" className="btn btn-sm btn-primary"
                      onClick={() => setChecklistOpen(true)}
                    >
                      <IconPlus size={13} /> Madde
                    </button>
                  </div>
                )}
              </div>

              {(detail.checklist ?? []).length === 0 ? (
                <div className="empty-state" style={{ padding: 28 }}>
                  <IconCheck size={34} />
                  <p>Kontrol listesi boş. "Standart Listeyi Ekle" ile hazır maddeleri yükleyin.</p>
                </div>
              ) : (
                (detail.checklist ?? []).map((item) => (
                  <div
                    key={item.id}
                    className={`checklist-item${item.isDone ? ' done' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => can('protocol:write') && void toggleChecklist(item.id, !item.isDone)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && can('protocol:write')) {
                        void toggleChecklist(item.id, !item.isDone);
                      }
                    }}
                  >
                    <span className="checklist-box"><IconCheck size={13} /></span>
                    <span className="checklist-title">{item.title}</span>
                    <span className="badge">{item.category.replace(/_/g, ' ')}</span>
                  </div>
                ))
              )}
            </>
          )}

          {tab === 'documents' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3>Ziyaret Evrakları</h3>
                {can('document:write') && (
                  <button
                    type="button" className="btn btn-sm btn-primary"
                    onClick={() => navigate(`/documents?visitId=${detail.id}`)}
                  >
                    <IconPlus size={13} /> Evrak Yükle
                  </button>
                )}
              </div>

              <p className="text-sm text-muted mb-3">
                Diplomatik nota, pasaport listesi, brifing sunumu gibi evraklar buraya iliştirilir.
              </p>

              {(detail.documents ?? []).length === 0 ? (
                <div className="empty-state" style={{ padding: 28 }}>
                  <IconFile size={34} />
                  <p>Bu ziyarete ait evrak yok.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Belge</th><th>Tür</th><th>Gizlilik</th><th>Boyut</th><th /></tr>
                    </thead>
                    <tbody>
                      {(detail.documents ?? []).map((document) => (
                        <tr key={document.id}>
                          <td>
                            <div className="font-semibold">{document.title}</div>
                            <div className="text-xs text-muted">{document.fileName}</div>
                          </td>
                          <td className="text-sm">{document.category.replace(/_/g, ' ')}</td>
                          <td>
                            <span className={classificationClass(document.classification)}>
                              {document.classification}
                            </span>
                          </td>
                          <td className="text-sm nowrap">
                            {(document.sizeBytes / 1024).toFixed(0)} KB
                          </td>
                          <td className="col-actions">
                            <button
                              type="button" className="btn btn-sm"
                              onClick={() => navigate(`/documents?visitId=${detail.id}`)}
                            >
                              Depoda Aç
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </SplitDrawer>
      )}

      {/* --- Ziyaret formu --- */}
      <Modal
        open={formOpen}
        title={editing ? `${editing.visitCode} — Düzenle` : 'Yeni Ziyaret'}
        onClose={() => setFormOpen(false)}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setFormOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void saveVisit()}
              disabled={saving || form.title.trim().length < 3 || form.country.trim().length < 2}
            >
              {saving && <span className="spinner" />} Kaydet
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-danger">{formError}</div>}

        <div className="field">
          <label className="field-label" htmlFor="pv-title">Ziyaret Başlığı<span className="req">*</span></label>
          <input
            id="pv-title" className="input" value={form.title}
            placeholder="Katar Savunma Bakanlığı Heyet Ziyareti"
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="pv-type">Ziyaret Türü</label>
            <select
              id="pv-type" className="select" value={form.visitType}
              onChange={(event) => setForm((prev) => ({ ...prev, visitType: event.target.value }))}
            >
              {VISIT_TYPES.map((type) => (
                <option key={type} value={type}>{TYPE_LABELS[type] ?? type}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pv-status">Durum</label>
            <select
              id="pv-status" className="select" value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              {VISIT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pv-cls">Gizlilik Derecesi</label>
            <select
              id="pv-cls" className="select" value={form.classification}
              onChange={(event) => setForm((prev) => ({ ...prev, classification: event.target.value }))}
            >
              {CLASSIFICATIONS.map((cls) => <option key={cls} value={cls}>{cls}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="pv-country">Heyetin Ülkesi<span className="req">*</span></label>
            <input
              id="pv-country" className="input" value={form.country}
              placeholder="Katar"
              onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pv-cc">Ülke Kodu</label>
            <input
              id="pv-cc" className="input mono" value={form.countryCode} maxLength={2}
              placeholder="QA"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, countryCode: event.target.value.toUpperCase() }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pv-location">Yer</label>
            <input
              id="pv-location" className="input" value={form.location}
              placeholder="MKE Kırıkkale Fabrikası"
              onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="pv-start">Başlangıç<span className="req">*</span></label>
            <input
              id="pv-start" className="input" type="date" value={form.startDate}
              onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pv-end">Bitiş</label>
            <input
              id="pv-end" className="input" type="date" value={form.endDate}
              onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="pv-summary">Özet</label>
          <textarea
            id="pv-summary" className="textarea" rows={3} value={form.summary}
            placeholder="Heyet büyüklüğü, amaç, öne çıkan gündem maddeleri…"
            onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))}
          />
        </div>
      </Modal>

      {/* --- Program maddesi --- */}
      <Modal
        open={agendaOpen}
        title="Program Maddesi Ekle"
        onClose={() => setAgendaOpen(false)}
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setAgendaOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void addAgenda()}
              disabled={agendaForm.title.trim().length < 2}
            >
              Ekle
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field-label" htmlFor="ag-title">Başlık<span className="req">*</span></label>
          <input
            id="ag-title" className="input" value={agendaForm.title}
            placeholder="Fabrika gezisi"
            onChange={(event) => setAgendaForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="ag-day">Gün</label>
            <input
              id="ag-day" className="input" type="date" value={agendaForm.day}
              onChange={(event) => setAgendaForm((prev) => ({ ...prev, day: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ag-start">Başlangıç</label>
            <input
              id="ag-start" className="input" type="time" value={agendaForm.startTime}
              onChange={(event) => setAgendaForm((prev) => ({ ...prev, startTime: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ag-end">Bitiş</label>
            <input
              id="ag-end" className="input" type="time" value={agendaForm.endTime}
              onChange={(event) => setAgendaForm((prev) => ({ ...prev, endTime: event.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="ag-type">Etkinlik Türü</label>
            <select
              id="ag-type" className="select" value={agendaForm.activityType}
              onChange={(event) =>
                setAgendaForm((prev) => ({ ...prev, activityType: event.target.value }))}
            >
              {ACTIVITY_TYPES.map((type) => (
                <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ag-loc">Yer</label>
            <input
              id="ag-loc" className="input" value={agendaForm.location}
              onChange={(event) => setAgendaForm((prev) => ({ ...prev, location: event.target.value }))}
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="ag-resp">Sorumlu</label>
          <input
            id="ag-resp" className="input" value={agendaForm.responsible}
            onChange={(event) => setAgendaForm((prev) => ({ ...prev, responsible: event.target.value }))}
          />
        </div>
      </Modal>

      {/* --- Katılımcı --- */}
      <Modal
        open={participantOpen}
        title="Katılımcı Ekle"
        onClose={() => setParticipantOpen(false)}
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setParticipantOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void addParticipant()}
              disabled={participantForm.fullName.trim().length < 2}
            >
              Ekle
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field-label" htmlFor="pa-side">Taraf</label>
          <select
            id="pa-side" className="select" value={participantForm.side}
            onChange={(event) =>
              setParticipantForm((prev) => ({
                ...prev, side: event.target.value as 'MISAFIR' | 'EV_SAHIBI',
              }))}
          >
            <option value="MISAFIR">Misafir Heyet</option>
            <option value="EV_SAHIBI">Eşlik Eden MKE Personeli</option>
          </select>
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="pa-name">Ad Soyad<span className="req">*</span></label>
            <input
              id="pa-name" className="input" value={participantForm.fullName}
              onChange={(event) =>
                setParticipantForm((prev) => ({ ...prev, fullName: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pa-rank">Rütbe / Unvan</label>
            <input
              id="pa-rank" className="input" value={participantForm.rank}
              placeholder="Tuğgeneral"
              onChange={(event) =>
                setParticipantForm((prev) => ({ ...prev, rank: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pa-org">Kurum</label>
            <input
              id="pa-org" className="input" value={participantForm.organization}
              onChange={(event) =>
                setParticipantForm((prev) => ({ ...prev, organization: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pa-nat">Uyruk</label>
            <input
              id="pa-nat" className="input" value={participantForm.nationality}
              onChange={(event) =>
                setParticipantForm((prev) => ({ ...prev, nationality: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pa-pass">Pasaport No</label>
            <input
              id="pa-pass" className="input mono" value={participantForm.passportNo}
              onChange={(event) =>
                setParticipantForm((prev) => ({ ...prev, passportNo: event.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pa-phone">Telefon</label>
            <input
              id="pa-phone" className="input" value={participantForm.phone}
              onChange={(event) =>
                setParticipantForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
          </div>
        </div>
      </Modal>

      {/* --- Kontrol maddesi --- */}
      <Modal
        open={checklistOpen}
        title="Kontrol Maddesi Ekle"
        onClose={() => setChecklistOpen(false)}
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setChecklistOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void addChecklistItem()}
              disabled={checklistForm.title.trim().length < 2}
            >
              Ekle
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field-label" htmlFor="cl-title">Madde<span className="req">*</span></label>
          <input
            id="cl-title" className="input" value={checklistForm.title}
            placeholder="Hediyelikler hazırlandı"
            onChange={(event) => setChecklistForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="cl-cat">Kategori</label>
          <select
            id="cl-cat" className="select" value={checklistForm.category}
            onChange={(event) => setChecklistForm((prev) => ({ ...prev, category: event.target.value }))}
          >
            {CHECKLIST_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
      </Modal>
    </>
  );
}

/** Katılımcı satırı — gelmeyenler üstü çizili gösterilir. */
function ParticipantRow({
  participant, canWrite, onToggle, onDelete,
}: {
  participant: VisitParticipant;
  canWrite: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`participant-row${participant.isAttending ? '' : ' absent'}`}>
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div className="participant-name">{participant.fullName}</div>
        <div className="participant-meta">
          {[participant.rank, participant.title, participant.organization, participant.nationality]
            .filter(Boolean).join(' · ') || '—'}
        </div>
        {!participant.isAttending && participant.absenceReason && (
          <div className="text-xs text-danger">Katılmadı: {participant.absenceReason}</div>
        )}
      </div>

      {canWrite && (
        <>
          <button
            type="button" className="btn btn-sm"
            onClick={onToggle}
            title={participant.isAttending ? 'Gelmedi olarak işaretle' : 'Katılıyor olarak işaretle'}
          >
            {participant.isAttending ? 'Gelmedi' : 'Katılıyor'}
          </button>
          <button
            type="button" className="btn btn-ghost btn-icon"
            style={{ color: 'var(--danger)' }}
            aria-label="Katılımcıyı sil"
            onClick={onDelete}
          >
            <IconTrash size={14} />
          </button>
        </>
      )}
    </div>
  );
}
