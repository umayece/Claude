import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { SearchableSelect } from '../components/SearchableSelect';
import { IconBuilding, IconEdit, IconPlus, IconSearch, IconTrash } from '../components/Icons';
import { useConfirm } from '../components/ConfirmDialog';
import type {
  City, Company, CompanyType, CountryOption, CustomFieldDefinition, Paginated,
} from '../types';

export const COMPANY_STAGES = [
  'Potansiyel',
  'İletişime Geçildi',
  'Teklif Hazırlanıyor',
  'Teklif Verildi',
  'Müzakere',
  'Kazanıldı',
  'Kaybedildi',
] as const;

/** Kısaltmaların açılımı: G2G özellikle açıklama gerektiriyor. */
export const TYPE_LABELS: Record<string, string> = {
  B2G: 'Firmadan Kamuya',
  B2B: 'Firmadan Firmaya',
  B2C: 'Firmadan Son Kullanıcıya',
  G2G: 'Devletten Devlete',
  OTHER: 'Diğer',
};

const SECTORS = ['Savunma', 'Havacılık', 'Kimya', 'Makine', 'Otomotiv', 'Kamu', 'Diğer'];
const TYPES: CompanyType[] = ['B2G', 'B2B', 'B2C', 'G2G', 'OTHER'];

export function typeBadgeClass(type: string): string {
  switch (type) {
    case 'B2G': return 'badge badge-b2g';
    case 'B2B': return 'badge badge-b2b';
    case 'B2C': return 'badge badge-b2c';
    case 'G2G': return 'badge badge-g2g';
    default: return 'badge';
  }
}

interface FormState {
  name: string;
  type: CompanyType;
  status: string;
  sector: string;
  website: string;
  email: string;
  phone: string;
  taxNumber: string;
  taxOffice: string;
  address: string;
  country: string;
  countryCode: string;
  cityId: string | null;
  /** Katalogda olmayan ülke için elle girilen ISO kodu. */
  manualCountryCode: string;
  /** Listede olmayan (çoğunlukla yurt dışı) şehirler için serbest metin. */
  cityName: string;
  districtName: string;
  /** Şehir seçilemeyen lokasyonlarda elle girilen koordinat. */
  latitude: string;
  longitude: string;
  notes: string;
  customFields: Record<string, string>;
}

const EMPTY_FORM: FormState = {
  name: '', type: 'B2B', status: 'Potansiyel', sector: '', website: '', email: '',
  phone: '', taxNumber: '', taxOffice: '', address: '',
  country: 'Türkiye', countryCode: 'TR', manualCountryCode: '', cityId: null, cityName: '',
  districtName: '', latitude: '', longitude: '', notes: '', customFields: {},
};

