import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDebounce } from '../hooks/useDebounce';
import { Modal } from '../components/Modal';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import {
  IconCalendar, IconCheck, IconChevronLeft, IconChevronRight, IconClock,
  IconEdit, IconGavel, IconGift, IconMail, IconPlus, IconCredit, IconTrash,
} from '../components/Icons';
import type {
  CalendarEvent, CalendarEventType, Company, Contact, Paginated, Task,
} from '../types';

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

const TASK_TYPES = ['Görev', 'Arama', 'Toplantı', 'E-Posta', 'Ziyaret', 'Teslimat'];
const TASK_PRIORITIES = ['Düşük', 'Orta', 'Yüksek', 'Kritik'];
const TASK_STATUSES = ['Açık', 'Devam Ediyor', 'Tamamlandı', 'İptal'];

interface CalendarFilters {
  tasks: boolean;
  tenders: boolean;
  contracts: boolean;
  birthdays: boolean;
  milestones: boolean;
}

const DEFAULT_FILTERS: CalendarFilters = {
  tasks: true, tenders: true, contracts: true, birthdays: false, milestones: false,
};

function isoDate(date: Date): string {
  // Yerel tarihten ISO gün dizesi. `toISOString()` UTC'ye kaydırıp
  // GMT+3'te günü bir geri alabilir; bu yüzden elle biçimlendiriyoruz.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Pazartesi başlangıçlı 6x7 ızgara. */
function buildGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // getDay(): 0=Pazar. Pazartesi'yi 0 kabul edecek şekilde kaydır.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function chipClass(event: CalendarEvent): string {
  if (event.isOverdue) return 'calendar-chip chip-overdue';
  switch (event.type) {
    case 'TASK': return 'calendar-chip chip-task';
    case 'TENDER_DEADLINE': return 'calendar-chip chip-tender';
    case 'CONTRACT_RENEWAL': return 'calendar-chip chip-contract';
    case 'BIRTHDAY': return 'calendar-chip chip-birthday';
    case 'MILESTONE': return 'calendar-chip chip-milestone';
    default: return 'calendar-chip';
  }
}

function eventIcon(type: CalendarEventType) {
  switch (type) {
    case 'TENDER_DEADLINE': return <IconGavel size={16} />;
    case 'CONTRACT_RENEWAL': return <IconCalendar size={16} />;
    case 'BIRTHDAY': return <IconGift size={16} />;
    case 'MILESTONE': return <IconCredit size={16} />;
    default: return <IconClock size={16} />;
  }
}

function eventIconBg(type: CalendarEventType): string {
  switch (type) {
    case 'TENDER_DEADLINE': return 'var(--warning-bg)';
    case 'CONTRACT_RENEWAL': return 'var(--purple-bg)';
    case 'BIRTHDAY': return '#fce7f3';
    case 'MILESTONE': return 'var(--success-bg)';
    default: return 'var(--info-bg)';
  }
}

interface TaskForm {
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  dueDate: string;
  isAllDay: boolean;
  startTime: string;
  endTime: string;
  companyId: string | null;
  contactId: string | null;
}

const EMPTY_TASK: TaskForm = {
  title: '', description: '', type: 'Görev', priority: 'Orta', status: 'Açık',
  dueDate: isoDate(new Date()), isAllDay: true, startTime: '09:00', endTime: '10:00',
  companyId: null, contactId: null,
};

