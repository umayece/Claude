import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { MapPoint } from '../types';
import { HeatCanvasLayer, type HeatPoint } from './HeatCanvasLayer';
import { IconChevronDown, IconChevronLeft, IconRefresh, IconMap } from './Icons';

type TypeFilter = 'ALL' | 'B2G' | 'B2B' | 'B2C' | 'G2G';
type ScopeFilter = 'ALL' | 'TR' | 'INTL';

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'ALL', label: 'Tümü' },
  { key: 'B2G', label: 'B2G' },
  { key: 'B2B', label: 'B2B' },
  { key: 'B2C', label: 'B2C' },
  { key: 'G2G', label: 'G2G' },
];

const SCOPE_FILTERS: { key: ScopeFilter; label: string }[] = [
  { key: 'ALL', label: 'Tümü' },
  { key: 'TR', label: 'Yurt İçi' },
  { key: 'INTL', label: 'Yurt Dışı' },
];

// Varsayılan görünüm Türkiye odaklıdır, ancak harita küreseldir:
// veri yurt dışına yayıldığında `fitToData()` tüm noktaları kadraja alır.
const TURKEY_CENTER: L.LatLngExpression = [39.0, 35.0];
const TURKEY_ZOOM = 6;

function formatTry(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} M ₺`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} B ₺`;
  return `${value.toLocaleString('tr-TR')} ₺`;
}