export function Companies() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [term, setTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalStorage('crm:companies:pageSize', 25);

  const [result, setResult] = useState<Paginated<Company> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cities, setCities] = useState<City[]>([]);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [scopeFilter, setScopeFilter] = useState<'' | 'domestic' | 'international'>('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const debouncedTerm = useDebounce(term, 350);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<Company>>(
        '/companies',
        {
          page, pageSize,
          q: debouncedTerm || undefined,
          type: typeFilter || undefined,
          status: statusFilter || undefined,
          scope: scopeFilter || undefined,
        },
        signal,
      );
      setResult(response);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Şirketler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedTerm, typeFilter, statusFilter, scopeFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Filtre değişince ilk sayfaya dön — aksi halde boş bir 7. sayfa görünür.
  useEffect(() => { setPage(1); }, [debouncedTerm, typeFilter, statusFilter, scopeFilter, pageSize]);

  useEffect(() => {
    void (async () => {
      try {
        const [cityResponse, countryResponse, fieldResponse] = await Promise.all([
          api.get<{ data: City[] }>('/cities'),
          api.get<{ data: CountryOption[] }>('/cities/countries'),
          api.get<{ data: CustomFieldDefinition[] }>('/custom-fields', { entityType: 'COMPANY' }),
        ]);
        setCities(cityResponse.data);
        setCountries(countryResponse.data);
        setCustomFields(fieldResponse.data);
      } catch {
        // Yardımcı listeler yüklenemese de tablo çalışmaya devam eder.
      }
    })();
  }, []);

  // Şehir listesi seçili ülkeye göre süzülür; aksi halde Türkiye illeriyle
  // yurt dışı şehirler tek listede karışırdı.
  const cityOptions = useMemo(
    () => cities
      .filter((city) => city.countryCode === form.countryCode)
      .map((city) => ({
        value: city.id,
        label: city.name,
        description: city.plateCode ? `Plaka ${city.plateCode}` : city.region ?? city.country,
      })),
    [cities, form.countryCode],
  );

  const openCreate = (): void => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDuplicateWarning(null);
    setFormOpen(true);
  };

  const openEdit = (company: Company): void => {
    setEditing(company);
    setForm({
      name: company.name,
      type: company.type,
      status: company.status,
      sector: company.sector ?? '',
      website: company.website ?? '',
      email: company.email ?? '',
      phone: company.phone ?? '',
      taxNumber: company.taxNumber ?? '',
      taxOffice: company.taxOffice ?? '',
      address: company.address ?? '',
      country: company.country ?? 'Türkiye',
      countryCode: company.countryCode ?? 'TR',
      manualCountryCode: '',
      cityId: company.cityId,
      cityName: company.cityName ?? '',
      districtName: company.districtName ?? '',
      // Formda ham (elle girilmiş) koordinat gösterilir; şehirden türetilen
      // değer düzenleme sırasında "elle girilmiş" gibi görünmemeli.
      latitude: company.rawLatitude !== null && company.rawLatitude !== undefined
        ? String(company.rawLatitude) : '',
      longitude: company.rawLongitude !== null && company.rawLongitude !== undefined
        ? String(company.rawLongitude) : '',
      notes: company.notes ?? '',
      customFields: Object.fromEntries(
        Object.entries(company.customFields ?? {}).map(([key, value]) => [key, String(value ?? '')]),
      ),
    });
    setFormError(null);
    setDuplicateWarning(null);
    setFormOpen(true);
  };

  const save = async (force = false): Promise<void> => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        status: form.status,
        sector: form.sector || null,
        website: form.website || null,
        email: form.email || null,
        phone: form.phone || null,
        taxNumber: form.taxNumber || null,
        taxOffice: form.taxOffice || null,
        address: form.address || null,
        country: form.country.trim(),
        // Elle girilen ülkede kod serbest alandan gelir; seçili ülkede
        // katalogdan. Sunucu her iki durumda da 2 harf bekler.
        countryCode: form.countryCode === '__manual__'
          ? form.manualCountryCode.trim().toUpperCase()
          : form.countryCode,
        // Şehir seçilmişse koordinat ve ülke sunucuda o kayıttan türetilir.
        // Elle koordinat girildiyse sunucu onu ezmez — şehir listesinde
        // olmayan yurt dışı lokasyonlar böylece haritaya düşer.
        cityId: form.cityId,
        cityName: form.cityName || null,
        districtName: form.districtName || null,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        notes: form.notes || null,
        customFields: Object.keys(form.customFields).length ? form.customFields : null,
      };

      if (editing) {
        await api.put(`/companies/${editing.id}`, payload);
      } else {
        await api.post('/companies', payload, force ? { force: 'true' } : undefined);
      }

      setFormOpen(false);
      await load();
    } catch (err) {
      const apiError = err as { code?: string; message?: string };
      if (apiError.code === 'CONFLICT') {
        setDuplicateWarning(apiError.message ?? 'Benzer bir kayıt var.');
      } else {
        setFormError(apiError.message ?? 'Kayıt edilemedi.');
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (company: Company): Promise<void> => {
    const confirmed = await confirm({
      title: 'Çöp Kutusuna Taşı',
      message: <><strong>{company.name}</strong> çöp kutusuna taşınacak.</>,
      detail:
        'İlgili kişi, fırsat, teklif ve sözleşmeler de arşivlenir. ' +
        '30 gün içinde geri yükleyebilirsiniz.',
      confirmLabel: 'Çöp Kutusuna Taşı',
      tone: 'warning',
    });
    if (!confirmed) return;

    try {
      await api.delete(`/companies/${company.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Şirketler & Kurumlar</h1>
          <p>B2G, B2B ve B2C müşteri kayıtları.</p>
        </div>

        {can('company:write') && (
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <IconPlus size={15} /> Yeni Kurum
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
              className="input"
              style={{ paddingLeft: 33 }}
              placeholder="Ad, vergi no, e-posta ara…"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              aria-label="Şirket ara"
            />
          </div>

          <select
            className="select" style={{ width: 'auto' }}
            value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Tip filtresi"
          >
            <option value="">Tüm tipler</option>
            {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>

          <select
            className="select" style={{ width: 'auto' }}
            value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Durum filtresi"
          >
            <option value="">Tüm durumlar</option>
            {COMPANY_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </select>

          <select
            className="select" style={{ width: 'auto' }}
            value={scopeFilter}
            onChange={(event) =>
              setScopeFilter(event.target.value as '' | 'domestic' | 'international')}
            aria-label="Kapsam filtresi"
          >
            <option value="">Yurt içi + yurt dışı</option>
            <option value="domestic">Yalnızca yurt içi</option>
            <option value="international">Yalnızca yurt dışı</option>
          </select>
        </div>

        {loading && !result && (
          <div className="loading-center"><span className="spinner spinner-lg" /></div>
        )}

        {result && result.data.length === 0 && (
          <div className="empty-state">
            <IconBuilding size={42} />
            <h3>Kayıt bulunamadı</h3>
            <p>Arama kriterlerinizi değiştirin veya yeni bir kurum ekleyin.</p>
            {can('company:write') && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <IconPlus size={15} /> Yeni Kurum
              </button>
            )}
          </div>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Kurum</th>
                    <th>Tip</th>
                    <th>Durum</th>
                    <th>Sektör</th>
                    <th>Ülke / Şehir</th>
                    <th className="text-right">Kişi</th>
                    <th className="text-right">Fırsat</th>
                    <th className="text-right">İhale</th>
                    <th className="col-actions">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((company) => (
                    <tr
                      key={company.id}
                      className="clickable"
                      onClick={() => navigate(`/companies/${company.id}`)}
                    >
                      <td>
                        <div className="font-semibold">{company.name}</div>
                        {company.website && (
                          <div className="text-xs text-muted truncate">{company.website}</div>
                        )}
                      </td>
                      <td><span className={typeBadgeClass(company.type)}>{company.type}</span></td>
                      <td><span className="badge badge-info">{company.status}</span></td>
                      <td className="text-sm">{company.sector ?? '—'}</td>
                      <td className="text-sm">
                        <div>{company.country ?? 'Türkiye'}</div>
                        {(company.displayCity ?? company.city?.name ?? company.cityName) && (
                          <div className="text-xs text-muted">
                            {company.displayCity ?? company.city?.name ?? company.cityName}
                          </div>
                        )}
                      </td>
                      <td className="text-right">{company._count?.contacts ?? 0}</td>
                      <td className="text-right">{company._count?.deals ?? 0}</td>
                      <td className="text-right">{company._count?.tenders ?? 0}</td>
                      <td className="col-actions">
                        <span className="row-actions">
                          {can('company:write') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Düzenle"
                              onClick={(event) => { event.stopPropagation(); openEdit(company); }}
                            >
                              <IconEdit size={15} />
                            </button>
                          )}
                          {can('company:delete') && (
                            <button
                              type="button" className="btn btn-ghost btn-icon"
                              aria-label="Sil" style={{ color: 'var(--danger)' }}
                              onClick={(event) => { event.stopPropagation(); void remove(company); }}
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
        title={editing ? `${editing.name} — Düzenle` : 'Yeni Kurum'}
        onClose={() => setFormOpen(false)}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setFormOpen(false)}>Vazgeç</button>
            <button
              type="button" className="btn btn-primary"
              onClick={() => void save(Boolean(duplicateWarning))}
              disabled={saving || form.name.trim().length < 2}
            >
              {saving && <span className="spinner" />}
              {duplicateWarning ? 'Yine de Kaydet' : 'Kaydet'}
            </button>
          </>
        }
      >
        {formError && <div className="alert alert-danger">{formError}</div>}
        {duplicateWarning && (
          <div className="alert alert-warning">
            <strong>Olası çift kayıt:</strong> {duplicateWarning} Devam etmek için
            "Yine de Kaydet" düğmesini kullanın.
          </div>
        )}

        <div className="grid grid-2" style={{ gap: 0, columnGap: 16 }}>
          <div className="field">
            <label className="field-label" htmlFor="c-name">Kurum Adı<span className="req">*</span></label>
            <input
              id="c-name" className="input" value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-type">Müşteri Tipi</label>
            <select
              id="c-type" className="select" value={form.type}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, type: event.target.value as CompanyType }))}
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>{type} — {TYPE_LABELS[type]}</option>
              ))}
            </select>
            <div className="field-hint">Tip sonradan serbestçe değiştirilebilir.</div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-status">Durum</label>
            <select
              id="c-status" className="select" value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              {COMPANY_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-sector">Sektör</label>
            <select
              id="c-sector" className="select" value={form.sector}
              onChange={(event) => setForm((prev) => ({ ...prev, sector: event.target.value }))}
            >
              <option value="">Seçiniz…</option>
              {SECTORS.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-country">Ülke<span className="req">*</span></label>
            <select
              id="c-country" className="select" value={form.countryCode}
              onChange={(event) => {
                const next = countries.find((c) => c.countryCode === event.target.value);
                // Ülke değişince şehir seçimi sıfırlanır: başka ülkenin
                // şehri seçili kalırsa koordinat ve ülke çelişir.
                const manual = event.target.value === '__manual__';
                setForm((prev) => ({
                  ...prev,
                  countryCode: event.target.value,
                  // Elle girişe geçerken ülke adı boşaltılır ki kullanıcı
                  // önceki ülkenin adını yanlışlıkla kaydetmesin.
                  country: manual ? '' : next?.country ?? prev.country,
                  cityId: null,
                }));
              }}
            >
              {/* Ülke kataloğu yüklenene (veya istek başarısız olana) kadar
                  seçici boş kalmamalı: varsayılan pazar her zaman listede. */}
              {countries.length === 0 && (
                <option value={form.countryCode}>{form.country}</option>
              )}
              {countries.map((option) => (
                <option key={option.countryCode} value={option.countryCode}>
                  {option.country}
                </option>
              ))}
              {/* Ülke kataloğu yalnızca şehir kaydı OLAN ülkeleri içerir.
                  Hiç şehri olmayan bir pazara (ör. ilk kez girilen bir
                  ülke) kayıt açabilmek için elle giriş şart. */}
              <option value="__manual__">— Listede yok (elle gir) —</option>
            </select>
          </div>

          {form.countryCode === '__manual__' && (
            <>
              <div className="field">
                <label className="field-label" htmlFor="c-country-manual">
                  Ülke Adı<span className="req">*</span>
                </label>
                <input
                  id="c-country-manual" className="input" value={form.country}
                  placeholder="Kazakistan"
                  onChange={(event) => setForm((prev) => ({
                    ...prev, country: event.target.value,
                  }))}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="c-cc-manual">
                  Ülke Kodu (ISO 3166, 2 harf)<span className="req">*</span>
                </label>
                <input
                  id="c-cc-manual" className="input mono" maxLength={2}
                  value={form.manualCountryCode}
                  placeholder="KZ"
                  onChange={(event) => setForm((prev) => ({
                    ...prev, manualCountryCode: event.target.value.toUpperCase(),
                  }))}
                />
                <div className="field-hint">
                  Harita filtreleri ve yurt içi/yurt dışı ayrımı bu kodu kullanır.
                </div>
              </div>
            </>
          )}

          <div className="field">
            <label className="field-label" htmlFor="c-city">Şehir</label>
            <SearchableSelect
              id="c-city"
              options={cityOptions}
              value={form.cityId}
              onChange={(value) => setForm((prev) => ({ ...prev, cityId: value }))}
              placeholder={cityOptions.length ? 'Şehir seçiniz…' : 'Bu ülke için kayıtlı şehir yok'}
              emptyText="Bu ülke için kayıtlı şehir yok — aşağıya serbest metin girin."
            />
            <div className="field-hint">
              Şehir seçildiğinde harita koordinatı ve ülke otomatik doldurulur.
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-cityname">Şehir (Serbest Metin)</label>
            <input
              id="c-cityname" className="input" value={form.cityName}
              placeholder="Listede olmayan şehir / bölge"
              onChange={(event) => setForm((prev) => ({ ...prev, cityName: event.target.value }))}
            />
            <div className="field-hint">
              Listede bulunmayan lokasyonlar için. Haritada görünmesi istenirse
              aşağıya koordinat girin.
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-district">İlçe / Bölge</label>
            <input
              id="c-district" className="input" value={form.districtName}
              onChange={(event) => setForm((prev) => ({ ...prev, districtName: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-lat">Enlem (Latitude)</label>
            <input
              id="c-lat" className="input" type="number" step="0.000001" min={-90} max={90}
              value={form.latitude} placeholder="Şehirden otomatik"
              onChange={(event) => setForm((prev) => ({ ...prev, latitude: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-lng">Boylam (Longitude)</label>
            <input
              id="c-lng" className="input" type="number" step="0.000001" min={-180} max={180}
              value={form.longitude} placeholder="Şehirden otomatik"
              onChange={(event) => setForm((prev) => ({ ...prev, longitude: event.target.value }))}
            />
            <div className="field-hint">
              Boş bırakılırsa seçilen şehrin koordinatı kullanılır.
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-website">Web Sitesi</label>
            <input
              id="c-website" className="input" value={form.website}
              placeholder="https://"
              onChange={(event) => setForm((prev) => ({ ...prev, website: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-email">E-Posta</label>
            <input
              id="c-email" className="input" type="email" value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-phone">Telefon</label>
            <input
              id="c-phone" className="input" value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-tax">Vergi No</label>
            <input
              id="c-tax" className="input" value={form.taxNumber}
              onChange={(event) => setForm((prev) => ({ ...prev, taxNumber: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-taxoffice">Vergi Dairesi</label>
            <input
              id="c-taxoffice" className="input" value={form.taxOffice}
              onChange={(event) => setForm((prev) => ({ ...prev, taxOffice: event.target.value }))}
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="c-address">Adres</label>
          <textarea
            id="c-address" className="textarea" rows={2} value={form.address}
            onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
          />
        </div>

        {customFields.length > 0 && (
          <>
            <h3 className="mt-3 mb-2">Özel Alanlar</h3>
            <div className="grid grid-2" style={{ gap: 0, columnGap: 16 }}>
              {customFields.map((definition) => (
                <div className="field" key={definition.id}>
                  <label className="field-label" htmlFor={`cf-${definition.fieldKey}`}>
                    {definition.fieldLabel}
                    {definition.isRequired && <span className="req">*</span>}
                  </label>

                  {definition.fieldType === 'SELECT' ? (
                    <select
                      id={`cf-${definition.fieldKey}`} className="select"
                      value={form.customFields[definition.fieldKey] ?? ''}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          customFields: { ...prev.customFields, [definition.fieldKey]: event.target.value },
                        }))}
                    >
                      <option value="">Seçiniz…</option>
                      {definition.options.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`cf-${definition.fieldKey}`} className="input"
                      type={definition.fieldType === 'NUMBER' ? 'number'
                        : definition.fieldType === 'DATE' ? 'date' : 'text'}
                      value={form.customFields[definition.fieldKey] ?? ''}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          customFields: { ...prev.customFields, [definition.fieldKey]: event.target.value },
                        }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="c-notes">Notlar</label>
          <textarea
            id="c-notes" className="textarea" rows={3} value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
      </Modal>
    </>
  );
}
