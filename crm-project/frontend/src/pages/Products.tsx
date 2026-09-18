import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useExchangeRates } from '../hooks/useExchangeRates';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { useConfirm } from '../components/ConfirmDialog';
import {
  IconAlert, IconBox, IconEdit, IconPlus, IconSearch, IconTrash, IconUpload,
} from '../components/Icons';
import type { CurrencyCode, Paginated, Product } from '../types';

const CATEGORIES = ['Mühimmat', 'Ağır Silah', 'Kimyasal', 'Yedek Parça', 'Hizmet', 'Diğer'];
const UNITS = ['Adet', 'Kg', 'Ton', 'Koli', 'Saat', 'Metre'];
// USD ilk sırada: savunma sanayii satışları ağırlıklı dövizlidir.
const CURRENCIES: CurrencyCode[] = ['USD', 'TRY', 'EUR', 'GBP'];

interface FormState {
  sku: string;
  name: string;
  description: string;
  category: string;
  unitPrice: string;
  currency: CurrencyCode;
  taxRate: string;
  stockQuantity: string;
  minStockLevel: string;
  unit: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  sku: '', name: '', description: '', category: 'Yedek Parça', unitPrice: '0',
  currency: 'USD', taxRate: '20', stockQuantity: '0', minStockLevel: '0',
  unit: 'Adet', isActive: true,
};

interface ImportSummary {
  summary: { totalRows: number; created: number; updated: number; skipped: number };
  skipped: { line: number; sku: string; reason: string }[];
}

