import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { Modal } from '../components/Modal';
import { useDeleteConfirm } from '../components/ConfirmDialog';
import {
  IconBuilding, IconCheck, IconEdit, IconPlus, IconSearch, IconTrash, IconUsers, IconX,
} from '../components/Icons';
import type { TagRecords, TagSummary } from '../types';

/** Kurumsal palete uygun hazır renkler. */
const SWATCHES = [
  '#C5A059', '#E31E24', '#0A192F', '#15803d', '#1d4ed8',
  '#6d28d9', '#b45309', '#0f766e',
];

interface FormState {
  name: string;
  color: string;
  description: string;
}

const EMPTY: FormState = { name: '', color: SWATCHES[0]!, description: '' };

export function Tags() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const confirmDelete = useDeleteConfirm();

  const [term, setTerm] = useState('');
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Seçili etiketin kayıtları — ikinci kolonda gösterilir.
  const [selected, setSelected] = useState<TagSummary | null>(null);
  const [records, setRecords] = useState<TagRecords | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const debouncedTerm = useDebounce(term, 300);
  const canWrite = can('company:write');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<{ data: TagSummary[] }>(
        '/tags', { q: debouncedTerm || undefined }, signal,
      );
      setTags(response.data);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Etiketler alınamadı.');
    } finally {
      setLoading(false);
    }
  }, [debouncedTerm]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const openTag = useCallback(async (tag: TagSummary) => {
    setSelected(tag);
    setRecordsLoading(true);
    try {
      const data = await api.get<TagRecords>(`/tags/${tag.id}/records`);
      setRecords(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etiket kayıtları alınamadı.');
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  const startCreate = (): void => {
    setEditingId(null);
    setForm(EMPTY);
    setFormError(null);
    setFormOpen(true);
  };

  const startEdit = (tag: TagSummary): void => {
    setEditingId(tag.id);
    setForm({ name: tag.name, color: tag.color, description: tag.description ?? '' });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      setFormError('Etiket adı zorunludur.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        color: form.color,
        description: form.description || null,
      };
      if (editingId) await api.put(`/tags/${editingId}`, payload);
      else await api.post('/tags', payload);

      setFormOpen(false);
      await load();
      if (selected && editingId === selected.id) {
        // Yeniden adlandırma sonrası açık panel eski adı göstermesin.
        const fresh = await api.get<TagRecords>(`/tags/${selected.id}/records`);
        setRecords(fresh);
        setSelected((prev) => (prev ? { ...prev, ...payload, description: payload.description } : prev));
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Etiket kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const removeTag = async (tag: TagSummary): Promise<void> => {
    const ok = await confirmDelete(
      tag.name,
      `Etiket ${tag.totalCount} kayıttan kaldırılacak. Kurum ve kişi kayıtları silinmez.`,
    );
    if (!ok) return;
    try {
      await api.delete(`/tags/${tag.id}`);
      if (selected?.id === tag.id) { setSelected(null); setRecords(null); }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etiket silinemedi.');
    }
  };

  /**
   * Etiketi tek bir kayıttan koparır.
   *
   * Kullanıcının aradığı işlem budur: şirketin kendi sayfasına gitmeden
   * buradan etiketi çıkarabilmek.
   */
  const detach = async (kind: 'company' | 'contact', recordId: string): Promise<void> => {
    if (!selected) return;
    try {
      await api.delete(`/tags/${selected.id}/${kind}/${recordId}`);
      setRecords((prev) => {
        if (!prev) return prev;
        return kind === 'company'
          ? { ...prev, companies: prev.companies.filter((row) => row.id !== recordId) }
          : { ...prev, contacts: prev.contacts.filter((row) => row.id !== recordId) };
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etiket kaldırılamadı.');
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Etiketler</h1>
          <p>
            Bir etikete tıklayın: o etiketi taşıyan kurum ve kişiler sağda listelenir,
            her birinden tek tıkla kaldırabilirsiniz.
          </p>
        </div>
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            <IconPlus size={15} /> Yeni Etiket
          </button>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="tag-layout">
        {/* --- Sol: etiket listesi --- */}
        <div className="card">
          <div className="card-header">
            <div style={{ position: 'relative', flex: 1 }}>
              <IconSearch
                size={15}
                style={{
                  position: 'absolute', left: 11, top: '50%',
                  transform: 'translateY(-50%)', color: 'var(--text-faint)',
                }}
              />
              <input
                className="input" style={{ paddingLeft: 33 }}
                placeholder="Etiket ara…"
                value={term} onChange={(event) => setTerm(event.target.value)}
                aria-label="Etiket ara"
              />
            </div>
          </div>

          {loading && tags.length === 0 && (
            <div className="loading-center"><span className="spinner spinner-lg" /></div>
          )}

          {!loading && tags.length === 0 && (
            <div className="empty-state">
              <h3>Etiket yok</h3>
              <p>
                Etiketler kurum ve kişileri serbestçe gruplamanızı sağlar
                (ör. "Körfez pazarı", "Stratejik müşteri", "NATO tedarikçi").
              </p>
            </div>
          )}

          <div className="tag-list">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className={`tag-row${selected?.id === tag.id ? ' is-selected' : ''}`}
              >
                <button
                  type="button"
                  className="tag-row-main"
                  onClick={() => void openTag(tag)}
                >
                  <span className="tag-chip" style={{ background: tag.color }}>
                    {tag.name}
                  </span>
                  <span className="tag-row-counts">
                    <IconBuilding size={12} /> {tag.companyCount}
                    <IconUsers size={12} /> {tag.contactCount}
                  </span>
                </button>

                {canWrite && (
                  <span className="row-actions">
                    <button
                      type="button" className="btn btn-ghost btn-icon"
                      style={{ width: 28, height: 28 }}
                      aria-label={`${tag.name} etiketini düzenle`}
                      onClick={() => startEdit(tag)}
                    >
                      <IconEdit size={14} />
                    </button>
                    <button
                      type="button" className="btn btn-ghost btn-icon"
                      style={{ width: 28, height: 28, color: 'var(--danger)' }}
                      aria-label={`${tag.name} etiketini sil`}
                      onClick={() => void removeTag(tag)}
                    >
                      <IconTrash size={14} />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* --- Sağ: seçili etiketin kayıtları --- */}
        <div className="card">
          {!selected && (
            <div className="empty-state">
              <h3>Etiket seçin</h3>
              <p>Soldan bir etikete tıklayarak bağlı kurum ve kişileri görün.</p>
            </div>
          )}

          {selected && (
            <>
              <div className="card-header">
                <h3>
                  <span className="tag-chip" style={{ background: selected.color }}>
                    {selected.name}
                  </span>
                </h3>
                <button
                  type="button" className="btn btn-ghost btn-icon"
                  aria-label="Paneli kapat"
                  onClick={() => { setSelected(null); setRecords(null); }}
                >
                  <IconX size={16} />
                </button>
              </div>

              <div className="card-body">
                {selected.description && (
                  <p className="text-sm text-muted mb-3">{selected.description}</p>
                )}

                {recordsLoading && <div className="loading-center"><span className="spinner" /></div>}

                {records && records.companies.length === 0 && records.contacts.length === 0 && (
                  <div className="empty-state" style={{ padding: 28 }}>
                    <p>Bu etikete bağlı kayıt yok.</p>
                  </div>
                )}

                {records && records.companies.length > 0 && (
                  <>
                    <h3 className="mb-2"><IconBuilding size={14} /> Kurumlar ({records.companies.length})</h3>
                    <div className="tag-record-list mb-4">
                      {records.companies.map((company) => (
                        <div key={company.id} className="tag-record">
                          <button
                            type="button"
                            className="tag-record-main"
                            onClick={() => navigate(`/companies/${company.id}`)}
                          >
                            <span className="tag-record-name">{company.name}</span>
                            <span className="tag-record-meta">
                              {company.type} · {company.status} · {company.country}
                            </span>
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => void detach('company', company.id)}
                            >
                              <IconX size={12} /> Etiketi Kaldır
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {records && records.contacts.length > 0 && (
                  <>
                    <h3 className="mb-2"><IconUsers size={14} /> Kişiler ({records.contacts.length})</h3>
                    <div className="tag-record-list">
                      {records.contacts.map((contact) => (
                        <div key={contact.id} className="tag-record">
                          <button
                            type="button"
                            className="tag-record-main"
                            onClick={() => navigate(`/contacts/${contact.id}`)}
                          >
                            <span className="tag-record-name">
                              {contact.firstName} {contact.lastName}
                            </span>
                            <span className="tag-record-meta">
                              {contact.title ?? contact.contactType}
                              {' · '}
                              {contact.company?.name ?? 'Bağımsız'}
                              {' · '}{contact.country}
                            </span>
                          </button>
                          {can('contact:write') && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => void detach('contact', contact.id)}
                            >
                              <IconX size={12} /> Etiketi Kaldır
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={formOpen}
        title={editingId ? 'Etiketi Düzenle' : 'Yeni Etiket'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setFormOpen(false)}>
              Vazgeç
            </button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void save()} disabled={saving}
            >
              {saving ? <span className="spinner" /> : <IconCheck size={15} />} Kaydet
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-danger">{formError}</div>}

        <div className="field">
          <label className="field-label" htmlFor="tg-name">Ad<span className="req">*</span></label>
          <input
            id="tg-name" className="input" value={form.name}
            placeholder="Körfez pazarı"
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>

        <div className="field">
          <label className="field-label">Renk</label>
          <div className="flex gap-2 flex-wrap">
            {SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                className="note-swatch"
                style={{
                  background: color,
                  outline: form.color === color ? '2px solid var(--mke-navy)' : 'none',
                }}
                aria-label={`Renk ${color}`}
                onClick={() => setForm((prev) => ({ ...prev, color }))}
              />
            ))}
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="tg-desc">Açıklama</label>
          <textarea
            id="tg-desc" className="textarea" rows={2} value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
      </Modal>
    </>
  );
}
