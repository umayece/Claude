import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { IconAlert, IconEdit, IconPlus, IconSearch, IconTrash, IconWrench } from '../components/Icons';
import { useDeleteConfirm } from '../components/ConfirmDialog';
import type { Company, Contact, Paginated, Ticket } from '../types';

const STATUSES = ['Açık', 'İnceleniyor', 'Parça Bekleniyor', 'Çözüldü', 'İptal'] as const;
const PRIORITIES = ['Düşük', 'Orta', 'Yüksek', 'Kritik'] as const;
const CATEGORIES = [
  'Garanti', 'Periyodik Bakım', 'Arıza Bildirimi', 'Yedek Parça', 'Kalite Kusuru',
] as const;

interface FormState {
  title: string;
  description: string;
  companyId: string | null;
  contactId: string | null;
  priority: string;
  status: string;
  category: string;
  resolutionNote: string;
}

const EMPTY: FormState = {
  title: '', description: '', companyId: null, contactId: null,
  priority: 'Orta', status: 'Açık', category: 'Arıza Bildirimi', resolutionNote: '',
};

function priorityClass(priority: string): string {
  switch (priority) {
    case 'Kritik': return 'badge badge-danger';
    case 'Yüksek': return 'badge badge-warning';
    case 'Düşük': return 'badge';
    default: return 'badge badge-info';
  }
}

