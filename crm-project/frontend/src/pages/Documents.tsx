import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { useDeleteConfirm } from '../components/ConfirmDialog';
import {
  IconAlert, IconDownload, IconFile, IconPlus, IconSearch, IconTrash, IconUpload,
} from '../components/Icons';
import type { DocumentFile, Paginated } from '../types';

const CATEGORIES = [
  'PAZAR_ANALIZI', 'ULKE_BRIFINGI', 'DIPLOMATIK_NOTA', 'PASAPORT_LISTESI',
  'SUNUM', 'SOZLESME_ORNEGI', 'TEKNIK_DOKUMAN', 'DIGER',
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  PAZAR_ANALIZI: 'Pazar Analiz Raporu',
  ULKE_BRIFINGI: 'Ülke Değerlendirme Brifingi',
  DIPLOMATIK_NOTA: 'Diplomatik Nota',
  PASAPORT_LISTESI: 'Pasaport Listesi',
  SUNUM: 'Brifing Sunumu',
  SOZLESME_ORNEGI: 'Sözleşme Örneği',
  TEKNIK_DOKUMAN: 'Teknik Doküman',
  DIGER: 'Diğer',
};

const CLASSIFICATIONS = ['Tasnif Dışı', 'Hizmete Özel', 'Gizli'] as const;

// Sunucu 7 MB'ı reddeder; kullanıcıyı yüklemeden önce uyarırız.
const MAX_BYTES = 7 * 1024 * 1024;

