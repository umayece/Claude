import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { IconAlert, IconBox, IconDownload } from './Icons';
import { printCorporateDocument } from '../utils/corporatePrint';
import type { Paginated, Product } from '../types';

/**
 * Koli / palet / konteyner hesaplayıcı.
 *
 * Hesap iki ayrı sınırı birlikte gözetir: HACİM ve AĞIRLIK. Mühimmat
 * sevkiyatında belirleyici olan genellikle ağırlıktır (konteyner hacmi
 * dolmadan yük sınırına ulaşılır); yalnızca hacme bakan bir hesap
 * gerçekte taşınamayacak bir plan üretir. Bu yüzden iki sonuçtan
 * BÜYÜK olanı gerekli konteyner sayısını belirler.
 */

interface ContainerSpec {
  code: string;
  label: string;
  /** Kullanılabilir iç hacim (m³) */
  volumeM3: number;
  /** Azami yük (kg) */
  payloadKg: number;
  /** Standart palet kapasitesi (Euro palet) */
  palletCapacity: number;
}

const CONTAINERS: ContainerSpec[] = [
  { code: '20FT', label: "20' Standart Konteyner", volumeM3: 33.2, payloadKg: 28_200, palletCapacity: 11 },
  { code: '40FT', label: "40' Standart Konteyner", volumeM3: 67.7, payloadKg: 26_700, palletCapacity: 24 },
  { code: '40HC', label: "40' High Cube Konteyner", volumeM3: 76.4, payloadKg: 26_500, palletCapacity: 24 },
];

// Euro palet: 120 x 80 cm, istifleme yüksekliği 180 cm kabul edilir.
const PALLET = { lengthCm: 120, widthCm: 80, maxHeightCm: 180, tareKg: 25 };

interface Row {
  key: string;
  productId: string | null;
  name: string;
  quantity: string;
  /** Bir sandıktaki birim adedi */
  caseQuantity: string;
  caseLengthCm: string;
  caseWidthCm: string;
  caseHeightCm: string;
  caseWeightKg: string;
  hazardClass: string | null;
  unNumber: string | null;
  /** Sandık başına M2A1 kutu adedi (0 = ara kutu yok). */
  cansPerCase: string;
  /** Birim başına net patlayıcı ağırlığı (gram). */
  neqGramsPerRound: string;
}

function emptyRow(index: number): Row {
  return {
    key: `row-${Date.now()}-${index}`,
    productId: null, name: '', quantity: '1000',
    caseQuantity: '1000', caseLengthCm: '40', caseWidthCm: '30',
    caseHeightCm: '25', caseWeightKg: '20', hazardClass: null,
    unNumber: null, cansPerCase: '0', neqGramsPerRound: '0',
  };
}

/**
 * Mühimmat ambalaj ön tanımları.
 *
 * DİKKAT: Bu değerler YAKLAŞIKTIR ve NATO standart ambalajları için tipik
 * büyüklükleri temsil eder. Gerçek sevkiyatta üreticinin teknik veri
 * sayfasındaki sandık ölçüsü ve brüt ağırlık esas alınmalıdır — ambalaj
 * lot, fitil ve paketleme tipine göre değişir. Ön tanım seçildikten sonra
 * tüm alanlar elle düzeltilebilir; hesap düzeltilmiş değerlerle yapılır.
 */
interface AmmoPreset {
  key: string;
  label: string;
  /** Bir sandıktaki fişek/mermi adedi */
  roundsPerCase: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Dolu sandığın brüt ağırlığı (kg) */
  grossWeightKg: number;
  hazardClass: string;
  /** BM madde numarası */
  unNumber: string;
  /**
   * Bir sandıktaki M2A1 tipi metal kutu adedi.
   *
   * Küçük çaplı mühimmat iki kademeli paketlenir: fişekler M2A1 metal
   * kutuya, kutular ahşap sandığa girer. Büyük çaplı mühimmatta ara kutu
   * yoktur; bu alan 0 bırakılır.
   */
  cansPerCase: number;
  /** Birim (fişek/mermi) başına net patlayıcı ağırlığı — gram. */
  neqGramsPerRound: number;
}