export function Tickets() {
  const confirmDelete = useDeleteConfirm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { can } = useAuth();

  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [slaOnly, setSlaOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:tickets:pageSize', 25);

  const [result, setResult] = useState<Paginated<Ticket> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyTerm, setCompanyTerm] = useState('');
  const debouncedCompanyTerm = useDebounce(companyTerm, 300);
  const debouncedTerm = useDebounce(term, 350);

  const companyIdParam = searchParams.get('companyId');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Ticket>>(
        '/tickets',
        {
          page, pageSize,
          q: debouncedTerm || undefined,
          status: statusFilter || undefined,
          priority: priorityFilter || undefined,
          companyId: companyIdParam ?? undefined,
          slaBreached: slaOnly || undefined,
        },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Destek kayıtları yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedTerm, statusFilter, priorityFilter, companyIdParam, slaOnly]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm, statusFilter, priorityFilter, slaOnly, pageSize]);

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

  useEffect(() => {
    if (!form.companyId) { setContacts([]); return; }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.get<Paginated<Contact>>(
          '/contacts', { companyId: form.companyId, pageSize: 100 }, controller.signal,
        );
        setContacts(response.data);
      } catch {
        setContacts([]);
      }
    })();
    return () => controller.abort();
  }, [form.companyId]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        openEdit(await api.get<Ticket>(`/tickets/${id}`));
      } catch {
        navigate('/tickets', { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Şirket detayından "Yeni Talep" ile gelindiğinde formu hazırla.
  useEffect(() => {
    if (!companyIdParam || id) return;
    setForm({ ...EMPTY, companyId: companyIdParam });
    setEditing(null);
    setFormOpen(true);
  }, [companyIdParam, id]);

  const companyOptions: SelectOption[] = useMemo(
    () => companies.map((company) => ({ value: company.id, label: company.name })),
    [companies],
  );

  const contactOptions: SelectOption[] = useMemo(
    () => contacts.map((contact) => ({
      value: contact.id,
      label: `${contact.firstName} ${contact.lastName}`,
      description: contact.title ?? undefined,
    })),
    [contacts],
  );

  function openCreate(): void {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(ticket: Ticket): void {
    setEditing(ticket);
    setForm({
      title: ticket.title,
      description: ticket.description,
      companyId: ticket.companyId,
      contactId: ticket.contactId,
      priority: ticket.priority,
      status: ticket.status,
      category: ticket.category,
      resolutionNote: ticket.resolutionNote ?? '',
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
        description: form.description.trim(),
        companyId: form.companyId,
        contactId: form.contactId,
        priority: form.priority,
        status: form.status,
        category: form.category,
        resolutionNote: form.resolutionNote || null,
      };

      if (editing) await api.put(`/tickets/${editing.id}`, payload);
      else await api.post('/tickets', payload);

      setFormOpen(false);
      if (id) navigate('/tickets', { replace: true });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Destek kaydı kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (ticket: Ticket): Promise<void> => {
    if (!(await confirmDelete(`${ticket.ticketNumber} — ${ticket.title}`))) return;
    try {
      await api.delete(`/tickets/${ticket.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Destek, Garanti & Servis</h1>
          <p>Arıza bildirimi, periyodik bakım ve yedek parça talepleri; SLA takibiyle.</p>
        </div>

        {can('ticket:write') && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <IconPlus size={15} /> Yeni Talep
            </button>
          </div>
        )}
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
              placeholder="Talep başlığı veya numarası ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Destek kaydı ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Durum filtresi"
          >
            <option value="">Tüm durumlar</option>
            {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>

          <select
            className="select" style={{ width: 'auto' }}
            value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}
            aria-label="Öncelik filtresi"
          >
            <option value="">Tüm öncelikler</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>{priority}</option>
            ))}
          </select>

          <label className="checkbox-row">
            <input
              type="checkbox" checked={slaOnly}
              onChange={(event) => setSlaOnly(event.target.checked)}
            />
            <span>SLA aşımı</span>
          </label>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconWrench size={42} />
            <h3>Destek kaydı yok</h3>
            <p>Garanti, bakım ve arıza bildirimlerini buradan takip edin.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Talep No</th><th>Başlık</th><th>Müşteri</th><th>Kategori</th>
                    <th>Öncelik</th><th>Durum</th><th>SLA</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="mono">{ticket.ticketNumber}</td>
                      <td className="font-semibold">{ticket.title}</td>
                      <td className="text-sm">{ticket.company?.name ?? '—'}</td>
                      <td className="text-sm">{ticket.category}</td>
                      <td><span className={priorityClass(ticket.priority)}>{ticket.priority}</span></td>
                      <td>
                        <span className={
                          ticket.status === 'Çözüldü' ? 'badge badge-success' : 'badge badge-info'
                        }>
                          {ticket.status}
                        </span>
                      </td>
                      <td className="nowrap">
                        {ticket.slaBreached ? (
                          <span className="badge badge-danger">
                            <IconAlert size={10} /> aşıldı
                          </span>
                        ) : ticket.hoursUntilSla !== null && ticket.hoursUntilSla !== undefined ? (
                          <span className={ticket.hoursUntilSla < 8 ? 'badge badge-warning' : 'badge'}>
                            {ticket.hoursUntilSla} sa
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="col-actions">
                        <span className="row-actions">
                          {can('ticket:write') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Düzenle" onClick={() => openEdit(ticket)}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}
                          {can('ticket:delete') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Sil" style={{ color: 'var(--danger)' }}
                              onClick={() => void remove(ticket)}
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
        title={editing ? `${editing.ticketNumber} — Düzenle` : 'Yeni Servis Talebi'}
        onClose={() => { setFormOpen(false); if (id) navigate('/tickets', { replace: true }); }}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button
              type="button" className="btn"
              onClick={() => { setFormOpen(false); if (id) navigate('/tickets', { replace: true }); }}
            >
              Vazgeç
            </button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving || form.title.trim().length < 3 || !form.description.trim() || !form.companyId}
            >
              {saving && <span className="spinner" />} Kaydet
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-danger">{formError}</div>}

        <div className="field">
          <label className="field-label" htmlFor="tk-title">Başlık<span className="req">*</span></label>
          <input
            id="tk-title" className="input" value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="tk-company">Müşteri<span className="req">*</span></label>
            <SearchableSelect
              id="tk-company"
              options={companyOptions}
              value={form.companyId}
              onChange={(value) =>
                setForm((prev) => ({ ...prev, companyId: value, contactId: null }))}
              onSearch={setCompanyTerm}
              placeholder="Müşteri seçiniz…"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tk-contact">İlgili Kişi</label>
            <SearchableSelect
              id="tk-contact"
              options={contactOptions}
              value={form.contactId}
              onChange={(value) => setForm((prev) => ({ ...prev, contactId: value }))}
              placeholder={form.companyId ? 'Kişi seçiniz…' : 'Önce müşteri seçin'}
              disabled={!form.companyId}
              emptyText="Bu müşteride kayıtlı kişi yok."
            />
          </div>
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="tk-category">Kategori</label>
            <select
              id="tk-category" className="select" value={form.category}
              onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tk-priority">Öncelik</label>
            <select
              id="tk-priority" className="select" value={form.priority}
              onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>{priority}</option>
              ))}
            </select>
            <div className="field-hint">SLA süresi önceliğe göre otomatik hesaplanır.</div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tk-status">Durum</label>
            <select
              id="tk-status" className="select" value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="tk-desc">Açıklama<span className="req">*</span></label>
          <textarea
            id="tk-desc" className="textarea" rows={5} value={form.description}
            placeholder="Arıza belirtisi, seri numarası, gözlemler…"
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>

        {(form.status === 'Çözüldü' || form.status === 'İptal') && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="tk-resolution">Çözüm Notu</label>
            <textarea
              id="tk-resolution" className="textarea" rows={3} value={form.resolutionNote}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, resolutionNote: event.target.value }))}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
