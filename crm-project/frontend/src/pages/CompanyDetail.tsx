import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useExchangeRates } from '../hooks/useExchangeRates';
import { SplitDrawer, SpecRow, type DrawerTab } from '../components/SplitDrawer';
import { PipelineBar } from '../components/PipelineBar';
import { Timeline } from '../components/Timeline';
import { AiAssistant } from '../components/AiAssistant';
import { EmailComposeModal } from '../components/EmailComposeModal';
import { WhatsAppModal } from '../components/WhatsAppModal';
import { Modal } from '../components/Modal';
import { Avatar } from '../components/Avatar';
import { COMPANY_STAGES, typeBadgeClass } from './Companies';
import { useDeleteConfirm } from '../components/ConfirmDialog';
import {
  IconCalendar, IconCheck, IconEdit, IconGavel, IconMail, IconNote, IconPhone,
  IconSparkles, IconTrash, IconTrending, IconWhatsapp, IconWrench, IconX,
} from '../components/Icons';
import type { Activity, Company, Note, Paginated } from '../types';

type TabKey = 'activity' | 'notes' | 'email' | 'whatsapp' | 'task' | 'ticket' | 'ai';

/** Yapışkan not renkleri — "Notlarım" panosuyla aynı palet. */
const NOTE_COLORS = ['#fef3c7', '#dcfce7', '#dbeafe', '#fce7f3', '#ede9fe', '#f1f5f9'];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/**
 * 360° müşteri çekmecesi.
 *
 * Sol kolon künye + ilişkili kayıtlar, sağ kolon canlı etkileşim.
 * Rota bazlıdır (`/companies/:id`), böylece çekmece derin bağlantıyla
 * açılabilir ve tarayıcı geri tuşu onu kapatır.
 */