const AMMO_PRESETS: AmmoPreset[] = [
  {
    key: '9x19', label: '9x19 mm Tabanca',
    roundsPerCase: 2000, lengthCm: 40, widthCm: 30, heightCm: 24,
    grossWeightKg: 28, hazardClass: '1.4S',
    unNumber: 'UN0012', cansPerCase: 2, neqGramsPerRound: 0.35,
  },
  {
    key: '5.56x45', label: '5.56x45 mm NATO',
    roundsPerCase: 1600, lengthCm: 45, widthCm: 35, heightCm: 20,
    grossWeightKg: 30, hazardClass: '1.4S',
    unNumber: 'UN0012', cansPerCase: 2, neqGramsPerRound: 1.7,
  },
  {
    key: '7.62x51', label: '7.62x51 mm NATO',
    roundsPerCase: 800, lengthCm: 45, widthCm: 35, heightCm: 20,
    grossWeightKg: 30, hazardClass: '1.4S',
    unNumber: 'UN0012', cansPerCase: 2, neqGramsPerRound: 2.9,
  },
  {
    key: '7.62x39', label: '7.62x39 mm',
    roundsPerCase: 1440, lengthCm: 45, widthCm: 35, heightCm: 20,
    grossWeightKg: 30, hazardClass: '1.4S',
    unNumber: 'UN0012', cansPerCase: 2, neqGramsPerRound: 1.6,
  },
  {
    key: '12.7x99', label: '12.7x99 mm (.50 BMG)',
    roundsPerCase: 200, lengthCm: 60, widthCm: 36, heightCm: 26,
    grossWeightKg: 35, hazardClass: '1.4S',
    unNumber: 'UN0012', cansPerCase: 2, neqGramsPerRound: 15.0,
  },
  {
    key: '40mm', label: '40 mm Bombaatar',
    roundsPerCase: 48, lengthCm: 50, widthCm: 38, heightCm: 30,
    grossWeightKg: 32, hazardClass: '1.2E',
    unNumber: 'UN0006', cansPerCase: 0, neqGramsPerRound: 32.0,
  },
  {
    key: '81mm', label: '81 mm Havan',
    roundsPerCase: 6, lengthCm: 92, widthCm: 32, heightCm: 26,
    grossWeightKg: 42, hazardClass: '1.1D',
    unNumber: 'UN0009', cansPerCase: 0, neqGramsPerRound: 950.0,
  },
  {
    key: '120mm', label: '120 mm Havan',
    roundsPerCase: 2, lengthCm: 110, widthCm: 34, heightCm: 30,
    grossWeightKg: 46, hazardClass: '1.1D',
    unNumber: 'UN0009', cansPerCase: 0, neqGramsPerRound: 2400.0,
  },
  {
    key: '155mm', label: '155 mm Obüs',
    roundsPerCase: 2, lengthCm: 120, widthCm: 60, heightCm: 40,
    grossWeightKg: 110, hazardClass: '1.1D',
    unNumber: 'UN0009', cansPerCase: 0, neqGramsPerRound: 11300.0,
  },
];

