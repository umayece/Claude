import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { MapPoint } from '../types';
import { HeatCanvasLayer, type HeatPoint } from './HeatCanvasLayer';
import { IconRefresh } from './Icons';

type FilterKey = 'ALL' | 'TENDERS' | 'B2G' | 'B2C' | 'RECENT';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'Tümü' },
  { key: 'TENDERS', label: 'İhaleler' },
  { key: 'B2G', label: 'B2G' },
  { key: 'B2C', label: 'B2C' },
  { key: 'RECENT', label: 'Son 30 Gün' },
];

// Türkiye odaklı başlangıç görünümü.
const TURKEY_CENTER: L.LatLngExpression = [39.0, 35.0];
const INITIAL_ZOOM = 6;

function formatTry(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} M ₺`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} B ₺`;
  return `${value.toLocaleString('tr-TR')} ₺`;
}

/** Kurum tipine göre pin rengi. */
function pinColor(type: string): string {
  switch (type) {
    case 'B2G': return '#4f46e5';
    case 'B2B': return '#0d9488';
    case 'B2C': return '#db2777';
    default: return '#64748b';
  }
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const heatRef = useRef<HeatCanvasLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const navigate = useNavigate();

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Harita örneğini bir kez kur ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: TURKEY_CENTER,
      zoom: INITIAL_ZOOM,
      // Sonsuz yatay tekrar kapalı: dünya sağa doğru kopyalanmaz.
      worldCopyJump: false,
      minZoom: 3,
      maxZoom: 16,
      zoomControl: true,
      attributionControl: true,
      // Kullanıcı dünya sınırlarının dışına kayamaz.
      maxBounds: L.latLngBounds([-85, -180], [85, 180]),
      maxBoundsViscosity: 1,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap katkıcıları &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
      // Döşemeler de tekrarlanmaz; harita tek bir dünya gösterir.
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
        { pageSize: 200 },
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

  // --- Filtre uygulaması (istemci tarafında; veri seti sınırlı) ---
  const filtered = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    switch (filter) {
      case 'TENDERS': return points.filter((p) => p.tenderCount > 0);
      case 'B2G': return points.filter((p) => p.type === 'B2G');
      case 'B2C': return points.filter((p) => p.type === 'B2C');
      case 'RECENT': return points.filter((p) => new Date(p.createdAt).getTime() >= cutoff);
      case 'ALL':
      default: return points;
    }
  }, [points, filter]);

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

    for (const point of filtered) {
      const color = pinColor(point.type);
      const marker = L.circleMarker([point.latitude, point.longitude], {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
      });

      // Popup içeriği DOM ile kurulur: innerHTML kullanmak, şirket adındaki
      // bir "<" karakterinin HTML olarak yorumlanmasına (XSS) kapı aralardı.
      const wrapper = document.createElement('div');

      const title = document.createElement('div');
      title.className = 'map-popup-title';
      title.textContent = point.name;
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

      addRow('Tip', point.type);
      addRow('Durum', point.status);
      if (point.cityName) addRow('Şehir', point.cityName);
      addRow('Satış Cirosu', formatTry(point.revenueTry));
      if (point.tenderCount > 0) addRow('Aktif İhale', String(point.tenderCount));
      if (point.coordinateSource === 'CITY') {
        addRow('Konum', 'Şehir merkezi (yaklaşık)');
      }

      const link = document.createElement('a');
      link.className = 'map-popup-link';
      link.href = `/companies/${point.id}`;
      link.textContent = 'Detaya Git →';
      link.addEventListener('click', (event) => {
        // SPA içinde kal: tam sayfa yenilemesi yapma.
        event.preventDefault();
        navigate(`/companies/${point.id}`);
      });
      wrapper.appendChild(link);

      marker.bindPopup(wrapper, { minWidth: 210 });
      marker.bindTooltip(point.name, { direction: 'top', offset: [0, -8] });
      marker.addTo(markers);
    }
  }, [filtered, navigate]);

  const totalRevenue = useMemo(
    () => filtered.reduce((sum, point) => sum + point.revenueTry, 0),
    [filtered],
  );

  return (
    <div className="map-shell">
      <div className="map-canvas" ref={containerRef} />

      <div className="map-filter">
        <div className="map-filter-title">Harita Filtresi</div>
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`map-filter-btn${filter === item.key ? ' active' : ''}`}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}

        <div
          className="text-xs text-muted mt-2"
          style={{ borderTop: '1px solid var(--border)', paddingTop: 7 }}
        >
          {loading ? (
            <span className="flex items-center gap-2"><span className="spinner" /> Yükleniyor…</span>
          ) : (
            <>
              <div>{filtered.length} kurum</div>
              <div>{formatTry(totalRevenue)} ciro</div>
            </>
          )}
        </div>

        <button
          type="button"
          className="btn btn-sm w-full mt-2"
          onClick={() => void load()}
          disabled={loading}
        >
          <IconRefresh size={13} /> Yenile
        </button>
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
