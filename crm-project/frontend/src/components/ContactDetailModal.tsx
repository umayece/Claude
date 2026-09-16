import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import {
  IconAlert, IconGift, IconPhone, IconPlus, IconTrash, IconUpload, IconX,
} from './Icons';
import type { Contact, ContactPhone, PhoneLabel } from '../types';

const PHONE_LABELS: PhoneLabel[] = ['İş', 'Cep', 'Sabit', 'Dahili', 'Faks'];
const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
const DEAL_STAGES = [
  'Potansiyel', 'İletişime Geçildi', 'Teklif Hazırlanıyor',
  'Teklif Verildi', 'Müzakere', 'Kazanıldı', 'Kaybedildi',
];

// Profil fotoğrafı veri URL'i olarak saklanır; 400 KB üzeri dosyalar
// veritabanını ve API yanıtlarını şişirir.
const MAX_AVATAR_BYTES = 400 * 1024;

type TabKey = 'profile' | 'deals';

interface DraftPhone extends Omit<ContactPhone, 'id' | 'contactId' | 'normalizedNumber'> {
  /** Sunucudaki kayıt kimliği; yeni satırlarda undefined. */
  id?: string;
  /** İstemci tarafı liste anahtarı. */
  key: string;
}

interface Props {
  open: boolean;
  contactId: string | null;
  companyId?: string;
  onClose: () => void;
  onSaved: () => void;
}

