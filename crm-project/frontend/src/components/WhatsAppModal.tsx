import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { IconAlert, IconWhatsapp } from './Icons';
import type { ContactPhone } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  phones: ContactPhone[];
  contactName?: string;
  companyName?: string;
}

/**
 * WhatsApp mesaj yönlendirme modalı.
 *
 * CRM, WhatsApp'a doğrudan mesaj GÖNDEREMEZ: resmî WhatsApp Business API
 * entegrasyonu ayrı bir kurumsal onay sürecidir. Bu modal `wa.me` bağlantısı
 * üreterek kullanıcıyı kendi WhatsApp istemcisine yönlendirir ve bu sınırı
 * kullanıcıya açıkça bildirir.
 */
export function WhatsAppModal({ open, onClose, phones, contactName, companyName }: Props) {
  const usablePhones = useMemo(() => phones.filter((phone) => !phone.isInactive), [phones]);

  const [selectedId, setSelectedId] = useState<string>(
    () => usablePhones.find((phone) => phone.isPrimary)?.id ?? usablePhones[0]?.id ?? '',
  );
  const [message, setMessage] = useState(
    `Sayın ${contactName ?? 'Yetkili'}, MKE A.Ş. satış ekibinden ulaşıyorum.`,
  );

  const selected = usablePhones.find((phone) => phone.id === selectedId);

  const waUrl = useMemo(() => {
    if (!selected) return null;
    const digits = (selected.normalizedNumber ?? selected.number).replace(/\D+/g, '');
    if (digits.length < 10) return null;
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }, [selected, message]);

  return (
    <Modal
      open={open}
      title="WhatsApp Mesajı"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Kapat</button>
          <a
            className="btn btn-primary"
            href={waUrl ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!waUrl}
            style={waUrl ? undefined : { pointerEvents: 'none', opacity: 0.55 }}
            onClick={() => { if (waUrl) onClose(); }}
          >
            <IconWhatsapp size={15} /> WhatsApp'ta Aç
          </a>
        </>
      }
    >
      <div className="alert alert-warning">
        <IconAlert size={16} />
        <div>
          Mesaj CRM üzerinden <strong>gönderilmez</strong>. Bağlantı, cihazınızdaki
          WhatsApp uygulamasını hazır metinle açar; göndermeyi siz onaylarsınız.
        </div>
      </div>

      {usablePhones.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>
          <p>Bu kişide kullanılabilir (aktif) telefon numarası yok.</p>
        </div>
      ) : (
        <>
          <div className="field">
            <label className="field-label" htmlFor="wa-phone">Numara</label>
            <select
              id="wa-phone"
              className="select"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {usablePhones.map((phone) => (
                <option key={phone.id} value={phone.id}>
                  {phone.label} — {phone.number}{phone.isPrimary ? ' (birincil)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="wa-message">Mesaj</label>
            <textarea
              id="wa-message" className="textarea" rows={5} value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <div className="field-hint">
              {companyName && `${companyName} · `}{message.length} karakter
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
