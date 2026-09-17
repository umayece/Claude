import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Avatar } from '../components/Avatar';
import { Pagination } from '../components/Pagination';
import { ContactDetailModal } from '../components/ContactDetailModal';
import { IconEdit, IconGift, IconPlus, IconSearch, IconTrash, IconUsers } from '../components/Icons';
import { useDeleteConfirm } from '../components/ConfirmDialog';
import type { Contact, Paginated } from '../types';

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function birthdayText(contact: Contact): string | null {
  if (contact.birthMonth && contact.birthDay) {
    const base = `${contact.birthDay} ${MONTHS[contact.birthMonth - 1]}`;
    return contact.birthYear ? `${base} ${contact.birthYear}` : base;
  }
  return contact.birthYear ? String(contact.birthYear) : null;
}

export function Contacts() {
  const confirmDelete = useDeleteConfirm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { can } = useAuth();

  const [term, setTerm] = useState('');
  const [birthMonthFilter, setBirthMonthFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:contacts:pageSize', 25);

  const [result, setResult] = useState<Paginated<Contact> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const debouncedTerm = useDebounce(term, 350);
  const companyIdFilter = searchParams.get('companyId');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Contact>>(
        '/contacts',
        {
          page, pageSize,
          q: debouncedTerm || undefined,
          companyId: companyIdFilter ?? undefined,
          birthMonth: birthMonthFilter || undefined,
        },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Kişiler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedTerm, companyIdFilter, birthMonthFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm, birthMonthFilter, pageSize]);

  // Derin bağlantı: /contacts/:id kişi kartını doğrudan açar.
  useEffect(() => {
    if (id) {
      setEditingId(id);
      setModalOpen(true);
    }
  }, [id]);

  const remove = async (contact: Contact): Promise<void> => {
    const ok = await confirmDelete(
      `${contact.firstName} ${contact.lastName}`,
      'Kişinin telefonları ve ilişkileri de arşivlenir.',
    );
    if (!ok) return;
    try {
      await api.delete(`/contacts/${contact.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
    }
  };

  const closeModal = (): void => {
    setModalOpen(false);
    setEditingId(null);
    if (id) navigate('/contacts', { replace: true });
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Kişiler</h1>
          <p>Çoklu telefon, esnek doğum günü ve ilişkili fırsat yönetimi.</p>
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
              placeholder="Ad, unvan, e-posta veya telefon ara (eski numaralar dahil)…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Kişi ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={birthMonthFilter}
            onChange={(event) => setBirthMonthFilter(event.target.value)}
            aria-label="Doğum ayı filtresi"
          >
            <option value="">Tüm doğum ayları</option>
            {MONTHS.map((name, index) => (
              <option key={name} value={index + 1}>{name} doğumlular</option>
            ))}
          </select>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconUsers size={42} />
            <h3>Kişi bulunamadı</h3>
            <p>Kişiler bir kuruma bağlı olarak eklenir. Kurum sayfasından yeni kişi ekleyebilirsiniz.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Kişi</th>
                    <th>Kurum</th>
                    <th>Departman</th>
                    <th>Telefonlar</th>
                    <th>Doğum Günü</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((contact) => (
                    <tr
                      key={contact.id} className="clickable"
                      onClick={() => { setEditingId(contact.id); setModalOpen(true); }}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar
                            name={`${contact.firstName} ${contact.lastName}`}
                            src={contact.avatarUrl} size={30}
                          />
                          <div>
                            <div className="font-semibold">
                              {contact.firstName} {contact.lastName}
                              {contact.isPrimary && (
                                <span className="badge" style={{ marginLeft: 6 }}>birincil</span>
                              )}
                            </div>
                            <div className="text-xs text-muted">{contact.title ?? '—'}</div>
                          </div>
                        </div>
                      </td>

                      <td className="text-sm">{contact.company?.name ?? '—'}</td>
                      <td className="text-sm">{contact.departmentName ?? '—'}</td>

                      <td>
                        {contact.phones.length === 0 && <span className="text-faint">—</span>}
                        {contact.phones.slice(0, 3).map((phone) => (
                          <div
                            key={phone.id}
                            className={`text-xs ${phone.isInactive ? 'phone-inactive' : ''}`}
                            title={phone.isInactive ? phone.inactiveReason ?? 'Kullanım dışı' : undefined}
                          >
                            {phone.number}
                            <span className="phone-tag" style={{ marginLeft: 4 }}>{phone.label}</span>
                            {phone.isInactive && (
                              <span className="phone-tag" style={{ marginLeft: 2 }}>Eski</span>
                            )}
                          </div>
                        ))}
                        {contact.phones.length > 3 && (
                          <span className="text-xs text-muted">+{contact.phones.length - 3}</span>
                        )}
                      </td>

                      <td className="text-sm nowrap">
                        {birthdayText(contact)
                          ? <><IconGift size={12} /> {birthdayText(contact)}</>
                          : <span className="text-faint">—</span>}
                      </td>

                      <td className="col-actions">
                        <span className="row-actions">
                          {can('contact:write') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon" aria-label="Düzenle"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingId(contact.id);
                                setModalOpen(true);
                              }}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}
                          {can('contact:delete') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Sil" style={{ color: 'var(--danger)' }}
                              onClick={(event) => { event.stopPropagation(); void remove(contact); }}
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

      <ContactDetailModal
        open={modalOpen}
        contactId={editingId}
        companyId={companyIdFilter ?? undefined}
        onClose={closeModal}
        onSaved={() => void load()}
      />

      {can('contact:write') && companyIdFilter && (
        <button
          type="button" className="btn btn-primary mt-3"
          onClick={() => { setEditingId(null); setModalOpen(true); }}
        >
          <IconPlus size={15} /> Bu Kuruma Kişi Ekle
        </button>
      )}
    </>
  );
}