function daysInMonth(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

export function ContactDetailModal({ open, contactId, companyId, onClose, onSaved }: Props) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<TabKey>('profile');
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [website, setWebsite] = useState('');
  const [sector, setSector] = useState('');
  const [notes, setNotes] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [birthYear, setBirthYear] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthDay, setBirthDay] = useState('');

  const [phones, setPhones] = useState<DraftPhone[]>([]);

  const reset = useCallback((data: Contact | null) => {
    setContact(data);
    setFirstName(data?.firstName ?? '');
    setLastName(data?.lastName ?? '');
    setTitle(data?.title ?? '');
    setEmail(data?.email ?? '');
    setDepartmentName(data?.departmentName ?? '');
    setManagerName(data?.managerName ?? '');
    setWebsite(data?.website ?? '');
    setSector(data?.sector ?? '');
    setNotes(data?.notes ?? '');
    setAvatarUrl(data?.avatarUrl ?? null);
    setBirthYear(data?.birthYear ? String(data.birthYear) : '');
    setBirthMonth(data?.birthMonth ? String(data.birthMonth) : '');
    setBirthDay(data?.birthDay ? String(data.birthDay) : '');
    setPhones(
      (data?.phones ?? []).map((phone, index) => ({
        id: phone.id,
        key: `${phone.id}-${index}`,
        number: phone.number,
        label: phone.label,
        isPrimary: phone.isPrimary,
        isInactive: phone.isInactive,
        inactiveReason: phone.inactiveReason,
      })),
    );
  }, []);

  useEffect(() => {
    if (!open) return;

    if (!contactId) {
      reset(null);
      setTab('profile');
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const data = await api.get<Contact>(`/contacts/${contactId}`, undefined, controller.signal);
        reset(data);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Kişi yüklenemedi.');
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [open, contactId, reset]);

  const pickAvatar = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Yalnızca görsel dosyaları yüklenebilir.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError(`Fotoğraf en fazla ${Math.round(MAX_AVATAR_BYTES / 1024)} KB olabilir.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(typeof reader.result === 'string' ? reader.result : null);
      setError(null);
    };
    reader.onerror = () => setError('Fotoğraf okunamadı.');
    reader.readAsDataURL(file);
  };

  const removeAvatar = async (): Promise<void> => {
    setAvatarUrl(null);
    // Kayıtlı bir fotoğraf varsa sunucudan da silinir; yalnızca yerel
    // önizlemeyi temizlemek, kaydetmeden çıkınca fotoğrafı geri getirirdi.
    if (contact?.avatarUrl && contactId) {
      try {
        await api.delete(`/contacts/${contactId}/avatar`);
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fotoğraf kaldırılamadı.');
      }
    }
  };

  const addPhone = (): void => {
    setPhones((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}-${prev.length}`,
        number: '',
        label: 'Cep',
        isPrimary: prev.length === 0,
        isInactive: false,
        inactiveReason: null,
      },
    ]);
  };

  const updatePhone = (key: string, patch: Partial<DraftPhone>): void => {
    setPhones((prev) =>
      prev.map((phone) => {
        if (phone.key !== key) {
          // Birincil işaretlenirse diğerlerinin birincilliği kalkar.
          return patch.isPrimary ? { ...phone, isPrimary: false } : phone;
        }
        return { ...phone, ...patch };
      }),
    );
  };

  const birthdayValid = useMemo(
    () => (birthMonth === '') === (birthDay === ''),
    [birthMonth, birthDay],
  );

  const save = async (): Promise<void> => {
    if (!birthdayValid) {
      setError('Doğum günü için ay ve gün birlikte girilmelidir.');
      return;
    }

    const targetCompanyId = contact?.companyId ?? companyId;
    if (!targetCompanyId) {
      setError('Kişi bir şirkete bağlı olmalıdır.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        companyId: targetCompanyId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        title: title || null,
        email: email || null,
        departmentName: departmentName || null,
        managerName: managerName || null,
        website: website || null,
        sector: sector || null,
        notes: notes || null,
        avatarUrl,
        birthYear: birthYear ? Number(birthYear) : null,
        birthMonth: birthMonth ? Number(birthMonth) : null,
        birthDay: birthDay ? Number(birthDay) : null,
        phones: phones
          .filter((phone) => phone.number.trim().length >= 3)
          .map((phone) => ({
            id: phone.id,
            number: phone.number.trim(),
            label: phone.label,
            isPrimary: phone.isPrimary,
            isInactive: phone.isInactive,
            inactiveReason: phone.isInactive ? phone.inactiveReason || null : null,
          })),
      };

      if (contactId) await api.put(`/contacts/${contactId}`, payload);
      else await api.post('/contacts', payload);

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kişi kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const updateDealStage = async (dealId: string, stage: string): Promise<void> => {
    try {
      await api.put(`/deals/${dealId}/stage`, { stage });
      if (contactId) {
        const refreshed = await api.get<Contact>(`/contacts/${contactId}`);
        setContact(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aşama güncellenemedi.');
    }
  };

  const fullName = `${firstName} ${lastName}`.trim() || 'Yeni Kişi';

  return (
    <Modal
      open={open}
      title={contactId ? fullName : 'Yeni Kişi'}
      onClose={onClose}
      size="lg"
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Vazgeç</button>
          <button
            type="button" className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || !firstName.trim() || !lastName.trim() || !birthdayValid}
          >
            {saving && <span className="spinner" />} Kaydet
          </button>
        </>
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="loading-center"><span className="spinner spinner-lg" /></div>}

      {!loading && (
        <>
          {contactId && (
            <div className="drawer-tabs" style={{ padding: 0, marginBottom: 16 }}>
              <button
                type="button"
                className={`drawer-tab${tab === 'profile' ? ' active' : ''}`}
                onClick={() => setTab('profile')}
              >
                Profil
              </button>
              <button
                type="button"
                className={`drawer-tab${tab === 'deals' ? ' active' : ''}`}
                onClick={() => setTab('deals')}
              >
                İlişkili Fırsatlar & Siparişler
                {contact?.deals && contact.deals.length > 0 && (
                  <span className="badge">{contact.deals.length}</span>
                )}
              </button>
            </div>
          )}

          {tab === 'profile' && (
            <>
              <div className="avatar-editor mb-4">
                {avatarUrl ? (
                  <img className="avatar-preview" src={avatarUrl} alt="" />
                ) : (
                  <Avatar name={fullName} size={76} />
                )}

                <div className="flex-col gap-2">
                  <input
                    ref={fileRef} type="file" accept="image/*"
                    className="sr-only" onChange={pickAvatar}
                    id="contact-avatar-input"
                  />
                  <button
                    type="button" className="btn btn-sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    <IconUpload size={13} /> Fotoğraf Yükle
                  </button>

                  {avatarUrl && (
                    <button
                      type="button" className="btn btn-sm"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => void removeAvatar()}
                    >
                      <IconX size={13} /> Fotoğrafı Kaldır
                    </button>
                  )}
                  <span className="text-xs text-muted">En fazla 400 KB · JPG/PNG</span>
                </div>
              </div>

              <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
                <div className="field">
                  <label className="field-label" htmlFor="ct-first">Ad<span className="req">*</span></label>
                  <input
                    id="ct-first" className="input" value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ct-last">Soyad<span className="req">*</span></label>
                  <input
                    id="ct-last" className="input" value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ct-title">Unvan</label>
                  <input
                    id="ct-title" className="input" value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Satın Alma Müdürü"
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ct-dept">Departman</label>
                  <input
                    id="ct-dept" className="input" value={departmentName}
                    onChange={(event) => setDepartmentName(event.target.value)}
                    placeholder="Serbest metin"
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ct-manager">Bağlı Olduğu Yönetici</label>
                  <input
                    id="ct-manager" className="input" value={managerName}
                    onChange={(event) => setManagerName(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ct-email">E-Posta</label>
                  <input
                    id="ct-email" className="input" type="email" value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ct-web">Web Sitesi</label>
                  <input
                    id="ct-web" className="input" value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ct-sector">Sektör</label>
                  <input
                    id="ct-sector" className="input" value={sector}
                    onChange={(event) => setSector(event.target.value)}
                  />
                </div>
              </div>

              <h3 className="mb-2 mt-3">
                <IconGift size={14} /> Doğum Günü
              </h3>
              <p className="text-xs text-muted mb-2">
                Yalnızca yıl veya yalnızca ay/gün girebilirsiniz. Ay ve gün birlikte girilmelidir.
              </p>

              <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
                <div className="field">
                  <label className="field-label" htmlFor="ct-year">Yıl</label>
                  <input
                    id="ct-year" className="input" type="number"
                    min={1900} max={new Date().getFullYear()}
                    value={birthYear} placeholder="1978"
                    onChange={(event) => setBirthYear(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ct-month">Ay</label>
                  <select
                    id="ct-month" className={`select${birthdayValid ? '' : ' invalid'}`}
                    value={birthMonth}
                    onChange={(event) => {
                      setBirthMonth(event.target.value);
                      // Ay küçülünce geçersiz kalan günü düzelt (31 Şubat olmasın).
                      const max = event.target.value ? daysInMonth(Number(event.target.value)) : 31;
                      if (birthDay && Number(birthDay) > max) setBirthDay(String(max));
                    }}
                  >
                    <option value="">—</option>
                    {MONTHS.map((name, index) => (
                      <option key={name} value={index + 1}>{name}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="ct-day">Gün</label>
                  <select
                    id="ct-day" className={`select${birthdayValid ? '' : ' invalid'}`}
                    value={birthDay}
                    onChange={(event) => setBirthDay(event.target.value)}
                  >
                    <option value="">—</option>
                    {Array.from(
                      { length: birthMonth ? daysInMonth(Number(birthMonth)) : 31 },
                      (_, index) => index + 1,
                    ).map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </div>
              </div>

              {!birthdayValid && (
                <div className="alert alert-warning">
                  <IconAlert size={15} />
                  <span>Ay ve gün birlikte girilmelidir; yalnızca biri seçilemez.</span>
                </div>
              )}

              <div className="flex items-center justify-between mb-2 mt-3">
                <h3><IconPhone size={14} /> Telefon Numaraları</h3>
                <button type="button" className="btn btn-sm" onClick={addPhone}>
                  <IconPlus size={13} /> Numara Ekle
                </button>
              </div>

              {phones.length === 0 && (
                <p className="text-sm text-muted">Kayıtlı numara yok.</p>
              )}

              {phones.map((phone) => (
                <div key={phone.key}>
                  <div className="phone-row">
                    <select
                      className="select"
                      value={phone.label}
                      onChange={(event) =>
                        updatePhone(phone.key, { label: event.target.value as PhoneLabel })}
                      aria-label="Numara etiketi"
                    >
                      {PHONE_LABELS.map((label) => (
                        <option key={label} value={label}>{label}</option>
                      ))}
                    </select>

                    <input
                      className={`input${phone.isInactive ? ' phone-inactive' : ''}`}
                      value={phone.number}
                      placeholder="0532 123 45 67"
                      onChange={(event) => updatePhone(phone.key, { number: event.target.value })}
                      aria-label="Telefon numarası"
                    />

                    <button
                      type="button" className="btn btn-ghost btn-icon"
                      style={{ color: 'var(--danger)' }}
                      aria-label="Numarayı sil"
                      onClick={() =>
                        setPhones((prev) => prev.filter((item) => item.key !== phone.key))}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>

                  <div
                    className="flex items-center gap-3 flex-wrap mb-3"
                    style={{ paddingLeft: 2 }}
                  >
                    <label className="checkbox-row">
                      <input
                        type="radio"
                        name="primary-phone"
                        checked={phone.isPrimary}
                        disabled={phone.isInactive}
                        onChange={() => updatePhone(phone.key, { isPrimary: true })}
                      />
                      <span className="text-xs">Birincil</span>
                    </label>

                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={phone.isInactive}
                        onChange={(event) =>
                          updatePhone(phone.key, {
                            isInactive: event.target.checked,
                            // Kullanım dışı numara birincil olamaz.
                            isPrimary: event.target.checked ? false : phone.isPrimary,
                          })}
                      />
                      <span className="text-xs">Kullanım Dışı / Eski</span>
                    </label>

                    {phone.isInactive && (
                      <input
                        className="input"
                        style={{ width: 210, fontSize: 12, padding: '4px 8px' }}
                        placeholder="Neden? (ör. hat kapandı)"
                        value={phone.inactiveReason ?? ''}
                        onChange={(event) =>
                          updatePhone(phone.key, { inactiveReason: event.target.value })}
                        aria-label="Kullanım dışı nedeni"
                      />
                    )}
                  </div>
                </div>
              ))}

              <div className="alert alert-info mt-2">
                <IconAlert size={15} />
                <span>
                  Kullanım dışı numaralar aramada yine de eşleşir; kart üzerinde
                  gri ve üstü çizili gösterilir.
                </span>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label" htmlFor="ct-notes">Notlar</label>
                <textarea
                  id="ct-notes" className="textarea" rows={3} value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </>
          )}

          {tab === 'deals' && contact && (
            <>
              <h3 className="mb-2">Fırsatlar</h3>
              {contact.deals && contact.deals.length > 0 ? (
                <div className="table-wrap mb-4">
                  <table className="table">
                    <thead>
                      <tr><th>Fırsat</th><th>Aşama</th><th className="text-right">Tutar</th><th /></tr>
                    </thead>
                    <tbody>
                      {contact.deals.map((deal) => (
                        <tr key={deal.id}>
                          <td>{deal.title}</td>
                          <td>
                            {/* Aşama doğrudan burada değiştirilir; kullanıcı
                                Fırsatlar sayfasına gitmek zorunda kalmaz. */}
                            <select
                              className="select"
                              style={{ width: 'auto', padding: '3px 7px', fontSize: 12 }}
                              value={deal.stage}
                              disabled={!can('deal:write')}
                              onChange={(event) =>
                                void updateDealStage(deal.id, event.target.value)}
                            >
                              {DEAL_STAGES.map((stage) => (
                                <option key={stage} value={stage}>{stage}</option>
                              ))}
                            </select>
                          </td>
                          <td className="text-right nowrap">
                            {deal.amount.toLocaleString('tr-TR')} {deal.currency}
                          </td>
                          <td className="col-actions">
                            <button
                              type="button" className="btn btn-sm btn-ghost"
                              onClick={() => { onClose(); navigate(`/deals/${deal.id}`); }}
                            >
                              Aç
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted mb-4">Bu kişiye bağlı fırsat yok.</p>
              )}

              <h3 className="mb-2">Teklifler</h3>
              {contact.offers && contact.offers.length > 0 ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Teklif No</th><th>Başlık</th><th>Durum</th><th className="text-right">Tutar</th></tr>
                    </thead>
                    <tbody>
                      {contact.offers.map((offer) => (
                        <tr key={offer.id}>
                          <td className="mono">{offer.offerNumber}</td>
                          <td>{offer.title}</td>
                          <td><span className="badge">{offer.status}</span></td>
                          <td className="text-right nowrap">
                            {offer.total.toLocaleString('tr-TR')} {offer.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted">Bu kişiye bağlı teklif yok.</p>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
