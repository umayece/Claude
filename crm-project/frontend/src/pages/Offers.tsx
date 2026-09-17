import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useExchangeRates } from '../hooks/useExchangeRates';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { IconFile, IconPlus, IconSearch, IconTrash } from '../components/Icons';
import type { Company, CurrencyCode, Offer, Paginated, Product } from '../types';

const OFFER_STATUSES = ['Taslak', 'Gönderildi', 'Revize', 'Kabul', 'Ret', 'Süresi Doldu'] as const;
const CURRENCIES: CurrencyCode[] = ['TRY', 'USD', 'EUR', 'GBP'];

interface LineItem {
  key: string;
  productId: string | null;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxRate: string;
  discountRate: string;
}

interface OfferForm {
  title: string;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  status: string;
  currency: CurrencyCode;
  validUntil: string;
  notes: string;
  items: LineItem[];
}

function emptyLine(index: number): LineItem {
  return {
    key: `line-${Date.now()}-${index}`,
    productId: null, name: '', description: '',
    quantity: '1', unit: 'Adet', unitPrice: '0', taxRate: '20', discountRate: '0',
  };
}

const EMPTY_OFFER: OfferForm = {
  title: '', companyId: null, contactId: null, dealId: null,
  status: 'Taslak', currency: 'TRY', validUntil: '', notes: '', items: [emptyLine(0)],
};