function pinColor(type: string): string {
  switch (type) {
    case 'B2G': return '#4f46e5';
    case 'B2B': return '#0d9488';
    case 'B2C': return '#db2777';
    case 'G2G': return '#9b1b30';
    default: return '#64748b';
  }
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const heatRef = useRef<HeatCanvasLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  // İlk veri yüklemesinde kadrajı bir kez otomatik ayarlarız; sonraki
  // filtre değişimlerinde kullanıcının konumunu zorla değiştirmeyiz.
  const didAutoFit = useRef(false);
  const navigate = useNavigate();

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('ALL');
  const [onlyTenders, setOnlyTenders] = useState(false);
  const [onlyRecent, setOnlyRecent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Filtre paneli katlanabilir: harita küçük ekranlarda panel tarafından
  // tıkanmasın. Tercih oturumlar arası hatırlanır.
  const [filtersOpen, setFiltersOpen] = useLocalStorage('crm:map:filtersOpen', true);

  // --- Harita örneğini bir kez kur ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: TURKEY_CENTER,
      zoom: TURKEY_ZOOM,
      // Sonsuz yatay tekrar kapalı: dünya sağa doğru kopyalanmaz.
      worldCopyJump: false,
      // minZoom 2: tüm dünya tek ekranda görülebilsin (yurt dışı kayıtlar için).
      minZoom: 2,
      maxZoom: 16,
      zoomControl: true,
      attributionControl: true,
      maxBounds: L.latLngBounds([-85, -180], [85, 180]),
      maxBoundsViscosity: 1,
    });

    // CARTO Voyager — ANAHTARSIZ ve ücretsiz raster karo servisi.
    //
    // Standart OSM karolarında etiketler yerel dilde basılır (Arapça,
    // Yunanca, Rusça...). CARTO'nun bu uç noktası küresel olarak İngilizce
    // etiket kullanır; savunma sanayii ihracat haritasında şehir adlarının
    // okunabilir olması şarttır.
    //
    // NOT: Bu uç nokta API anahtarı İSTEMEZ. Anahtar isteyen (ve anahtarsız
    // isteklerde filigran basan) sağlayıcılar CARTO'nun ticari "basemaps
    // API" ürünleridir; aşağıdaki `basemaps.cartocdn.com/rastertiles/...`
    // yolu ücretsiz genel CDN'dir.
    //
    // `{r}` retina soneki: Leaflet yüksek DPI ekranlarda otomatik olarak
    // "@2x" koyar, normal ekranlarda boş bırakır.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors '
        + '&copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
      // Döşemeler tekrarlanmaz; harita tek bir dünya gösterir.
      noWrap: true,
      bounds: L.latLngBounds([-85, -180], [85, 180]),
    }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);

    const heat = new HeatCanvasLayer([]);
    heat.addTo(map);
    heatRef.current = heat;

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      heatRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // --- Veriyi yükle ---
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<{ data: MapPoint[]; meta: { total: number; capped: boolean } }>(
        '/companies/map',
        undefined,
        signal,
      );
      setPoints(response.data);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Harita verisi alınamadı.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // --- Filtreler bağımsız uygulanır (tip ∧ kapsam ∧ ek koşullar) ---
  const filtered = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;

    return points.filter((point) => {
      if (typeFilter !== 'ALL' && point.type !== typeFilter) return false;

      if (scopeFilter === 'TR' && point.countryCode !== 'TR') return false;
      if (scopeFilter === 'INTL' && point.countryCode === 'TR') return false;

      if (onlyTenders && point.tenderCount === 0) return false;
      if (onlyRecent && new Date(point.createdAt).getTime() < cutoff) return false;

      return true;
    });
  }, [points, typeFilter, scopeFilter, onlyTenders, onlyRecent]);

  /** Görünür noktaların tamamını kadraja alır. */
  const fitToData = useCallback((rows: MapPoint[]) => {
    const map = mapRef.current;
    if (!map || rows.length === 0) return;

    const bounds = L.latLngBounds(rows.map((p) => [p.latitude, p.longitude] as L.LatLngTuple));
    if (!bounds.isValid()) return;

    // Tek nokta varsa `fitBounds` aşırı yakınlaşır; makul bir zoom veririz.
    if (rows.length === 1) {
      map.setView(bounds.getCenter(), 9);
      return;
    }
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 11 });
  }, []);

  // --- Katmanları güncelle ---
  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    const heat = heatRef.current;
    if (!map || !markers || !heat) return;

    markers.clearLayers();

    // Yoğunluk cironun karekökü ile ölçeklenir: tek bir dev sözleşme
    // haritanın geri kalanını görünmez kılmasın.
    const maxRevenue = Math.max(1, ...filtered.map((p) => p.revenueTry));
    const scale = Math.sqrt(maxRevenue);

    const heatPoints: HeatPoint[] = filtered.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
      intensity: point.revenueTry > 0
        ? Math.max(0.16, Math.min(1, Math.sqrt(point.revenueTry) / scale))
        : 0.14,
    }));
    heat.setPoints(heatPoints);

    // --- Kümeleme ---
    // Aynı koordinata birden fazla şirket düştüğünde (ör. hepsi Ankara'da)
    // üstteki pin diğerlerini tamamen örtüyordu ve yalnızca biri
    // tıklanabiliyordu.
    //
    // Kural: HER BENZERSİZ KOORDİNAT İÇİN TEK MARKER. Marker'a tıklanınca
    // açılan popup, o koordinattaki TÜM kurumları kaydırılabilir bir liste
    // hâlinde gösterir; hiçbir kayıt bir diğerinin altında kalmaz.
    //
    // Harici bir kümeleme eklentisi yerine bu yaklaşım seçildi: şehir
    // merkezine düşen kayıtların koordinatı BİREBİR aynıdır, dolayısıyla
    // yakınlık bazlı kümelemeye gerek yoktur ve sonuç zoom seviyesinden
    // bağımsız olarak kararlıdır.
    const groups = new Map<string, MapPoint[]>();
    for (const point of filtered) {
      const key = `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(point);
      else groups.set(key, [point]);
    }

    const openCompany = (id: string): void => navigate(`/companies/${id}`);

    /**
     * Bir koordinattaki TÜM kurumları kaydırılabilir liste hâlinde gösterir.
     *
     * Tek kurumlu koordinatlarda da aynı biçim kullanılır: kullanıcının
     * gördüğü kutu her tıklamada aynı yapıda olur, tek/çoklu ayrımı
     * öğrenmek zorunda kalmaz. Liste `.cluster-list` ile 260px'de kesilir
     * ve kendi içinde kayar — 40 kurumlu Ankara pini ekranı taşırmaz.
     */
    const groupPopup = (rows: MapPoint[]): HTMLElement => {
      const wrapper = document.createElement('div');
      const place = rows[0]?.cityName ?? rows[0]?.country ?? 'Bu konum';

      const title = document.createElement('div');
      title.className = 'map-popup-title';
      title.textContent = rows.length === 1
        ? place
        : `${place} — ${rows.length} kurum`;
      wrapper.appendChild(title);

      const addRow = (key: string, value: string): void => {
        const row = document.createElement('div');
        row.className = 'map-popup-row';
        const k = document.createElement('span');
        k.textContent = key;
        const v = document.createElement('strong');
        v.textContent = value;
        row.append(k, v);
        wrapper.appendChild(row);
      };

      addRow('Toplam ciro', formatTry(rows.reduce((sum, p) => sum + p.revenueTry, 0)));
      addRow('Fırsat', String(rows.reduce((sum, p) => sum + p.dealCount, 0)));
      const tenderTotal = rows.reduce((sum, p) => sum + p.tenderCount, 0);
      if (tenderTotal > 0) addRow('Aktif ihale', String(tenderTotal));
      if (rows.every((p) => p.coordinateSource === 'CITY')) {
        addRow('Konum', 'Şehir merkezi (yaklaşık)');
      }

      const list = document.createElement('div');
      list.className = 'cluster-list';

      // Ciroya göre azalan: en değerli müşteri listenin başında.
      for (const point of [...rows].sort((a, b) => b.revenueTry - a.revenueTry)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'cluster-item';

        const name = document.createElement('span');
        name.className = 'cluster-item-name';
        name.textContent = point.name;

        const badge = document.createElement('span');
        badge.className = 'cluster-item-type';
        badge.textContent = point.type;
        badge.style.color = pinColor(point.type);
        badge.style.borderColor = pinColor(point.type);

        const head = document.createElement('span');
        head.className = 'cluster-item-head';
        head.append(name, badge);

        const meta = document.createElement('span');
        meta.className = 'cluster-item-meta';
        meta.textContent =
          `${point.dealCount} fırsat · ${formatTry(point.revenueTry)}` +
          (point.tenderCount > 0 ? ` · ${point.tenderCount} ihale` : '');

        item.append(head, meta);
        item.addEventListener('click', () => openCompany(point.id));
        list.appendChild(item);
      }

      wrapper.appendChild(list);
      return wrapper;
    };

    for (const rows of groups.values()) {
      const first = rows[0];
      if (!first) continue;

      // Küme boyutu adet sayısıyla büyür ama üst sınırı vardır.
      const size = rows.length === 1 ? 22 : Math.min(46, 26 + rows.length * 2);
      // Baskın tip kümenin rengini belirler.
      const typeCounts = new Map<string, number>();
      for (const p of rows) typeCounts.set(p.type, (typeCounts.get(p.type) ?? 0) + 1);
      const dominant = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'OTHER';

      const icon = L.divIcon({
        className: '',
        html:
          `<div class="cluster-marker" style="width:${size}px;height:${size}px;` +
          `background:${pinColor(dominant)};font-size:${size > 36 ? 14 : 12}px">` +
          `${rows.length > 1 ? rows.length : ''}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([first.latitude, first.longitude], { icon });
      marker.bindPopup(groupPopup(rows), { minWidth: 268, maxWidth: 330 });
      marker.bindTooltip(
        rows.length === 1
          ? `${first.name} · ${first.country}`
          : `${rows.length} kurum — ${first.cityName ?? first.country}`,
        { direction: 'top', offset: [0, -size / 2] },
      );
      marker.addTo(markers);
    }

    // İlk dolu veri gelişinde kadrajı otomatik ayarla: kayıtlar yalnızca
    // yurt dışındaysa kullanıcı boş bir Türkiye haritasıyla karşılaşmasın.
    if (!didAutoFit.current && filtered.length > 0) {
      didAutoFit.current = true;
      fitToData(filtered);
    }
  }, [filtered, navigate, fitToData]);

  const totalRevenue = useMemo(
    () => filtered.reduce((sum, point) => sum + point.revenueTry, 0),
    [filtered],
  );

  const countryCount = useMemo(
    () => new Set(filtered.map((point) => point.countryCode)).size,
    [filtered],
  );

  return (
    <div className="map-shell">
      <div className="map-canvas" ref={containerRef} />

      <div className={`map-filter${filtersOpen ? '' : ' is-collapsed'}`}>
        <button
          type="button"
          className="map-filter-toggle"
          onClick={() => setFiltersOpen(!filtersOpen)}
          aria-expanded={filtersOpen}
          aria-label={filtersOpen ? 'Filtre panelini daralt' : 'Filtre panelini aç'}
          title={filtersOpen ? 'Daralt' : 'Filtreler'}
        >
          {filtersOpen ? <IconChevronDown size={15} /> : <IconChevronLeft size={15} />}
          {!filtersOpen && <span className="map-filter-toggle-label">Filtre</span>}
        </button>

        <div className="map-filter-body">
        <div className="map-filter-title">Müşteri Tipi</div>
        <div className="flex gap-1 flex-wrap mb-3">
          {TYPE_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`map-filter-btn${typeFilter === item.key ? ' active' : ''}`}
              style={{ width: 'auto', flex: '1 1 40%', textAlign: 'center' }}
              onClick={() => setTypeFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="map-filter-title">Kapsam</div>
        <div className="flex gap-1 flex-wrap mb-3">
          {SCOPE_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`map-filter-btn${scopeFilter === item.key ? ' active' : ''}`}
              style={{ width: 'auto', flex: '1 1 40%', textAlign: 'center' }}
              onClick={() => setScopeFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="map-filter-title">Ek Filtre</div>
        <label className="checkbox-row text-xs mb-1">
          <input
            type="checkbox"
            checked={onlyTenders}
            onChange={(event) => setOnlyTenders(event.target.checked)}
          />
          <span>Yalnızca ihalesi olanlar</span>
        </label>
        <label className="checkbox-row text-xs">
          <input
            type="checkbox"
            checked={onlyRecent}
            onChange={(event) => setOnlyRecent(event.target.checked)}
          />
          <span>Son 30 günde eklenen</span>
        </label>

        <div
          className="text-xs text-muted mt-2"
          style={{ borderTop: '1px solid var(--border)', paddingTop: 7 }}
        >
          {loading ? (
            <span className="flex items-center gap-2"><span className="spinner" /> Yükleniyor…</span>
          ) : (
            <>
              <div>{filtered.length} kurum · {countryCount} ülke</div>
              <div>{formatTry(totalRevenue)} ciro</div>
              {points.length > 0 && filtered.length === 0 && (
                <div className="text-danger mt-1">Bu filtreyle eşleşen kayıt yok.</div>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          className="btn btn-sm w-full mt-2"
          onClick={() => fitToData(filtered)}
          disabled={filtered.length === 0}
        >
          <IconMap size={13} /> Verilere Sığdır
        </button>

        <button
          type="button"
          className="btn btn-sm w-full mt-1"
          onClick={() => mapRef.current?.setView(TURKEY_CENTER, TURKEY_ZOOM)}
        >
          Türkiye'ye Dön
        </button>

        <button
          type="button"
          className="btn btn-sm w-full mt-1"
          onClick={() => void load()}
          disabled={loading}
        >
          <IconRefresh size={13} /> Yenile
        </button>
        </div>
      </div>

      <div className="map-legend">
        <div className="font-semibold">Satış Yoğunluğu</div>
        <div className="map-legend-bar" />
        <div className="map-legend-scale">
          <span>Düşük</span>
          <span>Yüksek</span>
        </div>
      </div>

      {error && (
        <div
          className="alert alert-danger"
          style={{ position: 'absolute', bottom: 14, right: 14, zIndex: 500, margin: 0, maxWidth: 320 }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