export function TasksCalendar() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [searchParams] = useSearchParams();

  const [cursor, setCursor] = useState(() => new Date());
  // Filtre seçimi localStorage'da saklanır: sayfa yenilense de bozulmaz.
  const [filters, setFilters] = useLocalStorage<CalendarFilters>(
    'crm:calendar:filters', DEFAULT_FILTERS,
  );

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm>(EMPTY_TASK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form içindeki aranabilir seçiciler için uzaktan arama.
  const [companyTerm, setCompanyTerm] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const debouncedCompanyTerm = useDebounce(companyTerm, 300);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const grid = useMemo(() => buildGrid(year, month), [year, month]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const first = grid[0];
      const last = grid[grid.length - 1];
      if (!first || !last) return;

      const response = await api.get<{ data: CalendarEvent[] }>(
        '/calendar',
        {
          from: isoDate(first),
          to: isoDate(last),
          includeTasks: filters.tasks,
          includeTenders: filters.tenders,
          includeContracts: filters.contracts,
          includeBirthdays: filters.birthdays,
          includeMilestones: filters.milestones,
        },
        signal,
      );
      setEvents(response.data);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Takvim yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [grid, filters]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Şirket arama (uzaktan) — seçici açıkken çalışır.
  useEffect(() => {
    if (!formOpen) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.get<Paginated<Company>>(
          '/companies',
          { q: debouncedCompanyTerm || undefined, pageSize: 30 },
          controller.signal,
        );
        setCompanies(response.data);
      } catch {
        // Arama başarısız olsa da form kullanılabilir kalır.
      }
    })();
    return () => controller.abort();
  }, [formOpen, debouncedCompanyTerm]);

  // Şirket seçilince o şirketin kişileri yüklenir.
  useEffect(() => {
    if (!form.companyId) {
      setContacts([]);
      return;
    }
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

  // Şirket detayından "/tasks?companyId=..." ile gelindiğinde formu hazırla.
  useEffect(() => {
    const companyId = searchParams.get('companyId');
    if (!companyId) return;
    setForm({ ...EMPTY_TASK, companyId });
    setEditingTaskId(null);
    setFormOpen(true);
  }, [searchParams]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    return map;
  }, [events]);

  const companyOptions: SelectOption[] = useMemo(
    () => companies.map((company) => ({
      value: company.id,
      label: company.name,
      description: [company.type, company.city?.name].filter(Boolean).join(' · '),
    })),
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

  const openCreate = (date?: string): void => {
    setEditingTaskId(null);
    setForm({ ...EMPTY_TASK, dueDate: date ?? isoDate(new Date()) });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = async (taskId: string): Promise<void> => {
    try {
      const task = await api.get<Task>(`/tasks/${taskId}`);
      setEditingTaskId(task.id);
      setForm({
        title: task.title,
        description: task.description ?? '',
        type: task.type,
        priority: task.priority,
        status: task.status,
        dueDate: task.dueDate ? task.dueDate.slice(0, 10) : isoDate(new Date()),
        isAllDay: task.isAllDay,
        startTime: task.startTime ?? '09:00',
        endTime: task.endTime ?? '10:00',
        companyId: task.companyId,
        contactId: task.contactId,
      });
      setFormError(null);
      setSelectedDay(null);
      setFormOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Görev yüklenemedi.');
    }
  };

  const saveTask = async (): Promise<void> => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description || null,
        type: form.type,
        priority: form.priority,
        status: form.status,
        dueDate: form.dueDate || null,
        isAllDay: form.isAllDay,
        startTime: form.isAllDay ? null : form.startTime,
        endTime: form.isAllDay ? null : form.endTime,
        companyId: form.companyId,
        contactId: form.contactId,
      };

      if (editingTaskId) await api.put(`/tasks/${editingTaskId}`, payload);
      else await api.post('/tasks', payload);

      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Görev kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const completeTask = async (taskId: string): Promise<void> => {
    try {
      await api.post(`/tasks/${taskId}/complete`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Görev tamamlanamadı.');
    }
  };

  const deleteTask = async (taskId: string): Promise<void> => {
    if (!window.confirm('Görev silinsin mi?')) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      setSelectedDay(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Görev silinemedi.');
    }
  };

  const todayIso = isoDate(new Date());
  const dayEvents = selectedDay ? eventsByDay.get(selectedDay) ?? [] : [];

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Görevler & Takvim</h1>
          <p>Görevler, ihale teslimleri, sözleşme yenilemeleri ve doğum günleri tek ekranda.</p>
        </div>

        {can('task:write') && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={() => openCreate()}>
              <IconPlus size={15} /> Yeni Görev
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="calendar">
        <div className="calendar-toolbar">
          <button
            type="button" className="btn btn-icon"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            aria-label="Önceki ay"
          >
            <IconChevronLeft size={16} />
          </button>

          <span className="calendar-month">{MONTHS[month]} {year}</span>

          <button
            type="button" className="btn btn-icon"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            aria-label="Sonraki ay"
          >
            <IconChevronRight size={16} />
          </button>

          <button type="button" className="btn btn-sm" onClick={() => setCursor(new Date())}>
            Bugün
          </button>

          {loading && <span className="spinner" />}

          <div className="calendar-filters">
            {([
              ['tasks', 'Görevler'],
              ['tenders', 'İhale Teslimleri'],
              ['contracts', 'Sözleşmeler'],
              ['birthdays', 'Doğum Günleri'],
              ['milestones', 'Hakedişler'],
            ] as [keyof CalendarFilters, string][]).map(([key, label]) => (
              <label className="checkbox-row" key={key}>
                <input
                  type="checkbox"
                  checked={filters[key]}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, [key]: event.target.checked }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="calendar-weekdays">
          {WEEKDAYS.map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
        </div>

        <div className="calendar-grid">
          {grid.map((date) => {
            const iso = isoDate(date);
            const dayList = eventsByDay.get(iso) ?? [];
            const isOtherMonth = date.getMonth() !== month;

            return (
              <div
                key={iso}
                className={
                  'calendar-day' +
                  (isOtherMonth ? ' other-month' : '') +
                  (iso === todayIso ? ' today' : '')
                }
                role="button"
                tabIndex={0}
                onClick={() => setSelectedDay(iso)}
                onKeyDown={(event) => { if (event.key === 'Enter') setSelectedDay(iso); }}
              >
                <span className="calendar-daynum">{date.getDate()}</span>

                {dayList.slice(0, 3).map((event) => (
                  <div key={event.id} className={chipClass(event)} title={event.title}>
                    {!event.isAllDay && event.startTime && `${event.startTime} `}
                    {event.title}
                  </div>
                ))}

                {dayList.length > 3 && (
                  <span className="calendar-more">+{dayList.length - 3} daha</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Günün etkinlikleri */}
      <Modal
        open={selectedDay !== null}
        title={
          selectedDay
            ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString('tr-TR', {
                day: 'numeric', month: 'long', year: 'numeric', weekday: 'long',
              })
            : ''
        }
        onClose={() => setSelectedDay(null)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setSelectedDay(null)}>Kapat</button>
            {can('task:write') && selectedDay && (
              <button
                type="button" className="btn btn-primary"
                onClick={() => { const day = selectedDay; setSelectedDay(null); openCreate(day); }}
              >
                <IconPlus size={15} /> Bu Güne Görev Ekle
              </button>
            )}
          </>
        }
      >
        {dayEvents.length === 0 ? (
          <div className="empty-state" style={{ padding: 28 }}>
            <IconCalendar size={34} />
            <p>Bu günde kayıtlı etkinlik yok.</p>
          </div>
        ) : (
          dayEvents.map((event) => (
            <div className="event-card" key={event.id}>
              <div
                className="event-card-icon"
                style={{ background: eventIconBg(event.type) }}
              >
                {eventIcon(event.type)}
              </div>

              <div className="event-card-main">
                <div className="event-card-title">{event.title}</div>

                <div className="event-card-meta">
                  <span>
                    <IconClock size={11} />{' '}
                    {event.isAllDay
                      ? 'Tüm Gün'
                      : `${event.startTime ?? '--:--'} - ${event.endTime ?? '--:--'}`}
                  </span>

                  {event.companyName && (
                    <span
                      role="button" tabIndex={0}
                      style={{ color: 'var(--info)', cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedDay(null);
                        if (event.companyId) navigate(`/companies/${event.companyId}`);
                      }}
                      onKeyDown={(keyEvent) => {
                        if (keyEvent.key === 'Enter' && event.companyId) {
                          setSelectedDay(null);
                          navigate(`/companies/${event.companyId}`);
                        }
                      }}
                    >
                      {event.companyName}
                    </span>
                  )}

                  {event.contactName && <span>{event.contactName}</span>}
                  {event.priority && <span className="badge">{event.priority}</span>}
                  {event.status && <span className="badge badge-info">{event.status}</span>}
                  {event.isOverdue && <span className="badge badge-danger">Gecikti</span>}
                </div>

                {event.description && (
                  <div className="event-card-desc">{event.description}</div>
                )}
              </div>

              <div className="event-card-actions">
                {event.type === 'TASK' && can('task:write') && (
                  <>
                    <button
                      type="button" className="btn btn-sm"
                      onClick={() => void openEdit(event.sourceId)}
                      title="Düzenle"
                    >
                      <IconEdit size={13} /> Düzenle
                    </button>

                    {event.status !== 'Tamamlandı' && (
                      <button
                        type="button" className="btn btn-sm"
                        style={{ color: 'var(--success)' }}
                        onClick={() => void completeTask(event.sourceId)}
                        title="Tamamlandı olarak işaretle"
                      >
                        <IconCheck size={13} /> Tamamla
                      </button>
                    )}

                    {can('task:delete') && (
                      <button
                        type="button" className="btn btn-sm"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => void deleteTask(event.sourceId)}
                        title="Sil"
                      >
                        <IconTrash size={13} /> Sil
                      </button>
                    )}
                  </>
                )}

                {event.type === 'TENDER_DEADLINE' && (
                  <button
                    type="button" className="btn btn-sm"
                    onClick={() => { setSelectedDay(null); navigate(`/tenders/${event.sourceId}`); }}
                  >
                    İhaleye Git
                  </button>
                )}

                {event.type === 'CONTRACT_RENEWAL' && (
                  <button
                    type="button" className="btn btn-sm"
                    onClick={() => { setSelectedDay(null); navigate(`/contracts/${event.sourceId}`); }}
                  >
                    Sözleşmeye Git
                  </button>
                )}

                {event.type === 'BIRTHDAY' && event.companyId && (
                  <button
                    type="button" className="btn btn-sm"
                    onClick={() => { setSelectedDay(null); navigate(`/companies/${event.companyId}`); }}
                  >
                    <IconMail size={13} /> Kutla
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </Modal>

      {/* Görev formu */}
      <Modal
        open={formOpen}
        title={editingTaskId ? 'Görevi Düzenle' : 'Yeni Görev'}
        onClose={() => setFormOpen(false)}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setFormOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void saveTask()}
              disabled={saving || form.title.trim().length < 2}
            >
              {saving && <span className="spinner" />} Kaydet
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-danger">{formError}</div>}

        <div className="field">
          <label className="field-label" htmlFor="t-title">Başlık<span className="req">*</span></label>
          <input
            id="t-title" className="input" value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="t-type">Tür</label>
            <select
              id="t-type" className="select" value={form.type}
              onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
            >
              {TASK_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="t-priority">Öncelik</label>
            <select
              id="t-priority" className="select" value={form.priority}
              onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
            >
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="t-status">Durum</label>
            <select
              id="t-status" className="select" value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="t-date">Tarih</label>
          <input
            id="t-date" className="input" type="date" value={form.dueDate}
            onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))}
          />
        </div>

        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox" checked={form.isAllDay}
              onChange={(event) => setForm((prev) => ({ ...prev, isAllDay: event.target.checked }))}
            />
            <span>Tüm gün</span>
          </label>
        </div>

        {!form.isAllDay && (
          <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
            <div className="field">
              <label className="field-label" htmlFor="t-start">Başlangıç Saati</label>
              <input
                id="t-start" className="input" type="time" value={form.startTime}
                onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="t-end">Bitiş Saati</label>
              <input
                id="t-end" className="input" type="time" value={form.endTime}
                onChange={(event) => setForm((prev) => ({ ...prev, endTime: event.target.value }))}
              />
              {form.endTime <= form.startTime && (
                <div className="field-error">Bitiş saati başlangıçtan sonra olmalıdır.</div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="t-company">Müşteri</label>
            <SearchableSelect
              id="t-company"
              options={companyOptions}
              value={form.companyId}
              onChange={(value) =>
                // Şirket değişince kişi seçimi sıfırlanır: başka şirketin
                // kişisi seçili kalmamalı.
                setForm((prev) => ({ ...prev, companyId: value, contactId: null }))}
              onSearch={setCompanyTerm}
              placeholder="Müşteri seçiniz…"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="t-contact">Kişi</label>
            <SearchableSelect
              id="t-contact"
              options={contactOptions}
              value={form.contactId}
              onChange={(value) => setForm((prev) => ({ ...prev, contactId: value }))}
              placeholder={form.companyId ? 'Kişi seçiniz…' : 'Önce müşteri seçin'}
              disabled={!form.companyId}
              emptyText="Bu müşteride kayıtlı kişi yok."
            />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="t-desc">Açıklama</label>
          <textarea
            id="t-desc" className="textarea" rows={4} value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
      </Modal>
    </>
  );
}