export function Offers() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  const { format } = useExchangeRates();

  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:offers:pageSize', 25);

  const [result, setResult] = useState<Paginated<Offer> | null>(null);
  const [detail, setDetail] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<OfferForm>(EMPTY_OFFER);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [companyTerm, setCompanyTerm] = useState('');
  const debouncedCompanyTerm = useDebounce(companyTerm, 300);

  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Offer>>(
        '/offers',
        { page, pageSize, q: debouncedTerm || undefined, status: statusFilter || undefined },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Teklifler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedTerm, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setPage(1); }, [debouncedTerm, statusFilter, pageSize]);

  const openDetail = useCallback(async (offerId: string) => {
    try {
      setDetail(await api.get<Offer>(`/offers/${offerId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teklif yüklenemedi.');
    }
  }, []);

  useEffect(() => {
    if (id) void openDetail(id);
  }, [id, openDetail]);

  // Yardımcı listeler yalnızca form açıkken yüklenir.
  useEffect(() => {
    if (!formOpen) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const [companyResponse, productResponse] = await Promise.all([
          api.get<Paginated<Company>>(
            '/companies', { q: debouncedCompanyTerm || undefined, pageSize: 30 }, controller.signal,
          ),
          api.get<Paginated<Product>>('/products', { pageSize: 200, isActive: true }, controller.signal),
        ]);
        setCompanies(companyResponse.data);
        setProducts(productResponse.data);
      } catch {
        // Yardımcı listeler olmadan da form elle doldurulabilir.
      }
    })();
    return () => controller.abort();
  }, [formOpen, debouncedCompanyTerm]);

  /**
   * Fırsattan gelen parametreleri forma taşır.
   *
   * Fırsat tutarı TEK KALEM olarak açılır; kullanıcı kalemleri ayrıştırır.
   * Bu, "teklif kalemi yok" diye boş bir formla karşılaşmayı önler.
   */
  useEffect(() => {
    const fromDeal = searchParams.get('fromDeal');
    if (!fromDeal) return;

    const amount = searchParams.get('amount') ?? '0';
    const title = searchParams.get('title') ?? '';

    setForm({
      ...EMPTY_OFFER,
      title: title ? `${title} — Teklif` : '',
      companyId: searchParams.get('companyId'),
      contactId: searchParams.get('contactId'),
      dealId: fromDeal,
      currency: (searchParams.get('currency') as CurrencyCode) ?? 'TRY',
      items: [{ ...emptyLine(0), name: title || 'Teklif kalemi', unitPrice: amount }],
    });
    setFormError(null);
    setFormOpen(true);

    // Parametreler tüketildi: sayfa yenilendiğinde form tekrar açılmasın.
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const companyOptions: SelectOption[] = useMemo(
    () => companies.map((company) => ({
      value: company.id, label: company.name,
      description: [company.type, company.country].filter(Boolean).join(' · '),
    })),
    [companies],
  );

  const productOptions: SelectOption[] = useMemo(
    () => products.map((product) => ({
      value: product.id,
      label: `${product.sku} — ${product.name}`,
      description: `${product.unitPrice.toLocaleString('tr-TR')} ${product.currency} / ${product.unit}`,
    })),
    [products],
  );

  /** Toplamlar sunucuda yeniden hesaplanır; buradaki değer önizlemedir. */
  const totals = useMemo(() => {
    let subtotal = 0;
    let taxTotal = 0;
    for (const item of form.items) {
      const gross = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
      const net = gross * (1 - (Number(item.discountRate) || 0) / 100);
      subtotal += net;
      taxTotal += net * ((Number(item.taxRate) || 0) / 100);
    }
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      total: Math.round((subtotal + taxTotal) * 100) / 100,
    };
  }, [form.items]);

  const updateLine = (key: string, patch: Partial<LineItem>): void => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    }));
  };

  /** Ürün seçilince ad, birim, fiyat ve KDV kalemden otomatik dolar. */
  const applyProduct = (key: string, productId: string | null): void => {
    const product = products.find((p) => p.id === productId);
    updateLine(key, {
      productId,
      ...(product
        ? {
            name: product.name,
            unit: product.unit,
            unitPrice: String(product.unitPrice),
            taxRate: String(product.taxRate),
          }
        : {}),
    });
  };

  const saveOffer = async (): Promise<void> => {
    if (!form.companyId) {
      setFormError('Müşteri seçimi zorunludur.');
      return;
    }
    const validItems = form.items.filter((item) => item.name.trim());
    if (validItems.length === 0) {
      setFormError('En az bir teklif kalemi girilmelidir.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await api.post('/offers', {
        title: form.title.trim(),
        companyId: form.companyId,
        contactId: form.contactId,
        dealId: form.dealId,
        status: form.status,
        currency: form.currency,
        validUntil: form.validUntil || null,
        notes: form.notes || null,
        items: validItems.map((item, index) => ({
          productId: item.productId,
          name: item.name.trim(),
          description: item.description || null,
          quantity: Number(item.quantity) || 0,
          unit: item.unit,
          unitPrice: Number(item.unitPrice) || 0,
          taxRate: Number(item.taxRate) || 0,
          discountRate: Number(item.discountRate) || 0,
          sortOrder: index,
        })),
      });

      setFormOpen(false);
      setForm(EMPTY_OFFER);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Teklif kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Teklifler</h1>
          <p>Kalem bazlı fiyatlandırma, KDV ve iskonto hesabı sunucu tarafında yapılır.</p>
        </div>

        {can('offer:write') && (
          <div className="page-actions">
            <button
              type="button" className="btn btn-primary"
              onClick={() => { setForm(EMPTY_OFFER); setFormError(null); setFormOpen(true); }}
            >
              <IconPlus size={15} /> Yeni Teklif
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
              placeholder="Teklif başlığı veya numarası ara…"
              value={term} onChange={(event) => setTerm(event.target.value)}
              aria-label="Teklif ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Durum filtresi"
          >
            <option value="">Tüm durumlar</option>
            {OFFER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconFile size={42} />
            <h3>Teklif yok</h3>
            <p>Fırsatlarınızdan teklif oluşturarak süreci ilerletin.</p>
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Teklif No</th><th>Başlık</th><th>Müşteri</th><th>Durum</th>
                    <th className="text-right">Tutar</th><th>Geçerlilik</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((offer) => (
                    <tr key={offer.id} className="clickable" onClick={() => void openDetail(offer.id)}>
                      <td className="mono">{offer.offerNumber}</td>
                      <td className="font-semibold">{offer.title}</td>
                      <td className="text-sm">{offer.company?.name ?? '—'}</td>
                      <td><span className="badge badge-info">{offer.status}</span></td>
                      <td className="text-right nowrap">{format(offer.total, offer.currency)}</td>
                      <td className="text-sm nowrap">
                        {offer.validUntil
                          ? new Date(offer.validUntil).toLocaleDateString('tr-TR')
                          : '—'}
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
        title={form.dealId ? 'Fırsattan Teklif Oluştur' : 'Yeni Teklif'}
        onClose={() => setFormOpen(false)}
        size="xl"
        closeOnBackdrop={false}
        footer={
          <>
            <span className="text-sm ml-auto" style={{ marginRight: 'auto' }}>
              Genel Toplam: <strong>{format(totals.total, form.currency)}</strong>
            </span>
            <button type="button" className="btn" onClick={() => setFormOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void saveOffer()}
              disabled={saving || form.title.trim().length < 2 || !form.companyId}
            >
              {saving && <span className="spinner" />} Teklifi Kaydet
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-danger">{formError}</div>}

        {form.dealId && (
          <div className="alert alert-info">
            <IconFile size={16} />
            <span>
              Bu teklif bir satış fırsatından oluşturuluyor; başlık, müşteri,
              para birimi ve tutar fırsattan taşındı.
            </span>
          </div>
        )}

        <div className="grid grid-2" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="of-title">Başlık<span className="req">*</span></label>
            <input
              id="of-title" className="input" value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="of-company">Müşteri<span className="req">*</span></label>
            <SearchableSelect
              id="of-company"
              options={companyOptions}
              value={form.companyId}
              onChange={(value) => setForm((prev) => ({ ...prev, companyId: value }))}
              onSearch={setCompanyTerm}
              placeholder="Müşteri seçiniz…"
            />
          </div>
        </div>

        <div className="grid grid-3" style={{ gap: 0, columnGap: 14 }}>
          <div className="field">
            <label className="field-label" htmlFor="of-currency">Para Birimi</label>
            <select
              id="of-currency" className="select" value={form.currency}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, currency: event.target.value as CurrencyCode }))}
            >
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="of-status">Durum</label>
            <select
              id="of-status" className="select" value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              {OFFER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="of-valid">Geçerlilik Tarihi</label>
            <input
              id="of-valid" className="input" type="date" value={form.validUntil}
              onChange={(event) => setForm((prev) => ({ ...prev, validUntil: event.target.value }))}
            />
          </div>
        </div>

        <div className="flex items-center justify-between mb-2 mt-3">
          <h3>Teklif Kalemleri</h3>
          <button
            type="button" className="btn btn-sm"
            onClick={() =>
              setForm((prev) => ({ ...prev, items: [...prev.items, emptyLine(prev.items.length)] }))}
          >
            <IconPlus size={13} /> Kalem Ekle
          </button>
        </div>

        {form.items.map((item) => (
          <div
            key={item.key}
            className="card"
            style={{ padding: 12, marginBottom: 10, background: 'var(--surface-alt)' }}
          >
            <div className="grid grid-2" style={{ gap: 0, columnGap: 12 }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label className="field-label">Katalogdan Seç</label>
                <SearchableSelect
                  options={productOptions}
                  value={item.productId}
                  onChange={(value) => applyProduct(item.key, value)}
                  placeholder="Ürün seçiniz (isteğe bağlı)…"
                />
              </div>

              <div className="field" style={{ marginBottom: 10 }}>
                <label className="field-label">Kalem Adı<span className="req">*</span></label>
                <input
                  className="input" value={item.name}
                  onChange={(event) => updateLine(item.key, { name: event.target.value })}
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr)) auto',
                gap: 10, alignItems: 'end',
              }}
            >
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">Miktar</label>
                <input
                  className="input" type="number" min={0} step="0.01" value={item.quantity}
                  onChange={(event) => updateLine(item.key, { quantity: event.target.value })}
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">Birim</label>
                <input
                  className="input" value={item.unit}
                  onChange={(event) => updateLine(item.key, { unit: event.target.value })}
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">Birim Fiyat</label>
                <input
                  className="input" type="number" min={0} step="0.01" value={item.unitPrice}
                  onChange={(event) => updateLine(item.key, { unitPrice: event.target.value })}
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">İskonto %</label>
                <input
                  className="input" type="number" min={0} max={100} step="0.1" value={item.discountRate}
                  onChange={(event) => updateLine(item.key, { discountRate: event.target.value })}
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">KDV %</label>
                <input
                  className="input" type="number" min={0} max={100} step="0.1" value={item.taxRate}
                  onChange={(event) => updateLine(item.key, { taxRate: event.target.value })}
                />
              </div>

              <button
                type="button" className="btn btn-ghost btn-icon"
                style={{ color: 'var(--danger)' }}
                aria-label="Kalemi sil"
                disabled={form.items.length === 1}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev, items: prev.items.filter((line) => line.key !== item.key),
                  }))}
              >
                <IconTrash size={15} />
              </button>
            </div>
          </div>
        ))}

        <div className="grid grid-3 mt-3">
          <div className="kpi">
            <div className="kpi-label">Ara Toplam</div>
            <div className="kpi-value" style={{ fontSize: 18 }}>
              {format(totals.subtotal, form.currency)}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">KDV</div>
            <div className="kpi-value" style={{ fontSize: 18 }}>
              {format(totals.taxTotal, form.currency)}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Genel Toplam</div>
            <div className="kpi-value" style={{ fontSize: 18 }}>
              {format(totals.total, form.currency)}
            </div>
          </div>
        </div>

        <div className="field mt-3" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="of-notes">Notlar</label>
          <textarea
            id="of-notes" className="textarea" rows={3} value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
      </Modal>

      <Modal
        open={detail !== null}
        title={detail ? `${detail.offerNumber} — ${detail.title}` : ''}
        onClose={() => { setDetail(null); if (id) navigate('/offers', { replace: true }); }}
        size="xl"
      >
        {detail && (
          <>
            <div className="grid grid-3 mb-4">
              <div className="kpi">
                <div className="kpi-label">Ara Toplam</div>
                <div className="kpi-value" style={{ fontSize: 19 }}>
                  {format(detail.subtotal, detail.currency)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">KDV</div>
                <div className="kpi-value" style={{ fontSize: 19 }}>
                  {format(detail.taxTotal, detail.currency)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Genel Toplam</div>
                <div className="kpi-value" style={{ fontSize: 19 }}>
                  {format(detail.total, detail.currency)}
                </div>
              </div>
            </div>

            <h3 className="mb-2">Teklif Kalemleri</h3>
            {detail.items && detail.items.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Kalem</th><th className="text-right">Miktar</th><th>Birim</th>
                      <th className="text-right">Birim Fiyat</th><th className="text-right">İskonto</th>
                      <th className="text-right">KDV</th><th className="text-right">Satır Toplamı</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="font-semibold">{item.name}</div>
                          {item.description && (
                            <div className="text-xs text-muted">{item.description}</div>
                          )}
                        </td>
                        <td className="text-right">{item.quantity.toLocaleString('tr-TR')}</td>
                        <td className="text-sm">{item.unit}</td>
                        <td className="text-right nowrap">
                          {format(item.unitPrice, detail.currency)}
                        </td>
                        <td className="text-right">%{item.discountRate}</td>
                        <td className="text-right">%{item.taxRate}</td>
                        <td className="text-right nowrap font-semibold">
                          {format(item.lineTotal, detail.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">Bu teklifte kalem yok.</p>
            )}

            {detail.notes && (
              <>
                <h3 className="mb-2 mt-4">Notlar</h3>
                <p className="text-sm text-muted">{detail.notes}</p>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
