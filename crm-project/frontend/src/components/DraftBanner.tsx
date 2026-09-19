import { IconAlert, IconCheck, IconX } from './Icons';

/**
 * Kaydedilmemiş taslak bildirimi.
 *
 * Taslak otomatik UYGULANMAZ; kullanıcı yeni bir kayıt açtığını sanırken
 * eski bir taslağın alanlarıyla karşılaşırsa bunu fark etmeyip yanlış
 * veriyi kaydedebilir. Karar açıkça kullanıcıya bırakılır.
 */

interface Props {
  /** Bulunan taslak var mı? */
  visible: boolean;
  savedAt: Date | null;
  onRestore: () => void;
  onDiscard: () => void;
}

/** "3 dakika önce" biçiminde göreli zaman. */
function relativeTime(date: Date | null): string {
  if (!date) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'az önce';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dakika önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function DraftBanner({ visible, savedAt, onRestore, onDiscard }: Props) {
  if (!visible) return null;

  return (
    <div className="draft-banner" role="status">
      <IconAlert size={16} />
      <div className="draft-banner-text">
        <strong>Kaydedilmemiş bir taslağınız bulundu.</strong>
        {savedAt && <span className="draft-banner-time"> {relativeTime(savedAt)} kaydedildi.</span>}
      </div>

      <div className="draft-banner-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={onRestore}>
          <IconCheck size={13} /> Taslağı Yükle
        </button>
        <button type="button" className="btn btn-sm" onClick={onDiscard}>
          <IconX size={13} /> Temizle
        </button>
      </div>
    </div>
  );
}

/**
 * Otomatik kaydetme durumu göstergesi.
 *
 * Form altında sessiz bir satır: kullanıcı yazarken verinin korunduğunu
 * bilmeli ama bu bilgi dikkatini dağıtmamalı.
 */
export function DraftStatusLine({ status, lastSavedAt }: {
  status: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: Date | null;
}) {
  if (status === 'idle') return null;

  if (status === 'error') {
    return (
      <span className="draft-status is-error">
        <IconAlert size={12} /> Taslak kaydedilemedi (depolama dolu olabilir).
      </span>
    );
  }

  return (
    <span className="draft-status">
      {status === 'saving'
        ? 'Taslak kaydediliyor…'
        : `Taslak kaydedildi${lastSavedAt ? ` · ${lastSavedAt.toLocaleTimeString('tr-TR', {
          hour: '2-digit', minute: '2-digit',
        })}` : ''}`}
    </span>
  );
}
