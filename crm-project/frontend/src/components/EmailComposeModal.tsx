import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { useDraftAutosave } from '../hooks/useDraftAutosave';
import { Modal } from './Modal';
import { IconMail, IconAlert } from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
  defaultTo?: string;
  companyId?: string | null;
  contactId?: string | null;
  companyName?: string;
  contactName?: string;
}

interface Template {
  id: string;
  label: string;
  subject: string;
  body: string;
}

/**
 * Şablon motoru.
 * `{{sirket}}` / `{{kisi}}` yer tutucuları gönderim anında değil, şablon
 * seçildiği anda doldurulur; kullanıcı metni serbestçe düzenleyebilsin.
 */
const TEMPLATES: Template[] = [
  {
    id: 'tanisma',
    label: 'Tanışma / İlk İletişim',
    subject: '{{sirket}} — MKE A.Ş. İş Birliği Hakkında',
    body:
      'Sayın {{kisi}},\n\n' +
      'MKE A.Ş. olarak savunma, havacılık ve endüstriyel üretim alanlarındaki ' +
      'çözümlerimizi {{sirket}} ile paylaşmak isteriz.\n\n' +
      'Uygun olduğunuz bir zaman diliminde kısa bir görüşme planlayabilir miyiz?\n\n' +
      'Saygılarımızla,\nMKE A.Ş. Satış Ekibi',
  },
  {
    id: 'teklif',
    label: 'Teklif Gönderimi',
    subject: '{{sirket}} — Teklifimiz Ektedir',
    body:
      'Sayın {{kisi}},\n\n' +
      'Talebiniz doğrultusunda hazırladığımız teklifimizi bilgilerinize sunarız. ' +
      'Teklifimiz, üzerinde belirtilen geçerlilik tarihine kadar geçerlidir.\n\n' +
      'Sorularınız için bize ulaşabilirsiniz.\n\n' +
      'Saygılarımızla,\nMKE A.Ş. Satış Ekibi',
  },
  {
    id: 'ihale',
    label: 'İhale Bilgilendirme',
    subject: '{{sirket}} — İhale Süreci Bilgilendirmesi',
    body:
      'Sayın {{kisi}},\n\n' +
      'İlgili ihale sürecine ilişkin hazırlıklarımız tamamlanmıştır. ' +
      'Şartname kapsamındaki teknik gerekliliklere dair değerlendirmemizi ' +
      'ekte bilgilerinize sunarız.\n\n' +
      'Saygılarımızla,\nMKE A.Ş. İhale Birimi',
  },
  {
    id: 'bakim',
    label: 'Periyodik Bakım Hatırlatması',
    subject: '{{sirket}} — Periyodik Bakım Zamanı Yaklaşıyor',
    body:
      'Sayın {{kisi}},\n\n' +
      'Sözleşmeniz kapsamındaki periyodik bakım döneminin yaklaştığını ' +
      'hatırlatmak isteriz. Planlama için uygun tarihlerinizi paylaşmanızı rica ederiz.\n\n' +
      'Saygılarımızla,\nMKE A.Ş. Satış Sonrası Hizmetler',
  },
];

interface DraftShape {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

/** Düz metni güvenli HTML'e çevirir (XSS'i kesen kaçış + satır sonu koruması). */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${
    escaped.replace(/\n/g, '<br>')
  }</div>`;
}

export function EmailComposeModal({
  open, onClose, onSent, defaultTo = '',
  companyId, contactId, companyName, contactName,
}: Props) {
  const draftKey = `email:${companyId ?? 'genel'}:${contactId ?? 'genel'}`;

  const { draft, setDraft, status, clearDraft, hasRestoredDraft } = useDraftAutosave<DraftShape>(
    draftKey,
    { to: defaultTo, cc: '', subject: '', body: '' },
    { enabled: open },
  );

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTemplate = (templateId: string): void => {
    const template = TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;

    const fill = (text: string): string =>
      text
        .replace(/\{\{sirket\}\}/g, companyName ?? 'firmanız')
        .replace(/\{\{kisi\}\}/g, contactName ?? 'Yetkili');

    setDraft((prev) => ({ ...prev, subject: fill(template.subject), body: fill(template.body) }));
  };

  const canSend = useMemo(
    () => draft.to.trim().length > 3 && draft.subject.trim().length > 0 && draft.body.trim().length > 0,
    [draft],
  );

  const send = async (): Promise<void> => {
    setSending(true);
    setError(null);
    try {
      await api.post('/email/send', {
        to: draft.to.trim(),
        cc: draft.cc.trim() || null,
        subject: draft.subject.trim(),
        bodyHtml: textToHtml(draft.body),
        bodyText: draft.body,
        companyId: companyId ?? null,
        contactId: contactId ?? null,
      });
      clearDraft();
      onSent?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'E-posta kaydedilemedi.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      title="E-Posta Gönder"
      onClose={onClose}
      size="lg"
      closeOnBackdrop={false}
      footer={
        <>
          <span className="text-xs text-muted ml-auto" style={{ marginRight: 'auto' }}>
            {status === 'saving' && 'Taslak kaydediliyor…'}
            {status === 'saved' && 'Taslak kaydedildi'}
            {status === 'error' && 'Taslak kaydedilemedi (depolama dolu olabilir)'}
          </span>
          <button type="button" className="btn" onClick={onClose}>Vazgeç</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void send()}
            disabled={!canSend || sending}
          >
            {sending ? <span className="spinner" /> : <IconMail size={15} />}
            Gönder
          </button>
        </>
      }
    >
      <div className="alert alert-info">
        <IconAlert size={16} />
        <div>
          <strong>Yerel E-Posta Simülatörü aktif.</strong> Kurumsal SMTP sunucusu
          tanımlanana kadar mesaj gerçekten gönderilmez; giden kutusuna kaydedilir
          ve müşterinin zaman tüneline "E-Posta Gönderildi" olarak işlenir.
        </div>
      </div>

      {hasRestoredDraft && (
        <div className="alert alert-warning">
          Yarım kalmış bir taslak geri yüklendi.
          <button type="button" className="btn btn-sm ml-auto" onClick={clearDraft}>Temizle</button>
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor="email-template">Hazır Şablon</label>
        <select
          id="email-template"
          className="select"
          defaultValue=""
          onChange={(event) => { applyTemplate(event.target.value); event.target.value = ''; }}
        >
          <option value="">Şablon seçin…</option>
          {TEMPLATES.map((template) => (
            <option key={template.id} value={template.id}>{template.label}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="email-to">Alıcı<span className="req">*</span></label>
        <input
          id="email-to" className="input" type="email" value={draft.to}
          onChange={(event) => setDraft((prev) => ({ ...prev, to: event.target.value }))}
          placeholder="ornek@kurum.gov.tr"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="email-cc">Bilgi (CC)</label>
        <input
          id="email-cc" className="input" value={draft.cc}
          onChange={(event) => setDraft((prev) => ({ ...prev, cc: event.target.value }))}
          placeholder="Virgülle ayırarak birden fazla adres"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="email-subject">Konu<span className="req">*</span></label>
        <input
          id="email-subject" className="input" value={draft.subject}
          onChange={(event) => setDraft((prev) => ({ ...prev, subject: event.target.value }))}
        />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label className="field-label" htmlFor="email-body">Mesaj<span className="req">*</span></label>
        <textarea
          id="email-body" className="textarea" rows={12} value={draft.body}
          onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
        />
      </div>

      {error && <div className="alert alert-danger mt-3" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}