export function LogisticsCalculator() {
  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<Row[]>([emptyRow(0)]);
  const [containerCode, setContainerCode] = useState('20FT');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.get<Paginated<Product>>(
          '/products', { pageSize: 200, isActive: true }, controller.signal,
        );
        setProducts(response.data);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError('Ürün kataloğu yüklenemedi; değerleri elle girebilirsiniz.');
      }
    })();
    return () => controller.abort();
  }, []);

  const productOptions: SelectOption[] = useMemo(
    () => products.map((product) => ({
      value: product.id,
      label: `${product.sku} — ${product.name}`,
      description: product.caseQuantity
        ? `${product.caseQuantity} ${product.unit} / sandık · ${product.caseWeightKg ?? '?'} kg`
        : 'Ambalaj bilgisi tanımsız',
    })),
    [products],
  );

  const update = (key: string, patch: Partial<Row>): void => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  /** Katalogdan seçim ambalaj alanlarını doldurur. */
  const applyProduct = (key: string, productId: string | null): void => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      update(key, { productId: null });
      return;
    }
    update(key, {
      productId,
      name: product.name,
      caseQuantity: product.caseQuantity ? String(product.caseQuantity) : '1',
      caseLengthCm: product.caseLengthCm ? String(product.caseLengthCm) : '40',
      caseWidthCm: product.caseWidthCm ? String(product.caseWidthCm) : '30',
      caseHeightCm: product.caseHeightCm ? String(product.caseHeightCm) : '25',
      caseWeightKg: product.caseWeightKg ? String(product.caseWeightKg) : '20',
      hazardClass: product.hazardClass ?? null,
      unNumber: product.unNumber ?? null,
      neqGramsPerRound: product.neqGrams ? String(product.neqGrams) : '0',
    });
  };

  /** Mühimmat ön tanımını satıra uygular; ürün seçimi sıfırlanır. */
  const applyPreset = (key: string, presetKey: string): void => {
    const preset = AMMO_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;
    update(key, {
      productId: null,
      name: preset.label,
      caseQuantity: String(preset.roundsPerCase),
      caseLengthCm: String(preset.lengthCm),
      caseWidthCm: String(preset.widthCm),
      caseHeightCm: String(preset.heightCm),
      caseWeightKg: String(preset.grossWeightKg),
      hazardClass: preset.hazardClass,
      unNumber: preset.unNumber,
      cansPerCase: String(preset.cansPerCase),
      neqGramsPerRound: String(preset.neqGramsPerRound),
    });
  };

  const container = CONTAINERS.find((c) => c.code === containerCode) ?? CONTAINERS[0]!;

  /**
   * Sevkiyat dökümünü kurumsal antetli A4 sayfasında yazdırır.
   *
   * Tarayıcının kendi yazdırma motoru kullanılır; PDF üretmek için ek bir
   * bağımlılık (Puppeteer ~300 MB) kurmak gerekmez. Kullanıcı yazdırma
   * penceresinden "PDF olarak kaydet" seçebilir.
   */
  const printDispatchSheet = (): void => {
    const lines = rows.filter((row) => (Number(row.quantity) || 0) > 0);

    printCorporateDocument({
      documentType: 'SEVKİYAT DÖKÜMÜ',
      documentNumber: `LOJ-${new Date().toISOString().slice(0, 10)}`,
      title: 'Mühimmat Ambalaj ve Konteyner Planı',
      classification: 'Hizmete Özel',
      sections: [
        {
          heading: 'Yük Kalemleri',
          table: {
            headers: ['Kalem', 'Miktar', 'Sandık', 'Adet/Sandık', 'Brüt (kg)', 'UN / Sınıf'],
            align: ['left', 'right', 'right', 'right', 'right', 'left'],
            rows: lines.map((row) => {
              const quantity = Number(row.quantity) || 0;
              const perCase = Number(row.caseQuantity) || 1;
              const cases = Math.ceil(quantity / perCase);
              return [
                row.name || '—',
                quantity.toLocaleString('tr-TR'),
                cases.toLocaleString('tr-TR'),
                perCase.toLocaleString('tr-TR'),
                Math.round(cases * (Number(row.caseWeightKg) || 0)).toLocaleString('tr-TR'),
                [row.unNumber, row.hazardClass].filter(Boolean).join(' / ') || '—',
              ];
            }),
          },
        },
        {
          heading: 'Ambalaj Özeti',
          rows: [
            ['Toplam sandık', result.totalCases.toLocaleString('tr-TR')],
            ...(result.totalCans > 0
              ? [['M2A1 metal kutu', result.totalCans.toLocaleString('tr-TR')] as [string, string]]
              : []),
            ['Palet (120×80 cm)', result.palletCount.toLocaleString('tr-TR')],
            ['Toplam hacim', `${result.totalVolumeM3.toFixed(2)} m³`],
            ['Net yük ağırlığı', `${Math.round(result.totalWeightKg).toLocaleString('tr-TR')} kg`],
            ['Palet darası', `${Math.round(result.palletTareKg).toLocaleString('tr-TR')} kg`],
            ['Brüt ağırlık', `${Math.round(result.grossWeightKg).toLocaleString('tr-TR')} kg`],
            ...(result.totalNeqKg > 0
              ? [['Net patlayıcı ağırlığı (NEQ)',
                `${result.totalNeqKg.toFixed(1)} kg`] as [string, string]]
              : []),
            ...(result.unNumbers.length > 0
              ? [['BM madde numarası', result.unNumbers.join(', ')] as [string, string]]
              : []),
            ...(result.hazards.length > 0
              ? [['Tehlike sınıfı', result.hazards.join(', ')] as [string, string]]
              : []),
          ],
        },
        {
          heading: 'Konteyner Planı',
          rows: [
            ['Konteyner tipi', container.label],
            ['Gereken konteyner', String(result.containersNeeded)],
            ['Belirleyici kısıt', result.limiting],
            ['Hacim doluluğu', `%${result.volumeFill.toFixed(1)}`],
            ['Ağırlık doluluğu', `%${result.weightFill.toFixed(1)}`],
            ['Hacme göre', `${result.byVolume} konteyner`],
            ['Ağırlığa göre', `${result.byWeight} konteyner`],
            ['Palet alanına göre', `${result.byPallet} konteyner`],
          ],
        },
        {
          heading: 'Açıklama',
          paragraphs: [
            'Ambalaj değerleri NATO standart ambalajı için yaklaşık kabul '
            + 'edilmiştir. Kesin sevkiyat planı üreticinin teknik veri '
            + 'sayfasındaki sandık ölçüsü ve brüt ağırlığa göre yapılmalıdır.',
            'Gereken konteyner sayısı hacim, ağırlık ve palet alanı '
            + 'kısıtlarından EN BÜYÜĞÜ esas alınarak bulunmuştur. Tehlikeli '
            + 'madde ayrıştırma (IMDG/ADR) kuralları bu hesaba dahil değildir.',
          ],
        },
      ],
      signatures: [
        { label: 'Hazırlayan' },
        { label: 'Lojistik Onayı' },
      ],
      footerNote: 'MKE A.Ş. — Bu döküm bilgi amaçlıdır, resmî sevk irsaliyesi yerine geçmez.',
    });
  };

  const result = useMemo(() => {
    let totalCases = 0;
    let totalVolumeM3 = 0;
    let totalWeightKg = 0;
    let totalCans = 0;
    let totalNeqKg = 0;
    const hazards = new Set<string>();
    const unNumbers = new Set<string>();

    for (const row of rows) {
      const quantity = Number(row.quantity) || 0;
      const perCase = Number(row.caseQuantity) || 0;
      if (quantity <= 0 || perCase <= 0) continue;

      // Kısmi sandık da bir sandık yer kaplar.
      const cases = Math.ceil(quantity / perCase);
      const caseVolumeM3 =
        ((Number(row.caseLengthCm) || 0) *
         (Number(row.caseWidthCm) || 0) *
         (Number(row.caseHeightCm) || 0)) / 1_000_000;

      totalCases += cases;
      totalVolumeM3 += cases * caseVolumeM3;
      totalWeightKg += cases * (Number(row.caseWeightKg) || 0);
      totalCans += cases * (Number(row.cansPerCase) || 0);
      // NEQ sipariş ADEDİ üzerinden hesaplanır, sandık kapasitesi
      // üzerinden değil: kısmi sandık dolu sayılırsa patlayıcı ağırlığı
      // olduğundan fazla çıkar ve sevkiyat gereksiz yere sınıf atlar.
      totalNeqKg += (quantity * (Number(row.neqGramsPerRound) || 0)) / 1000;
      if (row.hazardClass) hazards.add(row.hazardClass);
      if (row.unNumber) unNumbers.add(row.unNumber);
    }

    // Palet: taban alanına kaç sandık sığdığı × istif kat sayısı.
    let palletCount = 0;
    for (const row of rows) {
      const quantity = Number(row.quantity) || 0;
      const perCase = Number(row.caseQuantity) || 0;
      const length = Number(row.caseLengthCm) || 0;
      const width = Number(row.caseWidthCm) || 0;
      const height = Number(row.caseHeightCm) || 0;
      if (quantity <= 0 || perCase <= 0 || length <= 0 || width <= 0 || height <= 0) continue;

      const cases = Math.ceil(quantity / perCase);
      // Sandığı iki yönde de deneyip daha verimli yerleşimi seçeriz.
      const perLayer = Math.max(
        Math.floor(PALLET.lengthCm / length) * Math.floor(PALLET.widthCm / width),
        Math.floor(PALLET.lengthCm / width) * Math.floor(PALLET.widthCm / length),
      );
      const layers = Math.floor(PALLET.maxHeightCm / height);
      const perPallet = Math.max(1, perLayer * layers);
      palletCount += Math.ceil(cases / perPallet);
    }

    const palletTareKg = palletCount * PALLET.tareKg;
    const grossWeightKg = totalWeightKg + palletTareKg;

    // İki sınır ayrı hesaplanır; belirleyici olan BÜYÜK olandır.
    const byVolume = totalVolumeM3 > 0 ? Math.ceil(totalVolumeM3 / container.volumeM3) : 0;
    const byWeight = grossWeightKg > 0 ? Math.ceil(grossWeightKg / container.payloadKg) : 0;
    const byPallet = palletCount > 0 ? Math.ceil(palletCount / container.palletCapacity) : 0;
    const containersNeeded = Math.max(byVolume, byWeight, byPallet);

    const limiting =
      containersNeeded === 0 ? 'yok'
        : byWeight >= byVolume && byWeight >= byPallet ? 'ağırlık'
        : byVolume >= byPallet ? 'hacim'
        : 'palet alanı';

    const volumeFill = containersNeeded > 0
      ? (totalVolumeM3 / (containersNeeded * container.volumeM3)) * 100 : 0;
    const weightFill = containersNeeded > 0
      ? (grossWeightKg / (containersNeeded * container.payloadKg)) * 100 : 0;

    return {
      totalCans,
      totalNeqKg,
      unNumbers: [...unNumbers],
      totalCases, totalVolumeM3, totalWeightKg, palletCount, palletTareKg,
      grossWeightKg, byVolume, byWeight, byPallet, containersNeeded, limiting,
      volumeFill, weightFill, hazards: [...hazards],
    };
  }, [rows, container]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2><IconBox size={17} /> Koli & Lojistik Hesaplayıcı</h2>
          <p className="text-sm text-muted" style={{ margin: '3px 0 0' }}>
            Sandık, palet ve konteyner ihtiyacını hacim ve ağırlık sınırlarını
            birlikte gözeterek hesaplar.
          </p>
        </div>

        <select
          className="select" style={{ width: 'auto' }}
          value={containerCode}
          onChange={(event) => setContainerCode(event.target.value)}
          aria-label="Konteyner tipi"
        >
          {CONTAINERS.map((option) => (
            <option key={option.code} value={option.code}>{option.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="alert alert-warning">{error}</div>}

      {rows.map((row, index) => (
        <div
          key={row.key}
          className="card"
          style={{ padding: 12, marginBottom: 10, background: 'var(--surface-alt)' }}
        >
          {/*
            Mühimmat tipi ön tanımı.

            Kullanıcı kalibre seçip sipariş adedini girdiğinde sandık
            adedi, brüt ağırlık ve hacim otomatik çıkar. Değerler
            yaklaşıktır; teknik veri sayfasına göre düzeltilebilir.
          */}
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="field-label">Mühimmat Tipi (hızlı seçim)</label>
            <select
              className="select"
              value=""
              onChange={(event) => {
                if (event.target.value) applyPreset(row.key, event.target.value);
              }}
              aria-label="Mühimmat tipi ön tanımı"
            >
              <option value="">Kalibre seçin (alanları doldurur)…</option>
              {AMMO_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label} — {preset.roundsPerCase} adet/sandık, {preset.grossWeightKg} kg
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">
              Değerler NATO standart ambalajı için yaklaşıktır; teknik veri
              sayfasına göre aşağıdan düzeltebilirsiniz.
            </span>
          </div>

          <div className="grid grid-2" style={{ gap: 0, columnGap: 12 }}>
            <div className="field" style={{ marginBottom: 10 }}>
              <label className="field-label">Ürün (katalogdan)</label>
              <SearchableSelect
                options={productOptions}
                value={row.productId}
                onChange={(value) => applyProduct(row.key, value)}
                placeholder="Ürün seçin veya elle girin…"
              />
            </div>

            <div className="field" style={{ marginBottom: 10 }}>
              <label className="field-label">Toplam Miktar (adet/kg)</label>
              <input
                className="input" type="number" min={0} value={row.quantity}
                onChange={(event) => update(row.key, { quantity: event.target.value })}
              />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr)) auto',
              gap: 10, alignItems: 'end',
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Sandık/Koli</label>
              <input
                className="input" type="number" min={1} value={row.caseQuantity}
                onChange={(event) => update(row.key, { caseQuantity: event.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Uzunluk cm</label>
              <input
                className="input" type="number" min={1} value={row.caseLengthCm}
                onChange={(event) => update(row.key, { caseLengthCm: event.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Genişlik cm</label>
              <input
                className="input" type="number" min={1} value={row.caseWidthCm}
                onChange={(event) => update(row.key, { caseWidthCm: event.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Yükseklik cm</label>
              <input
                className="input" type="number" min={1} value={row.caseHeightCm}
                onChange={(event) => update(row.key, { caseHeightCm: event.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Brüt kg</label>
              <input
                className="input" type="number" min={0} step="0.1" value={row.caseWeightKg}
                onChange={(event) => update(row.key, { caseWeightKg: event.target.value })}
              />
            </div>

            <button
              type="button" className="btn btn-ghost btn-icon"
              style={{ color: 'var(--danger)' }}
              aria-label="Satırı sil"
              disabled={rows.length === 1}
              onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
            >
              ✕
            </button>
          </div>

          {row.hazardClass && (
            <div className="text-xs mt-2" style={{ color: 'var(--danger)' }}>
              <IconAlert size={11} /> Tehlikeli madde sınıfı: <strong>{row.hazardClass}</strong>
            </div>
          )}

          <div className="text-xs text-muted mt-1">Kalem {index + 1}</div>
        </div>
      ))}

      <button
        type="button" className="btn btn-sm mb-4"
        onClick={() => setRows((prev) => [...prev, emptyRow(prev.length)])}
      >
        + Kalem Ekle
      </button>

      <h3 className="mb-2">Sonuç</h3>
      <div className="calc-result mb-3">
        <div className="calc-tile">
          <div className="calc-tile-label">Sandık / Koli</div>
          <div className="calc-tile-value">{result.totalCases.toLocaleString('tr-TR')}</div>
        </div>
        {result.totalCans > 0 && (
          <div className="calc-tile">
            <div className="calc-tile-label">M2A1 Kutu</div>
            <div className="calc-tile-value">{result.totalCans.toLocaleString('tr-TR')}</div>
            <div className="calc-tile-sub">metal kutu (sandık içi)</div>
          </div>
        )}
        <div className="calc-tile">
          <div className="calc-tile-label">Palet</div>
          <div className="calc-tile-value">{result.palletCount.toLocaleString('tr-TR')}</div>
          <div className="calc-tile-sub">120×80 cm, {PALLET.maxHeightCm} cm istif</div>
        </div>
        <div className="calc-tile">
          <div className="calc-tile-label">Hacim</div>
          <div className="calc-tile-value">{result.totalVolumeM3.toFixed(2)}</div>
          <div className="calc-tile-sub">m³</div>
        </div>
        <div className="calc-tile">
          <div className="calc-tile-label">Brüt Ağırlık</div>
          <div className="calc-tile-value">
            {Math.round(result.grossWeightKg).toLocaleString('tr-TR')}
          </div>
          <div className="calc-tile-sub">
            kg (palet darası {Math.round(result.palletTareKg)} kg dahil)
          </div>
        </div>
        {result.totalNeqKg > 0 && (
          <div className="calc-tile" style={{ borderColor: 'var(--danger)' }}>
            <div className="calc-tile-label">Net Patlayıcı (NEQ)</div>
            <div className="calc-tile-value" style={{ color: 'var(--danger)' }}>
              {result.totalNeqKg >= 1000
                ? `${(result.totalNeqKg / 1000).toFixed(2)} t`
                : `${result.totalNeqKg.toFixed(1)} kg`}
            </div>
            <div className="calc-tile-sub">
              {result.unNumbers.length > 0 ? result.unNumbers.join(', ') : 'UN sınıfı girilmedi'}
            </div>
          </div>
        )}
        <div className="calc-tile" style={{ borderColor: 'var(--mke-accent-dim)' }}>
          <div className="calc-tile-label">Konteyner</div>
          <div className="calc-tile-value" style={{ color: 'var(--mke-navy)' }}>
            {result.containersNeeded}
          </div>
          <div className="calc-tile-sub">{container.label}</div>
        </div>
      </div>

      {result.containersNeeded > 0 && (
        <>
          <div className="mb-2">
            <div className="flex items-center justify-between text-sm mb-1">
              <span>Hacim doluluğu</span>
              <strong>%{Math.round(result.volumeFill)}</strong>
            </div>
            <div className="container-bar">
              <div
                className="container-fill"
                style={{ width: `${Math.min(100, result.volumeFill)}%` }}
              />
              <div className="container-label">
                {result.totalVolumeM3.toFixed(1)} / {(result.containersNeeded * container.volumeM3).toFixed(1)} m³
              </div>
            </div>
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span>Ağırlık doluluğu</span>
              <strong>%{Math.round(result.weightFill)}</strong>
            </div>
            <div className="container-bar">
              <div
                className="container-fill"
                style={{ width: `${Math.min(100, result.weightFill)}%` }}
              />
              <div className="container-label">
                {Math.round(result.grossWeightKg).toLocaleString('tr-TR')} /{' '}
                {(result.containersNeeded * container.payloadKg).toLocaleString('tr-TR')} kg
              </div>
            </div>
          </div>

          <div className="alert alert-info">
            <IconAlert size={16} />
            <div>
              Belirleyici kısıt: <strong>{result.limiting}</strong>.
              {' '}Hacme göre {result.byVolume}, ağırlığa göre {result.byWeight},
              {' '}palet alanına göre {result.byPallet} konteyner gerekiyor;
              {' '}en büyüğü esas alındı.
            </div>
          </div>
        </>
      )}

      {result.totalCases > 0 && (
        <button
          type="button"
          className="btn btn-primary mt-3 mb-3"
          onClick={printDispatchSheet}
        >
          <IconDownload size={14} /> Sevkiyat Dökümü (PDF / Yazdır)
        </button>
      )}

      {result.hazards.length > 0 && (
        <div className="alert alert-warning">
          <IconAlert size={16} />
          <div>
            <strong>Tehlikeli madde sınıfı:</strong> {result.hazards.join(', ')}.
            {' '}IMDG/ADR ayrıştırma kuralları gereği bu yükler ayrı konteynerde
            taşınmak zorunda olabilir; hesap bunu dikkate almaz — nakliyeciye danışın.
          </div>
        </div>
      )}
    </div>
  );
}
