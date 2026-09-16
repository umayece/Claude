import { useEffect, useRef, useState } from 'react';
import { api, downloadFile } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useExchangeRates } from '../hooks/useExchangeRates';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import {
  IconAlert, IconCheck, IconDownload, IconPlus, IconRefresh,
  IconShield, IconTrash, IconUpload, IconX,
} from '../components/Icons';
import type { CalendarFilterPreferences } from '../types';

const MAX_AVATAR_BYTES = 400 * 1024;

interface MfaSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

interface MfaStatus {
  mfaEnabled: boolean;
  mfaSatisfied: boolean;
  remainingRecoveryCodes: number;
}

export function Settings() {
  const { user, refreshUser, logout } = useAuth();
  const { rates, lastUpdatedAt, isStale, reload } = useExchangeRates();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null);
  const [secondaryEmails, setSecondaryEmails] = useState<string[]>(user?.secondaryEmails ?? []);
  const [newEmail, setNewEmail] = useState('');
  const [calendarPrefs, setCalendarPrefs] = useState<CalendarFilterPreferences>(
    user?.calendarFilterPreferences ?? { showTasks: true, showTenders: true, showBirthdays: false },
  );

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);

  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    // Kullanıcı profili yüklendiğinde form alanlarını doldur.
    if (!user) return;
    setName(user.name);
    setPhone(user.phone ?? '');
    setAvatarUrl(user.avatarUrl ?? null);
    setSecondaryEmails(user.secondaryEmails ?? []);
    if (user.calendarFilterPreferences) setCalendarPrefs(user.calendarFilterPreferences);
  }, [user]);

  useEffect(() => {
    void (async () => {
      try {
        setMfaStatus(await api.get<MfaStatus>('/mfa/status'));
      } catch {
        setMfaStatus(null);
      }
    })();
  }, []);

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

  const saveProfile = async (): Promise<void> => {
    setSavingProfile(true);
    setError(null);
    setProfileMessage(null);
    try {
      await api.put('/users/me', {
        name: name.trim(),
        phone: phone || null,
        avatarUrl,
        secondaryEmails,
        calendarFilterPreferences: calendarPrefs,
      });
      await refreshUser();
      setProfileMessage('Profiliniz güncellendi.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profil kaydedilemedi.');
    } finally {
      setSavingProfile(false);
    }
  };

  const removeAvatar = async (): Promise<void> => {
    setAvatarUrl(null);
    try {
      await api.delete('/users/me/avatar');
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotoğraf kaldırılamadı.');
    }
  };

  const addSecondaryEmail = (): void => {
    const value = newEmail.trim().toLowerCase();
    if (!value) return;
    // Kabaca doğrulama; kesin doğrulamayı sunucu yapar.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Geçerli bir e-posta adresi girin.');
      return;
    }
    if (secondaryEmails.includes(value)) {
      setError('Bu adres zaten ekli.');
      return;
    }
    setSecondaryEmails((prev) => [...prev, value]);
    setNewEmail('');
    setError(null);
  };

  const changePassword = async (): Promise<void> => {
    if (newPassword !== confirmPassword) {
      setError('Yeni şifreler eşleşmiyor.');
      return;
    }
    setChangingPassword(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      // Şifre değişimi tüm oturumları düşürür; kullanıcı tekrar giriş yapar.
      await logout();
      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Şifre değiştirilemedi.');
    } finally {
      setChangingPassword(false);
    }
  };

  const startMfa = async (): Promise<void> => {
    setMfaBusy(true);
    setError(null);
    try {
      setMfaSetup(await api.post<MfaSetup>('/mfa/setup'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA kurulumu başlatılamadı.');
    } finally {
      setMfaBusy(false);
    }
  };

  const enableMfa = async (): Promise<void> => {
    setMfaBusy(true);
    setError(null);
    try {
      const response = await api.post<{ recoveryCodes: string[] }>('/mfa/enable', { code: mfaCode });
      setRecoveryCodes(response.recoveryCodes);
      setMfaSetup(null);
      setMfaCode('');
      setMfaStatus(await api.get<MfaStatus>('/mfa/status'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA etkinleştirilemedi.');
    } finally {
      setMfaBusy(false);
    }
  };

  const downloadBackup = async (): Promise<void> => {
    setBackingUp(true);
    setError(null);
    try {
      await downloadFile('/system/backup', 'mke-crm-backup.json');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yedek alınamadı.');
    } finally {
      setBackingUp(false);
    }
  };

  const isAdmin = user?.role === 'ADMIN';

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Ayarlar</h1>
          <p>Profil, güvenlik ve sistem yönetimi.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {profileMessage && (
        <div className="alert alert-success">
          <IconCheck size={16} /> <span>{profileMessage}</span>
        </div>
      )}

      <div className="grid grid-2">
        {/* Profil */}
        <div className="card">
          <div className="card-header"><h2>Profil Bilgileri</h2></div>
          <div className="card-body">
            <div className="avatar-editor mb-4">
              {avatarUrl ? (
                <img className="avatar-preview" src={avatarUrl} alt="" />
              ) : (
                <Avatar name={user?.name ?? '?'} size={76} />
              )}

              <div className="flex-col gap-2">
                <input
                  ref={fileRef} type="file" accept="image/*"
                  className="sr-only" onChange={pickAvatar} id="profile-avatar"
                />
                <button
                  type="button" className="btn btn-sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <IconUpload size={13} /> Fotoğraf Yükle
                </button>
                {avatarUrl && (
                  <button
                    type="button" className="btn btn-sm" style={{ color: 'var(--danger)' }}
                    onClick={() => void removeAvatar()}
                  >
                    <IconX size={13} /> Kaldır
                  </button>
                )}
                <span className="text-xs text-muted">En fazla 400 KB</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="s-name">Ad Soyad</label>
              <input
                id="s-name" className="input" value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="s-email">Birincil E-Posta</label>
              <input id="s-email" className="input" value={user?.email ?? ''} disabled />
              <div className="field-hint">
                Birincil e-posta giriş kimliğinizdir; değişiklik için yöneticinize başvurun.
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="s-phone">Telefon</label>
              <input
                id="s-phone" className="input" value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label">Bildirim E-Postaları (İkincil)</label>

              {secondaryEmails.length === 0 && (
                <p className="text-sm text-muted">Ek adres tanımlı değil.</p>
              )}

              {secondaryEmails.map((address) => (
                <div className="flex items-center gap-2 mb-2" key={address}>
                  <span className="badge badge-info flex-1 truncate">{address}</span>
                  <button
                    type="button" className="btn btn-ghost btn-icon"
                    style={{ color: 'var(--danger)' }}
                    aria-label={`${address} adresini kaldır`}
                    onClick={() =>
                      setSecondaryEmails((prev) => prev.filter((item) => item !== address))}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}

              <div className="input-row mt-2">
                <input
                  className="input" type="email" value={newEmail}
                  placeholder="yedek@mke.gov.tr"
                  onChange={(event) => setNewEmail(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') addSecondaryEmail(); }}
                  aria-label="Yeni ikincil e-posta"
                />
                <button type="button" className="btn" onClick={addSecondaryEmail}>
                  <IconPlus size={14} /> Ekle
                </button>
              </div>
            </div>

            <div className="field">
              <label className="field-label">Varsayılan Takvim Filtreleri</label>
              {([
                ['showTasks', 'Görevler'],
                ['showTenders', 'İhale Teslimleri'],
                ['showContracts', 'Sözleşmeler'],
                ['showBirthdays', 'Doğum Günleri'],
                ['showMilestones', 'Hakedişler'],
              ] as [keyof CalendarFilterPreferences, string][]).map(([key, label]) => (
                <label className="checkbox-row mb-2" key={key}>
                  <input
                    type="checkbox"
                    checked={calendarPrefs[key] ?? false}
                    onChange={(event) =>
                      setCalendarPrefs((prev) => ({ ...prev, [key]: event.target.checked }))}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <button
              type="button" className="btn btn-primary"
              onClick={() => void saveProfile()}
              disabled={savingProfile || name.trim().length < 2}
            >
              {savingProfile && <span className="spinner" />} Profili Kaydet
            </button>
          </div>
        </div>

        {/* Güvenlik */}
        <div className="flex-col gap-4">
          <div className="card">
            <div className="card-header"><h2>Şifre Değiştir</h2></div>
            <div className="card-body">
              <div className="alert alert-info">
                <IconAlert size={16} />
                <span>
                  Şifre değiştirildiğinde tüm cihazlardaki oturumlar kapatılır
                  ve tekrar giriş yapmanız istenir.
                </span>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="s-current">Mevcut Şifre</label>
                <input
                  id="s-current" className="input" type="password" value={currentPassword}
                  autoComplete="current-password"
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="s-new">Yeni Şifre</label>
                <input
                  id="s-new" className="input" type="password" value={newPassword}
                  autoComplete="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <div className="field-hint">
                  En az 10 karakter; küçük harf, büyük harf, rakam ve sembolden en az üçü.
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="s-confirm">Yeni Şifre (Tekrar)</label>
                <input
                  id="s-confirm" className="input" type="password" value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <div className="field-error">Şifreler eşleşmiyor.</div>
                )}
              </div>

              <button
                type="button" className="btn btn-primary"
                onClick={() => void changePassword()}
                disabled={
                  changingPassword || !currentPassword ||
                  newPassword.length < 10 || newPassword !== confirmPassword
                }
              >
                {changingPassword && <span className="spinner" />} Şifreyi Değiştir
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2><IconShield size={16} /> İki Adımlı Doğrulama</h2>
              {mfaStatus && (
                <span className={mfaStatus.mfaEnabled ? 'badge badge-success' : 'badge badge-warning'}>
                  {mfaStatus.mfaEnabled ? 'Etkin' : 'Kapalı'}
                </span>
              )}
            </div>

            <div className="card-body">
              {mfaStatus?.mfaEnabled ? (
                <>
                  <p className="text-sm">
                    Hesabınız iki adımlı doğrulama ile korunuyor.
                    Kalan kurtarma kodu: <strong>{mfaStatus.remainingRecoveryCodes}</strong>
                  </p>
                  {mfaStatus.remainingRecoveryCodes <= 2 && (
                    <div className="alert alert-warning">
                      <IconAlert size={16} />
                      <span>
                        Kurtarma kodlarınız tükenmek üzere. MFA'yı kapatıp yeniden
                        açarak yeni kod seti alabilirsiniz.
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    Kimlik doğrulama uygulaması (Google Authenticator, Microsoft
                    Authenticator vb.) ile hesabınızı koruyun.
                  </p>
                  <button
                    type="button" className="btn btn-primary"
                    onClick={() => void startMfa()}
                    disabled={mfaBusy}
                  >
                    {mfaBusy && <span className="spinner" />} Kurulumu Başlat
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h2>Döviz Kurları</h2></div>
            <div className="card-body">
              <div className="spec-list mb-3">
                {(['USD', 'EUR', 'GBP'] as const).map((code) => (
                  <div className="spec-row" key={code}>
                    <span className="spec-key">{code}</span>
                    <span className="spec-val mono">{rates[code].toFixed(4)} ₺</span>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted">
                Kaynak: TCMB efektif satış kuru ·{' '}
                {lastUpdatedAt
                  ? `Son güncelleme: ${new Date(lastUpdatedAt).toLocaleString('tr-TR')}`
                  : 'Henüz güncellenmedi'}
              </p>

              {isStale && (
                <div className="alert alert-warning mt-2">
                  <IconAlert size={16} />
                  <span>
                    Kurlar 24 saatten eski. İnternet erişimi yoksa son geçerli
                    kur kullanılmaya devam eder.
                  </span>
                </div>
              )}

              <button type="button" className="btn btn-sm mt-2" onClick={() => void reload()}>
                <IconRefresh size={13} /> Yenile
              </button>
            </div>
          </div>

          {isAdmin && (
            <div className="card">
              <div className="card-header"><h2>Sistem Yönetimi</h2></div>
              <div className="card-body">
                <div className="alert alert-info">
                  <IconAlert size={16} />
                  <span>
                    Yedek dosyası tüm şirket, kişi, satış, sözleşme ve görev
                    kayıtlarını içerir. Kimlik doğrulama sırları (şifre özeti,
                    MFA anahtarı, oturum anahtarları) <strong>dahil edilmez</strong>.
                  </span>
                </div>

                <button
                  type="button" className="btn btn-primary"
                  onClick={() => void downloadBackup()}
                  disabled={backingUp}
                >
                  {backingUp ? <span className="spinner" /> : <IconDownload size={15} />}
                  Tüm CRM Veritabanını Yedekle (JSON İndir)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MFA kurulum */}
      <Modal
        open={mfaSetup !== null}
        title="İki Adımlı Doğrulama Kurulumu"
        onClose={() => { setMfaSetup(null); setMfaCode(''); }}
        closeOnBackdrop={false}
        footer={
          <>
            <button
              type="button" className="btn"
              onClick={() => { setMfaSetup(null); setMfaCode(''); }}
            >
              Vazgeç
            </button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void enableMfa()}
              disabled={mfaBusy || mfaCode.length !== 6}
            >
              {mfaBusy && <span className="spinner" />} Doğrula ve Etkinleştir
            </button>
          </>
        }
      >
        {mfaSetup && (
          <>
            <p className="text-sm">
              1. Kimlik doğrulama uygulamanızla aşağıdaki kareyi tarayın.
            </p>
            <div className="text-center mb-3">
              <img
                src={mfaSetup.qrCodeDataUrl} alt="MFA QR kodu"
                width={190} height={190}
                style={{ border: '1px solid var(--border)', borderRadius: 8 }}
              />
            </div>

            <p className="text-sm">
              Kareyi tarayamıyorsanız bu anahtarı elle girin:
            </p>
            <div
              className="mono text-center mb-3"
              style={{
                background: 'var(--surface-alt)', padding: 10,
                borderRadius: 8, wordBreak: 'break-all',
              }}
            >
              {mfaSetup.secret}
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="mfa-setup-code">
                2. Uygulamadaki 6 haneli kodu girin
              </label>
              <input
                id="mfa-setup-code" className="input mono"
                style={{ fontSize: 20, letterSpacing: 6, textAlign: 'center' }}
                value={mfaCode} maxLength={6} placeholder="000000"
                onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ''))}
              />
            </div>
          </>
        )}
      </Modal>

      {/* Kurtarma kodları */}
      <Modal
        open={recoveryCodes !== null}
        title="Kurtarma Kodlarınız"
        onClose={() => setRecoveryCodes(null)}
        closeOnBackdrop={false}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setRecoveryCodes(null)}>
            Kaydettim, Kapat
          </button>
        }
      >
        <div className="alert alert-warning">
          <IconAlert size={16} />
          <span>
            Bu kodlar <strong>yalnızca bir kez</strong> gösterilir. Güvenli bir
            yerde saklayın; telefonunuza erişemediğinizde giriş yapmanızı sağlar.
            Her kod tek kullanımlıktır.
          </span>
        </div>

        <div
          className="mono"
          style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
            background: 'var(--surface-alt)', padding: 14, borderRadius: 8,
          }}
        >
          {recoveryCodes?.map((code) => <div key={code}>{code}</div>)}
        </div>
      </Modal>
    </>
  );
}