export function Products() {
  const confirm = useConfirm();
  const { can } = useAuth();
  const { format } = useExchangeRates();

  const [term, setTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:products:pageSize', 25);

  const [result, setResult] = useState<Paginated<Product> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [delimiter, setDelimiter] = useState<';' | ',' | '\t'>(';');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);

  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Product>>(
        '/products',
        {
          page, pageSize,
          q: debouncedTerm || undefined,
          category: categoryFilter || undefined,
          lowStock: lowStockOnly || undefined,
        },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Ürünler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedTerm, categoryFilter, lowStockOnly]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm, categoryFilter, lowStockOnly, pageSize]);

  const openCreate = (): void => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (product: Product): void => {
    setEditing(product);
    setForm({
      sku: product.sku,
      name: product.name,
      description: product.description ?? '',
      category: product.category,
      unitPrice: String(product.unitPrice),
      currency: product.currency,
      taxRate: String(product.taxRate),
      stockQuantity: String(product.stockQuantity),
      minStockLevel: String(product.minStockLevel),
      unit: product.unit,
      isActive: product.isActive,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description || null,
        category: form.category,
        unitPrice: Number(form.unitPrice) || 0,
        currency: form.currency,
        taxRate: Number(form.taxRate) || 0,
        stockQuantity: Math.trunc(Number(form.stockQuantity) || 0),
        minStockLevel: Math.trunc(Number(form.minStockLevel) || 0),
        unit: form.unit,
        isActive: form.isActive,
      };

      if (editing) await api.put(`/products/${editing.id}`, payload);
      else await api.post('/products', payload);

      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ürün kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (product: Product): Promise<void> => {
    const ok = await confirm({
      title: 'Ürünü Pasifleştir',
      message: <><strong>{product.name}</strong> ({product.sku}) pasifleştirilsin mi?</>,
      detail: 'Ürün tekliflerde seçilemez hale gelir; geçmiş kayıtlar korunur.',
      confirmLabel: 'Pasifleştir',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      await api.delete(`/products/${product.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
    }
  };

  const runImport = async (): Promise<void> => {
    setImporting(true);
    setImportResult(null);
    try {
      const response = await api.post<ImportSummary>('/products/import-csv', {
        csv: csvText, updateExisting: true, delimiter,
      });
      setImportResult(response);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İçe aktarma başarısız.');
    } finally {
      setImporting(false);
    }
  };

  const readCsvFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setError('Dosya okunamadı.');
    reader.readAsText(file, 'utf-8');
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Ürün & Envanter Kataloğu</h1>
          <p>Stok kodu bazlı katalog, kritik stok uyarısı ve toplu CSV içe aktarma.</p>
        </div>

        {can('product:write') && (
          <div className="page-actions">
            <button type="button" className="btn" onClick={() => setImportOpen(true)}>
              <IconUpload size={15} /> CSV İçe Aktar
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <IconPlus size={15} /> Yeni Ürün
            </button>
          </div>
        )}
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
              placeholder="Ürün adı veya stok kodu ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Ürün ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Kategori filtresi"
          >
            <option value="">Tüm kategoriler</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <label className="checkbox-row">
            <input
              type="checkbox" checked={lowStockOnly}
              onChange={(event) => setLowStockOnly(event.target.checked)}
            />
            <span>Yalnızca kritik stok</span>
          </label>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconBox size={42} />
            <h3>Ürün bulunamadı</h3>
            <p>Katalog boş. Tek tek ekleyebilir veya CSV ile toplu aktarabilirsiniz.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Stok Kodu</th><th>Ürün</th><th>Kategori</th>
                    <th className="text-right">Birim Fiyat</th><th className="text-right">KDV</th>
                    <th className="text-right">Stok</th><th>Durum</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((product) => (
                    <tr key={product.id}>
                      <td className="mono">{product.sku}</td>
                      <td>
                        <div className="font-semibold">{product.name}</div>
                        {product.description && (
                          <div className="text-xs text-muted truncate" style={{ maxWidth: 280 }}>
                            {product.description}
                          </div>
                        )}
                      </td>
                      <td className="text-sm">{product.category}</td>
                      <td className="text-right nowrap">
                        {format(product.unitPrice, product.currency)}
                      </td>
                      <td className="text-right">%{product.taxRate}</td>
                      <td className="text-right">
                        <span className={product.isLowStock ? 'text-danger font-semibold' : ''}>
                          {product.stockQuantity.toLocaleString('tr-TR')} {product.unit}
                        </span>
                        {product.isLowStock && (
                          <div className="text-xs text-danger">
                            <IconAlert size={10} /> kritik
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={product.isActive ? 'badge badge-success' : 'badge'}>
                          {product.isActive ? 'Aktif' : 'Pasif'}
                        </span>
                      </td>
                      <td className="col-actions">
                        <span className="row-actions">
                          {can('product:write') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Düzenle" onClick={() => openEdit(product)}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}
                          {can('product:delete') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Sil" style={{ color: 'var(--danger)' }}
                              onClick={() => void remove(product)}
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

      <Modal
        open={formOpen}
        title={editing ? `${editing.sku} — Düzenle` : 'Yeni Ürün'}
        onClose={() => setFormOpen(false)}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setFormOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving || !form.sku.trim() || form.name.trim().length < 2}
            >
              {saving && <span className="spinner" />} Kaydet
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-danger">{formError}</div>}

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="p-sku">Stok Kodu<span className="req">*</span></label>
            <input
              id="p-sku" className="input mono" value={form.sku}
              disabled={Boolean(editing)}
              onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value }))}
            />
            {editing && <div className="field-hint">Stok kodu değiştirilemez.</div>}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="p-name">Ürün Adı<span className="req">*</span></label>
            <input
              id="p-name" className="input" value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="p-category">Kategori</label>
            <select
              id="p-category" className="select" value={form.category}
              onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="p-unit">Birim</label>
            <select
              id="p-unit" className="select" value={form.unit}
              onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
            >
              {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="p-price">Birim Fiyat</label>
            <input
              id="p-price" className="input" type="number" min={0} step="0.01"
              value={form.unitPrice}
              onChange={(event) => setForm((prev) => ({ ...prev, unitPrice: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="p-currency">Para Birimi</label>
            <select
              id="p-currency" className="select" value={form.currency}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, currency: event.target.value as CurrencyCode }))}
            >
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="p-tax">KDV Oranı (%)</label>
            <input
              id="p-tax" className="input" type="number" min={0} max={100} step="0.1"
              value={form.taxRate}
              onChange={(event) => setForm((prev) => ({ ...prev, taxRate: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="p-stock">Stok Miktarı</label>
            <input
              id="p-stock" className="input" type="number" min={0} step="1"
              value={form.stockQuantity}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, stockQuantity: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="p-min">Kritik Stok Seviyesi</label>
            <input
              id="p-min" className="input" type="number" min={0} step="1"
              value={form.minStockLevel}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, minStockLevel: event.target.value }))}
            />
            <div className="field-hint">Stok bu seviyenin altına inince uyarı gösterilir.</div>
          </div>

          <div className="field">
            <label className="checkbox-row" style={{ marginTop: 26 }}>
              <input
                type="checkbox" checked={form.isActive}
                onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              <span>Aktif (tekliflerde seçilebilir)</span>
            </label>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="p-desc">Açıklama</label>
          <textarea
            id="p-desc" className="textarea" rows={3} value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
      </Modal>

      <Modal
        open={importOpen}
        title="CSV ile Toplu Ürün Aktarımı"
        onClose={() => { setImportOpen(false); setImportResult(null); }}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button
              type="button" className="btn"
              onClick={() => { setImportOpen(false); setImportResult(null); }}
            >
              Kapat
            </button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void runImport()}
              disabled={importing || csvText.trim().length === 0}
            >
              {importing && <span className="spinner" />} İçe Aktar
            </button>
          </>
        }
      >
        <div className="alert alert-info">
          <IconAlert size={16} />
          <div>
            Beklenen başlıklar: <code className="mono">sku;name;category;unitPrice;currency;taxRate;stockQuantity;unit;description</code>
            <br />
            <strong>sku</strong> ve <strong>name</strong> zorunludur. Mevcut stok kodları güncellenir.
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="csv-file">CSV Dosyası</label>
            <input
              id="csv-file" type="file" accept=".csv,text/csv" className="input"
              onChange={readCsvFile}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="csv-delim">Ayraç</label>
            <select
              id="csv-delim" className="select" value={delimiter}
              onChange={(event) => setDelimiter(event.target.value as ';' | ',' | '\t')}
            >
              <option value=";">Noktalı virgül ( ; )</option>
              <option value=",">Virgül ( , )</option>
              <option value={'\t'}>Sekme</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="csv-text">CSV İçeriği</label>
          <textarea
            id="csv-text" className="textarea mono" rows={9} value={csvText}
            placeholder={'sku;name;category;unitPrice;currency;taxRate;stockQuantity;unit\nMKE-001;Örnek Ürün;Yedek Parça;1250,50;TRY;20;100;Adet'}
            onChange={(event) => setCsvText(event.target.value)}
          />
        </div>

        {importResult && (
          <div className={importResult.summary.skipped > 0 ? 'alert alert-warning' : 'alert alert-success'}>
            <div>
              <strong>{importResult.summary.totalRows} satır işlendi.</strong>
              {' '}{importResult.summary.created} yeni, {importResult.summary.updated} güncellendi,
              {' '}{importResult.summary.skipped} atlandı.

              {importResult.skipped.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {importResult.skipped.slice(0, 12).map((item) => (
                    <li key={`${item.line}-${item.sku}`} className="text-xs">
                      Satır {item.line} ({item.sku || 'boş'}): {item.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