function classificationClass(value: string): string {
  if (value === 'Gizli') return 'classification-badge cls-secret';
  if (value === 'Hizmete Özel') return 'classification-badge cls-internal';
  return 'classification-badge cls-public';
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface UploadForm {
  title: string;
  category: string;
  classification: string;
  description: string;
  tags: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  sizeBytes: number;
}

const EMPTY_UPLOAD: UploadForm = {
  title: '', category: 'PAZAR_ANALIZI', classification: 'Hizmete Özel',
  description: '', tags: '', fileName: '', mimeType: '', contentBase64: '', sizeBytes: 0,
};

export function Documents() {
  const { can } = useAuth();
  const confirmDelete = useDeleteConfirm();
  const [searchParams] = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);

  const [term, setTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('');
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<Paginated<DocumentFile> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState<UploadForm>(EMPTY_UPLOAD);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const debouncedTerm = useDebounce(term, 350);
  const visitId = searchParams.get('visitId');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<DocumentFile>>(
        '/documents',
        {
          page, pageSize: 24,
          q: debouncedTerm || undefined,
          category: categoryFilter || undefined,
          classification: classificationFilter || undefined,
          visitId: visitId ?? undefined,
        },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Belgeler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedTerm, categoryFilter, classificationFilter, visitId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm, categoryFilter, classificationFilter]);

  /** Dosyayı base64'e çevirir ve form alanlarını doldurur. */
  const readFile = (file: File): void => {
    if (file.size > MAX_BYTES) {
      setError(`Dosya ${formatSize(file.size)}. Üst sınır ${formatSize(MAX_BYTES)}.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setForm((prev) => ({
        ...prev,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        // Data URL önekini sunucu da temizliyor, yine de burada ayıklanır.
        contentBase64: result.replace(/^data:[^;]+;base64,/, ''),
        sizeBytes: file.size,
        title: prev.title || file.name.replace(/\.[^.]+$/, ''),
      }));
      setError(null);
    };
    reader.onerror = () => setError('Dosya okunamadı.');
    reader.readAsDataURL(file);
  };

  const upload = async (): Promise<void> => {
    setUploading(true);
    setError(null);
    try {
      await api.post('/documents', {
        title: form.title.trim(),
        fileName: form.fileName,
        mimeType: form.mimeType,
        contentBase64: form.contentBase64,
        category: form.category,
        classification: form.classification,
        description: form.description || null,
        tags: form.tags
          ? form.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : null,
        visitId: visitId ?? null,
      });

      setUploadOpen(false);
      setForm(EMPTY_UPLOAD);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Belge yüklenemedi.');
    } finally {
      setUploading(false);
    }
  };

  const download = async (document: DocumentFile): Promise<void> => {
    setDownloadingId(document.id);
    try {
      await downloadFile(`/documents/${document.id}/download`, document.fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Belge indirilemedi.');
    } finally {
      setDownloadingId(null);
    }
  };

  const remove = async (document: DocumentFile): Promise<void> => {
    if (!(await confirmDelete(document.title, 'Belge çöp kutusuna taşınır.'))) return;
    try {
      await api.delete(`/documents/${document.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Belge Deposu & Raporlar</h1>
          <p>
            Pazar analiz raporları, ülke değerlendirme brifingleri ve kurumsal evrak arşivi.
            {visitId && ' — Ziyaret ekleri görüntüleniyor.'}
          </p>
        </div>

        {can('document:write') && (
          <div className="page-actions">
            <button
              type="button" className="btn btn-primary"
              onClick={() => { setForm(EMPTY_UPLOAD); setUploadOpen(true); }}
            >
              <IconPlus size={15} /> Belge Yükle
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="alert alert-info">
        <IconAlert size={16} />
        <span>
          Gizlilik dereceli evraklar <strong>indirildiğinde denetim kaydına</strong> yazılır.
          Dosya üst sınırı {formatSize(MAX_BYTES)}.
        </span>
      </div>

      <div className="card mb-4">
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
              placeholder="Belge adı, dosya adı veya açıklama ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Belge ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Kategori filtresi"
          >
            <option value="">Tüm kategoriler</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
            ))}
          </select>

          <select
            className="select" style={{ width: 'auto' }}
            value={classificationFilter}
            onChange={(event) => setClassificationFilter(event.target.value)}
            aria-label="Gizlilik filtresi"
          >
            <option value="">Tüm gizlilik dereceleri</option>
            {CLASSIFICATIONS.map((cls) => <option key={cls} value={cls}>{cls}</option>)}
          </select>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconFile size={42} />
            <h3>Belge yok</h3>
            <p>Pazar analizlerini ve kurumsal evrakları buraya yükleyerek ekiple paylaşın.</p>
            {can('document:write') && (
              <button
                type="button" className="btn btn-primary"
                onClick={() => { setForm(EMPTY_UPLOAD); setUploadOpen(true); }}
              >
                <IconUpload size={15} /> İlk Belgeyi Yükle
              </button>
            )}
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="card-body">
              <div className="doc-grid">
                {result.data.map((document) => (
                  <article className="doc-card" key={document.id}>
                    <div className="flex items-center gap-3">
                      <div className="doc-icon"><IconFile size={19} /></div>
                      <div className="flex-1" style={{ minWidth: 0 }}>
                        <div className="doc-title">{document.title}</div>
                        <div className="doc-meta truncate">{document.fileName}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={classificationClass(document.classification)}>
                        {document.classification}
                      </span>
                      <span className="badge">
                        {CATEGORY_LABELS[document.category] ?? document.category}
                      </span>
                    </div>

                    {document.description && (
                      <div className="doc-meta" style={{ lineHeight: 1.5 }}>
                        {document.description.length > 120
                          ? `${document.description.slice(0, 120)}…`
                          : document.description}
                      </div>
                    )}

                    {document.tags && document.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {document.tags.map((tag) => (
                          <span key={tag} className="phone-tag">{tag}</span>
                        ))}
                      </div>
                    )}

                    <div className="doc-meta">
                      {formatSize(document.sizeBytes)} ·{' '}
                      {new Date(document.createdAt).toLocaleDateString('tr-TR')}
                      {document.uploadedBy && ` · ${document.uploadedBy.name}`}
                    </div>

                    {document.visit && (
                      <div className="doc-meta">Ziyaret: {document.visit.visitCode}</div>
                    )}

                    <div className="flex gap-2 mt-auto" style={{ paddingTop: 8 }}>
                      <button
                        type="button" className="btn btn-sm flex-1"
                        onClick={() => void download(document)}
                        disabled={downloadingId === document.id}
                      >
                        {downloadingId === document.id
                          ? <span className="spinner" style={{ width: 12, height: 12 }} />
                          : <IconDownload size={13} />}
                        İndir
                      </button>

                      {can('document:delete') && (
                        <button
                          type="button" className="btn btn-sm btn-ghost"
                          style={{ color: 'var(--danger)' }}
                          aria-label="Belgeyi sil"
                          onClick={() => void remove(document)}
                        >
                          <IconTrash size={13} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <Pagination
              page={result.meta.page}
              pageSize={result.meta.pageSize}
              total={result.meta.total}
              totalPages={result.meta.totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </div>

      <Modal
        open={uploadOpen}
        title={visitId ? 'Ziyarete Evrak Yükle' : 'Belge Yükle'}
        onClose={() => setUploadOpen(false)}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setUploadOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void upload()}
              disabled={uploading || !form.contentBase64 || form.title.trim().length < 2}
            >
              {uploading && <span className="spinner" />} Yükle
            </button>
          </>
        }
      >
        <input
          ref={fileRef} type="file" className="sr-only" id="doc-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) readFile(file);
          }}
        />

        <div
          className={`dropzone mb-3${dragActive ? ' active' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(event) => { if (event.key === 'Enter') fileRef.current?.click(); }}
          onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            const file = event.dataTransfer.files?.[0];
            if (file) readFile(file);
          }}
        >
          <IconUpload size={28} />
          {form.fileName ? (
            <div className="mt-2">
              <strong>{form.fileName}</strong>
              <div className="text-xs">{formatSize(form.sizeBytes)} · {form.mimeType}</div>
            </div>
          ) : (
            <div className="mt-2">
              Dosyayı buraya sürükleyin veya tıklayıp seçin
              <div className="text-xs mt-1">
                PDF, Office belgeleri, görsel, metin veya zip · en fazla {formatSize(MAX_BYTES)}
              </div>
            </div>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="doc-title">Belge Adı<span className="req">*</span></label>
          <input
            id="doc-title" className="input" value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="doc-cat">Kategori</label>
            <select
              id="doc-cat" className="select" value={form.category}
              onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="doc-cls">Gizlilik Derecesi</label>
            <select
              id="doc-cls" className="select" value={form.classification}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, classification: event.target.value }))}
            >
              {CLASSIFICATIONS.map((cls) => <option key={cls} value={cls}>{cls}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="doc-tags">Etiketler</label>
          <input
            id="doc-tags" className="input" value={form.tags}
            placeholder="Katar, 2026, mühimmat (virgülle ayırın)"
            onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
          />
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="doc-desc">Açıklama</label>
          <textarea
            id="doc-desc" className="textarea" rows={3} value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
      </Modal>
    </>
  );
}