export function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { format } = useExchangeRates();

  const [company, setCompany] = useState<Company | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [tab, setTab] = useState<TabKey>('activity');

  // Kuruma ait notlar: listeleme, ekleme, düzenleme, silme tek yerde.
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState({ title: '', body: '', color: NOTE_COLORS[0]! });
  const [noteSaving, setNoteSaving] = useState(false);
  const confirmDelete = useDeleteConfirm();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [emailOpen, setEmailOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const loadCompany = useCallback(async (signal?: AbortSignal) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Company>(`/companies/${id}`, undefined, signal);
      setCompany(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Kurum yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadTimeline = useCallback(async (page = 1) => {
    if (!id) return;
    try {
      const response = await api.get<Paginated<Activity>>(
        `/companies/${id}/timeline`, { page, pageSize: 30 },
      );
      // Sayfa 1 listeyi tazeler, sonraki sayfalar sona eklenir.
      setActivities((prev) => (page === 1 ? response.data : [...prev, ...response.data]));
      setActivityTotal(response.meta.total);
      setActivityPage(page);
    } catch {
      // Zaman tüneli kritik değil; künye yine de gösterilir.
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCompany(controller.signal);
    void loadTimeline(1);
    return () => controller.abort();
  }, [loadCompany, loadTimeline]);

  const changeStage = async (status: string): Promise<void> => {
    if (!id) return;
    const updated = await api.put<Company>(`/companies/${id}/stage`, { status });
    setCompany((prev) => (prev ? { ...prev, status: updated.status } : updated));
    await loadTimeline(1);
  };

  const addNote = async (): Promise<void> => {
    if (!id || !noteText.trim()) return;
    setSavingNote(true);
    try {
      // Not hem kurumun zaman tüneline düşer hem "Notlarım" listesinde
      // kurum etiketiyle görünür; bu yüzden AI kısayolu yerine /notes ucu
      // kullanılır (tek kaynak).
      await api.post('/notes', {
        companyId: id,
        title: 'Not',
        body: noteText.trim(),
      });
      setNoteText('');
      setNoteOpen(false);
      await loadTimeline(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not kaydedilemedi.');
    } finally {
      setSavingNote(false);
    }
  };

  const loadNotes = useCallback(async () => {
    if (!id) return;
    setNotesLoading(true);
    try {
      const response = await api.get<{ data: Note[] }>(`/notes/company/${id}`);
      setNotes(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Notlar alınamadı.');
    } finally {
      setNotesLoading(false);
    }
  }, [id]);

  // Notlar sekmesi ilk açıldığında yüklenir; sürekli çekmeye gerek yok.
  useEffect(() => {
    if (tab === 'notes') void loadNotes();
  }, [tab, loadNotes]);

  const startEditNote = (note: Note): void => {
    setEditingNoteId(note.id);
    setNoteDraft({
      title: note.title ?? '',
      body: note.body,
      color: note.color || NOTE_COLORS[0]!,
    });
  };

  const cancelEditNote = (): void => {
    setEditingNoteId(null);
    setNoteDraft({ title: '', body: '', color: NOTE_COLORS[0]! });
  };

  /** Yeni not oluşturur ya da düzenlenen notu günceller. */
  const saveNote = async (): Promise<void> => {
    if (!id || !noteDraft.body.trim()) return;
    setNoteSaving(true);
    try {
      const payload = {
        companyId: id,
        title: noteDraft.title.trim() || 'Not',
        body: noteDraft.body.trim(),
        color: noteDraft.color,
      };
      if (editingNoteId) await api.put(`/notes/${editingNoteId}`, payload);
      else await api.post('/notes', payload);

      cancelEditNote();
      await loadNotes();
      // Yeni not zaman tüneline de düşer; akış tazelenir.
      if (!editingNoteId) await loadTimeline(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not kaydedilemedi.');
    } finally {
      setNoteSaving(false);
    }
  };

  const removeNote = async (note: Note): Promise<void> => {
    if (!(await confirmDelete(note.title || 'Not', 'Not çöp kutusuna taşınır.'))) return;
    try {
      await api.delete(`/notes/${note.id}`);
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not silinemedi.');
    }
  };

  const primaryContact = useMemo(
    () => company?.contacts?.find((contact) => contact.isPrimary) ?? company?.contacts?.[0] ?? null,
    [company],
  );

  const allPhones = useMemo(
    () => company?.contacts?.flatMap((contact) => contact.phones) ?? [],
    [company],
  );

  const tabs: DrawerTab[] = [
    { key: 'activity', label: 'Aktivite Akışı', icon: <IconTrending size={14} />, badge: activityTotal },
    { key: 'notes', label: 'Notlar', icon: <IconNote size={14} />, badge: notes.length || undefined },
    { key: 'email', label: 'E-Posta Gönder', icon: <IconMail size={14} /> },
    { key: 'whatsapp', label: 'WhatsApp', icon: <IconWhatsapp size={14} /> },
    { key: 'task', label: 'Görev Ekle', icon: <IconCalendar size={14} /> },
    { key: 'ticket', label: 'Servis Talebi', icon: <IconWrench size={14} />, badge: company?.tickets?.length },
    ...(can('ai:use') ? [{ key: 'ai', label: 'AI Özeti', icon: <IconSparkles size={14} /> }] : []),
  ];

  const close = (): void => navigate('/companies');

  if (loading && !company) {
    return (
      <SplitDrawer
        open title="Yükleniyor…" onClose={close}
        left={<div className="loading-center"><span className="spinner spinner-lg" /></div>}
        tabs={[]} activeTab="" onTabChange={() => undefined}
      >
        <div className="loading-center"><span className="spinner" /></div>
      </SplitDrawer>
    );
  }

  if (error || !company) {
    return (
      <SplitDrawer
        open title="Kurum bulunamadı" onClose={close}
        left={<div className="alert alert-danger">{error ?? 'Kayıt yok.'}</div>}
        tabs={[]} activeTab="" onTabChange={() => undefined}
      >
        <button type="button" className="btn" onClick={close}>Listeye dön</button>
      </SplitDrawer>
    );
  }

  return (
    <>
      <SplitDrawer
        open
        title={company.name}
        subtitle={
          <span className="flex items-center gap-2">
            <span className={typeBadgeClass(company.type)}>{company.type}</span>
            {company.sector && <span className="text-muted">{company.sector}</span>}
            <span className="text-muted">
              · {company.country}
              {(company.displayCity ?? company.city?.name ?? company.cityName) &&
                `, ${company.displayCity ?? company.city?.name ?? company.cityName}`}
            </span>
          </span>
        }
        onClose={close}
        stageBar={
          <PipelineBar
            stages={COMPANY_STAGES}
            current={company.status}
            onChange={changeStage}
            disabled={!can('company:write')}
          />
        }
        left={
          <>
            <h3 className="mb-2">Künye</h3>
            <div className="spec-list mb-4">
              <SpecRow label="Durum">
                <span className="badge badge-info">{company.status}</span>
              </SpecRow>
              <SpecRow label="Sektör">{company.sector}</SpecRow>
              <SpecRow label="Web">
                {company.website && (
                  <a href={company.website} target="_blank" rel="noopener noreferrer">
                    {company.website}
                  </a>
                )}
              </SpecRow>
              <SpecRow label="E-Posta">
                {company.email && <a href={`mailto:${company.email}`}>{company.email}</a>}
              </SpecRow>
              <SpecRow label="Telefon">{company.phone}</SpecRow>
              <SpecRow label="Vergi No">{company.taxNumber}</SpecRow>
              <SpecRow label="Ülke">{company.country}</SpecRow>
              <SpecRow label="Şehir / İlçe">
                {[
                  company.displayCity ?? company.city?.name ?? company.cityName,
                  company.districtName,
                ].filter(Boolean).join(' / ') || null}
              </SpecRow>
              <SpecRow label="Adres">{company.address}</SpecRow>
              <SpecRow label="Sorumlu">{company.owner?.name}</SpecRow>
              <SpecRow label="Kayıt">{formatDate(company.createdAt)}</SpecRow>
              <SpecRow label="Toplam Ciro">
                <strong>{format(company.revenueTry ?? 0, 'TRY')}</strong>
              </SpecRow>
              {company.coordinateSource === 'CITY' && (
                <SpecRow label="Harita">
                  <span className="text-xs text-muted">Şehir merkezi (yaklaşık konum)</span>
                </SpecRow>
              )}
            </div>

            {company.customFields && Object.keys(company.customFields).length > 0 && (
              <>
                <h3 className="mb-2">Özel Alanlar</h3>
                <div className="spec-list mb-4">
                  {Object.entries(company.customFields).map(([key, value]) => (
                    <SpecRow key={key} label={key}>{String(value ?? '')}</SpecRow>
                  ))}
                </div>
              </>
            )}

            <h3 className="mb-2">
              İlgili Kişiler {company.contacts && `(${company.contacts.length})`}
            </h3>
            {company.contacts && company.contacts.length > 0 ? (
              <div className="flex-col gap-2 mb-4">
                {company.contacts.map((contact) => (
                  <div key={contact.id} className="flex items-center gap-2">
                    <Avatar
                      name={`${contact.firstName} ${contact.lastName}`}
                      src={contact.avatarUrl}
                      size={30}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-semibold">
                        {contact.firstName} {contact.lastName}
                        {contact.isPrimary && <span className="badge ml-auto">birincil</span>}
                      </div>
                      <div className="text-xs text-muted truncate">
                        {[contact.title, contact.departmentName].filter(Boolean).join(' · ') || '—'}
                      </div>
                      {contact.phones.slice(0, 2).map((phone) => (
                        <div
                          key={phone.id}
                          className={`text-xs ${phone.isInactive ? 'phone-inactive' : 'text-muted'}`}
                        >
                          <IconPhone size={10} /> {phone.number}
                          <span className="phone-tag" style={{ marginLeft: 4 }}>{phone.label}</span>
                          {phone.isInactive && (
                            <span className="phone-tag" style={{ marginLeft: 2 }}>Kullanım Dışı</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted mb-4">Kayıtlı kişi yok.</p>
            )}

            <h3 className="mb-2">Aktif İhaleler ({company.tenders?.length ?? 0})</h3>
            {company.tenders && company.tenders.length > 0 ? (
              <div className="flex-col gap-1 mb-4">
                {company.tenders.slice(0, 6).map((tender) => (
                  <button
                    key={tender.id}
                    type="button"
                    className="btn btn-ghost"
                    style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '6px 8px' }}
                    onClick={() => navigate(`/tenders/${tender.id}`)}
                  >
                    <IconGavel size={13} />
                    <span className="flex-1 truncate">{tender.title}</span>
                    <span className="badge">{tender.status}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted mb-4">İhale kaydı yok.</p>
            )}

            <h3 className="mb-2">Sözleşmeler ({company.contracts?.length ?? 0})</h3>
            {company.contracts && company.contracts.length > 0 ? (
              <div className="flex-col gap-1">
                {company.contracts.slice(0, 6).map((contract) => (
                  <button
                    key={contract.id}
                    type="button"
                    className="btn btn-ghost"
                    style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '6px 8px' }}
                    onClick={() => navigate(`/contracts/${contract.id}`)}
                  >
                    <span className="flex-1 truncate">{contract.title}</span>
                    <span className="text-xs text-muted nowrap">
                      {format(contract.amount, contract.currency)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Sözleşme kaydı yok.</p>
            )}
          </>
        }
        tabs={tabs}
        activeTab={tab}
        onTabChange={(key) => setTab(key as TabKey)}
        headerActions={
          <button
            type="button" className="btn btn-sm"
            onClick={() => setNoteOpen(true)}
          >
            <IconNote size={14} /> Not Ekle
          </button>
        }
      >
        {tab === 'activity' && (
          <>
            <Timeline activities={activities} />
            {activities.length < activityTotal && (
              <button
                type="button" className="btn w-full mt-3"
                onClick={() => void loadTimeline(activityPage + 1)}
              >
                Daha fazla göster ({activityTotal - activities.length} kayıt)
              </button>
            )}
          </>
        )}

        {tab === 'notes' && (
          <>
            {/*
              Kuruma ait notlar.

              Buradan eklenen not hem bu listede, hem kurumun zaman
              tünelinde, hem de "Notlarım" ekranında kurum etiketiyle
              görünür — tek kaynak, üç görünüm.
            */}
            <div className="card mb-3" style={{ background: noteDraft.color }}>
              <div className="card-body">
                <div className="field" style={{ marginBottom: 8 }}>
                  <label className="field-label" htmlFor="cn-title">Başlık</label>
                  <input
                    id="cn-title" className="input" value={noteDraft.title}
                    placeholder="Görüşme notu"
                    onChange={(event) => setNoteDraft((prev) => ({
                      ...prev, title: event.target.value,
                    }))}
                  />
                </div>

                <div className="field" style={{ marginBottom: 8 }}>
                  <label className="field-label" htmlFor="cn-body">Not</label>
                  <textarea
                    id="cn-body" className="textarea" rows={3} value={noteDraft.body}
                    placeholder="Bu kurumla ilgili notunuzu yazın…"
                    onChange={(event) => setNoteDraft((prev) => ({
                      ...prev, body: event.target.value,
                    }))}
                  />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted">Renk:</span>
                  {NOTE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="note-swatch"
                      style={{
                        background: color,
                        outline: noteDraft.color === color
                          ? '2px solid var(--mke-navy)' : 'none',
                      }}
                      aria-label={`Renk ${color}`}
                      onClick={() => setNoteDraft((prev) => ({ ...prev, color }))}
                    />
                  ))}

                  <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
                    {editingNoteId && (
                      <button type="button" className="btn btn-sm" onClick={cancelEditNote}>
                        <IconX size={13} /> Vazgeç
                      </button>
                    )}
                    <button
                      type="button" className="btn btn-sm btn-primary"
                      onClick={() => void saveNote()}
                      disabled={noteSaving || !noteDraft.body.trim()}
                    >
                      {noteSaving ? <span className="spinner" /> : <IconCheck size={13} />}
                      {' '}{editingNoteId ? 'Güncelle' : 'Not Ekle'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {notesLoading && notes.length === 0 && (
              <div className="loading-center"><span className="spinner" /></div>
            )}

            {!notesLoading && notes.length === 0 && (
              <div className="empty-state" style={{ padding: 28 }}>
                <IconNote size={34} />
                <p>Bu kuruma ait not yok. Yukarıdaki alandan ilk notu ekleyebilirsiniz.</p>
              </div>
            )}

            <div className="note-list">
              {notes.map((note) => (
                <article
                  key={note.id}
                  className="note-card"
                  style={{ background: note.color || NOTE_COLORS[0] }}
                >
                  <div className="note-card-head">
                    <strong>{note.title || 'Not'}</strong>
                    <span className="row-actions">
                      <button
                        type="button" className="btn btn-ghost btn-icon"
                        style={{ width: 26, height: 26 }}
                        aria-label="Notu düzenle"
                        onClick={() => startEditNote(note)}
                      >
                        <IconEdit size={14} />
                      </button>
                      <button
                        type="button" className="btn btn-ghost btn-icon"
                        style={{ width: 26, height: 26, color: 'var(--danger)' }}
                        aria-label="Notu sil"
                        onClick={() => void removeNote(note)}
                      >
                        <IconTrash size={14} />
                      </button>
                    </span>
                  </div>
                  <p className="note-card-body">{note.body}</p>
                  <div className="note-card-meta">
                    {new Date(note.updatedAt ?? note.createdAt).toLocaleString('tr-TR', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {tab === 'email' && (
          <div className="empty-state" style={{ padding: 28 }}>
            <IconMail size={34} />
            <h3>E-Posta Gönder</h3>
            <p>
              Şablon seçip mesajı düzenleyin. Gönderim yerel simülatöre kaydedilir
              ve bu müşterinin aktivite akışına anında düşer.
            </p>
            <button
              type="button" className="btn btn-primary"
              onClick={() => setEmailOpen(true)}
              disabled={!can('email:send')}
            >
              <IconMail size={15} /> Yeni E-Posta
            </button>
          </div>
        )}

        {tab === 'whatsapp' && (
          <div className="empty-state" style={{ padding: 28 }}>
            <IconWhatsapp size={34} />
            <h3>WhatsApp Mesajı</h3>
            <p>
              Kişinin aktif numarasına hazır metinle WhatsApp açılır.
              Mesaj CRM üzerinden gönderilmez.
            </p>
            <button
              type="button" className="btn btn-primary"
              onClick={() => setWhatsappOpen(true)}
              disabled={allPhones.length === 0}
            >
              <IconWhatsapp size={15} /> WhatsApp'ta Aç
            </button>
            {allPhones.length === 0 && (
              <p className="text-sm text-muted mt-2">Bu kurumda kayıtlı telefon yok.</p>
            )}
          </div>
        )}

        {tab === 'task' && (
          <div className="empty-state" style={{ padding: 28 }}>
            <IconCalendar size={34} />
            <h3>Görev Ekle</h3>
            <p>Bu kuruma bağlı görevler takvim sayfasından oluşturulur ve yönetilir.</p>
            <button
              type="button" className="btn btn-primary"
              onClick={() => navigate(`/tasks?companyId=${company.id}`)}
            >
              Takvime Git
            </button>
          </div>
        )}

        {tab === 'ticket' && (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3>Destek / Servis Talepleri</h3>
              <button
                type="button" className="btn btn-sm btn-primary"
                onClick={() => navigate(`/tickets?companyId=${company.id}`)}
              >
                Yeni Talep
              </button>
            </div>

            {company.tickets && company.tickets.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>No</th><th>Başlık</th><th>Kategori</th><th>Durum</th><th>Öncelik</th></tr>
                  </thead>
                  <tbody>
                    {company.tickets.map((ticket) => (
                      <tr
                        key={ticket.id} className="clickable"
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                      >
                        <td className="mono">{ticket.ticketNumber}</td>
                        <td>{ticket.title}</td>
                        <td className="text-sm">{ticket.category}</td>
                        <td><span className="badge">{ticket.status}</span></td>
                        <td>
                          <span className={`badge ${
                            ticket.priority === 'Kritik' ? 'badge-danger'
                              : ticket.priority === 'Yüksek' ? 'badge-warning' : ''
                          }`}>
                            {ticket.priority}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">Bu kuruma ait destek kaydı yok.</p>
            )}
          </>
        )}

        {tab === 'ai' && (
          <AiAssistant
            task="COMPANY_SUMMARY"
            entityId={company.id}
            saveContext={{ companyId: company.id }}
          />
        )}
      </SplitDrawer>

      <EmailComposeModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        onSent={() => void loadTimeline(1)}
        defaultTo={primaryContact?.email ?? company.email ?? ''}
        companyId={company.id}
        contactId={primaryContact?.id ?? null}
        companyName={company.name}
        contactName={primaryContact ? `${primaryContact.firstName} ${primaryContact.lastName}` : undefined}
      />

      <WhatsAppModal
        open={whatsappOpen}
        onClose={() => setWhatsappOpen(false)}
        phones={allPhones}
        companyName={company.name}
        contactName={primaryContact ? `${primaryContact.firstName} ${primaryContact.lastName}` : undefined}
      />

      <Modal
        open={noteOpen}
        title="Zaman Tüneline Not Ekle"
        onClose={() => setNoteOpen(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setNoteOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void addNote()}
              disabled={savingNote || !noteText.trim()}
            >
              {savingNote && <span className="spinner" />} Kaydet
            </button>
          </>
        }
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="note-text">Not</label>
          <textarea
            id="note-text" className="textarea" rows={6} value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="Görüşme özeti, karar, hatırlatma…"
          />
        </div>
      </Modal>
    </>
  );
}
