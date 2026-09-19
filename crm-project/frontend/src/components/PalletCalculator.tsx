import { useMemo, useState } from 'react';
import { IconAlert, IconCopy, IconCheck, IconDownload, IconPallet } from './Icons';
import { printCorporateDocument } from '../utils/corporatePrint';

/**
 * Endüstriyel palet ve konteyner optimizasyon hesaplayıcısı.
 *
 * Mühimmat hesaplayıcısından (LogisticsCalculator) FARKLIDIR: orada girdi
 * kalibre ve fişek adedidir, burada ham koli ölçüsü ve ağırlığıdır. İkisi
 * ayrı tutuldu çünkü kullanıcı kitlesi ayrı: biri satış/ihracat ekibi,
 * diğeri sevkiyat planlama.
 */

interface PalletSpec {
  key: string;
  label: string;
  /** Taban ölçüsü (mm) */
  lengthMm: number;
  widthMm: number;
  /** Taşıma kapasitesi (kg) — palet darası hariç yük */
  capacityKg: number;
  /** Boş palet ağırlığı (kg) */
  tareKg: number;
  /** Yükleme yüksekliği üst sınırı (mm), palet tahtası dahil */
  maxHeightMm: number;
}

const PALLETS: PalletSpec[] = [
  {
    key: 'EPAL1', label: 'Euro Palet (EPAL 1)',
    lengthMm: 1200, widthMm: 800, capacityKg: 1500, tareKg: 25, maxHeightMm: 1800,
  },
  {
    key: 'NATO', label: 'NATO Standart Palet',
    lengthMm: 1200, widthMm: 1000, capacityKg: 2000, tareKg: 30, maxHeightMm: 1800,
  },
  {
    key: 'INDUSTRIAL', label: 'Sanayi / Endüstriyel Palet',
    lengthMm: 1200, widthMm: 1200, capacityKg: 1800, tareKg: 35, maxHeightMm: 2000,
  },
  {
    key: 'CUSTOM', label: 'Özel Ölçü / Serbest Giriş',
    lengthMm: 1200, widthMm: 800, capacityKg: 1000, tareKg: 25, maxHeightMm: 1800,
  },
];

interface ContainerSpec {
  code: string;
  label: string;
  volumeM3: number;
  payloadKg: number;
  /** Zemine sığan Euro palet sayısı (tek kat) */
  euroPallets: number;
  /** Zemine sığan 1200x1000 palet sayısı (tek kat) */
  isoPallets: number;
}

const CONTAINERS: ContainerSpec[] = [
  { code: '20FT', label: "20' Standart Konteyner", volumeM3: 33.2, payloadKg: 28_200, euroPallets: 11, isoPallets: 10 },
  { code: '40FT', label: "40' Standart Konteyner", volumeM3: 67.7, payloadKg: 26_700, euroPallets: 24, isoPallets: 21 },
  { code: '40HC', label: "40' High Cube Konteyner", volumeM3: 76.4, payloadKg: 26_500, euroPallets: 24, isoPallets: 21 },
];

export function PalletCalculator() {
  const [palletKey, setPalletKey] = useState('EPAL1');
  const [containerCode, setContainerCode] = useState('40FT');

  // Özel palet alanları
  const [customLength, setCustomLength] = useState('1200');
  const [customWidth, setCustomWidth] = useState('800');
  const [customCapacity, setCustomCapacity] = useState('1000');
  const [customHeight, setCustomHeight] = useState('1800');

  // Koli bilgisi
  const [boxLength, setBoxLength] = useState('400');
  const [boxWidth, setBoxWidth] = useState('300');
  const [boxHeight, setBoxHeight] = useState('250');
  const [boxWeight, setBoxWeight] = useState('20');
  const [boxCount, setBoxCount] = useState('500');
  /** İstiflemeye izin verilmeyen yükler tek kat kalır. */
  const [noStack, setNoStack] = useState(false);

  const [copied, setCopied] = useState(false);

  const pallet = useMemo<PalletSpec>(() => {
    const base = PALLETS.find((p) => p.key === palletKey) ?? PALLETS[0]!;
    if (base.key !== 'CUSTOM') return base;
    return {
      ...base,
      lengthMm: Number(customLength) || 1200,
      widthMm: Number(customWidth) || 800,
      capacityKg: Number(customCapacity) || 1000,
      maxHeightMm: Number(customHeight) || 1800,
    };
  }, [palletKey, customLength, customWidth, customCapacity, customHeight]);

  const container = CONTAINERS.find((c) => c.code === containerCode) ?? CONTAINERS[1]!;

  const result = useMemo(() => {
    const bl = Number(boxLength) || 0;
    const bw = Number(boxWidth) || 0;
    const bh = Number(boxHeight) || 0;
    const weight = Number(boxWeight) || 0;
    const count = Math.max(0, Math.trunc(Number(boxCount) || 0));

    if (bl <= 0 || bw <= 0 || bh <= 0 || count === 0) {
      return null;
    }

    // Koli palet tabanına sığıyor mu? İki yönelim de denenir ve daha
    // verimli yerleşim seçilir — kolinin uzun kenarını paletin uzun
    // kenarına dayamak her zaman en iyi sonucu vermez.
    const perLayerA = Math.floor(pallet.lengthMm / bl) * Math.floor(pallet.widthMm / bw);
    const perLayerB = Math.floor(pallet.lengthMm / bw) * Math.floor(pallet.widthMm / bl);
    const perLayer = Math.max(perLayerA, perLayerB);

    if (perLayer === 0) {
      return { oversized: true } as const;
    }

    // Kullanılabilir istif yüksekliği: palet tahtası (~144 mm) düşülür.
    const PALLET_DECK_MM = 144;
    const usableHeight = Math.max(0, pallet.maxHeightMm - PALLET_DECK_MM);
    const layersByHeight = Math.max(1, Math.floor(usableHeight / bh));

    // Ağırlık sınırı da kat sayısını kısıtlar: paletin taşıma kapasitesi
    // aşılırsa yığın fiziksel olarak mümkün olsa bile taşınamaz.
    const layersByWeight = weight > 0
      ? Math.max(1, Math.floor(pallet.capacityKg / (perLayer * weight)))
      : layersByHeight;

    const layers = noStack ? 1 : Math.min(layersByHeight, layersByWeight);
    const perPallet = perLayer * layers;

    const palletCount = Math.ceil(count / perPallet);
    const netWeightKg = count * weight;
    const tareKg = palletCount * pallet.tareKg;
    const grossWeightKg = netWeightKg + tareKg;

    const stackHeightMm = PALLET_DECK_MM + layers * bh;
    // Palet hacmi taban alanı × gerçek yığın yüksekliği.
    const palletVolumeM3 = (pallet.lengthMm / 1000) * (pallet.widthMm / 1000)
      * (stackHeightMm / 1000);
    const totalVolumeM3 = palletCount * palletVolumeM3;

    // Konteyner kapasitesi: zemin alanı paletin ölçüsüne göre seçilir.
    const floorSlots = pallet.widthMm >= 1000 ? container.isoPallets : container.euroPallets;
    // Yığın yüksekliği konteynerin yarısından azsa iki kat istiflenebilir.
    const CONTAINER_INNER_HEIGHT_MM = containerCode === '40HC' ? 2690 : 2390;
    const stackable = !noStack && stackHeightMm * 2 <= CONTAINER_INNER_HEIGHT_MM;
    const palletsPerContainer = floorSlots * (stackable ? 2 : 1);

    const byPallet = Math.ceil(palletCount / palletsPerContainer);
    const byWeight = Math.ceil(grossWeightKg / container.payloadKg);
    const byVolume = Math.ceil(totalVolumeM3 / container.volumeM3);
    const containersNeeded = Math.max(byPallet, byWeight, byVolume);

    const limiting = containersNeeded === 0 ? 'yok'
      : byWeight >= byPallet && byWeight >= byVolume ? 'ağırlık'
      : byPallet >= byVolume ? 'palet zemin alanı'
      : 'hacim';

    return {
      oversized: false as const,
      perLayer, layers, perPallet, palletCount,
      netWeightKg, tareKg, grossWeightKg,
      stackHeightMm, totalVolumeM3,
      palletsPerContainer, stackable,
      containersNeeded, byPallet, byWeight, byVolume, limiting,
      volumeFill: containersNeeded > 0
        ? (totalVolumeM3 / (containersNeeded * container.volumeM3)) * 100 : 0,
      weightFill: containersNeeded > 0
        ? (grossWeightKg / (containersNeeded * container.payloadKg)) * 100 : 0,
      layersByHeight, layersByWeight,
    };
  }, [
    boxLength, boxWidth, boxHeight, boxWeight, boxCount,
    pallet, container, containerCode, noStack,
  ]);

  /** Sonucu panoya düz metin olarak kopyalar. */
  const copySummary = async (): Promise<void> => {
    if (!result || result.oversized) return;
    const lines = [
      'PALET VE KONTEYNER PLANI',
      `Palet tipi: ${pallet.label} (${pallet.lengthMm}×${pallet.widthMm} mm, ${pallet.capacityKg} kg)`,
      `Koli: ${boxLength}×${boxWidth}×${boxHeight} mm · ${boxWeight} kg · ${boxCount} adet`,
      '',
      `Katman başına koli: ${result.perLayer}`,
      `Kat sayısı: ${result.layers}`,
      `Palet başına koli: ${result.perPallet}`,
      `Toplam palet: ${result.palletCount}`,
      `Yığın yüksekliği: ${result.stackHeightMm} mm`,
      `Net ağırlık: ${Math.round(result.netWeightKg).toLocaleString('tr-TR')} kg`,
      `Brüt ağırlık: ${Math.round(result.grossWeightKg).toLocaleString('tr-TR')} kg`
        + ` (${(result.grossWeightKg / 1000).toFixed(2)} ton)`,
      `Toplam hacim: ${result.totalVolumeM3.toFixed(2)} m³`,
      '',
      `Konteyner: ${container.label}`,
      `Gereken konteyner: ${result.containersNeeded}`,
      `Belirleyici kısıt: ${result.limiting}`,
      `Hacim doluluğu: %${result.volumeFill.toFixed(1)}`,
      `Ağırlık doluluğu: %${result.weightFill.toFixed(1)}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Pano izni yoksa sessizce geçilir; yazdırma seçeneği duruyor.
    }
  };

  const printSheet = (): void => {
    if (!result || result.oversized) return;
    printCorporateDocument({
      documentType: 'PALET PLANI',
      documentNumber: `PLT-${new Date().toISOString().slice(0, 10)}`,
      title: 'Palet ve Konteyner Optimizasyon Raporu',
      classification: 'Hizmete Özel',
      sections: [
        {
          heading: 'Girdi',
          rows: [
            ['Palet tipi', pallet.label],
            ['Palet ölçüsü', `${pallet.lengthMm} × ${pallet.widthMm} mm`],
            ['Palet kapasitesi', `${pallet.capacityKg.toLocaleString('tr-TR')} kg`],
            ['Koli ölçüsü', `${boxLength} × ${boxWidth} × ${boxHeight} mm`],
            ['Koli ağırlığı', `${boxWeight} kg`],
            ['Toplam koli', Number(boxCount).toLocaleString('tr-TR')],
            ['İstifleme', noStack ? 'Yasak (tek kat)' : 'Serbest'],
          ] as [string, string][],
        },
        {
          heading: 'Paletleme',
          rows: [
            ['Katman başına koli', String(result.perLayer)],
            ['Kat sayısı', String(result.layers)],
            ['Palet başına koli', String(result.perPallet)],
            ['Toplam palet', String(result.palletCount)],
            ['Yığın yüksekliği', `${result.stackHeightMm} mm`],
            ['Net ağırlık', `${Math.round(result.netWeightKg).toLocaleString('tr-TR')} kg`],
            ['Palet darası', `${Math.round(result.tareKg).toLocaleString('tr-TR')} kg`],
            ['Brüt ağırlık', `${Math.round(result.grossWeightKg).toLocaleString('tr-TR')} kg`
              + ` (${(result.grossWeightKg / 1000).toFixed(2)} ton)`],
            ['Toplam hacim', `${result.totalVolumeM3.toFixed(2)} m³`],
          ] as [string, string][],
        },
        {
          heading: 'Konteyner Planı',
          rows: [
            ['Konteyner tipi', container.label],
            ['Konteyner başına palet', String(result.palletsPerContainer)
              + (result.stackable ? ' (çift kat istif)' : ' (tek kat)')],
            ['Gereken konteyner', String(result.containersNeeded)],
            ['Belirleyici kısıt', result.limiting],
            ['Hacim doluluğu', `%${result.volumeFill.toFixed(1)}`],
            ['Ağırlık doluluğu', `%${result.weightFill.toFixed(1)}`],
          ] as [string, string][],
        },
      ],
      signatures: [{ label: 'Hazırlayan' }, { label: 'Sevkiyat Onayı' }],
      footerNote: 'MKE A.Ş. — Bu plan tahminîdir; kesin yükleme nakliyeci onayına tabidir.',
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IconPallet size={18} />
        <h3 style={{ margin: 0 }}>Palet ve Konteyner Optimizasyonu</h3>
      </div>

      <div className="grid grid-2" style={{ gap: 0, columnGap: 16 }}>
        <div className="field">
          <label className="field-label" htmlFor="pc-pallet">Palet Tipi</label>
          <select
            id="pc-pallet" className="select" value={palletKey}
            onChange={(event) => setPalletKey(event.target.value)}
          >
            {PALLETS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.key === 'CUSTOM'
                  ? option.label
                  : `${option.label} — ${option.lengthMm}×${option.widthMm} mm, ${option.capacityKg} kg`}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="pc-container">Konteyner Tipi</label>
          <select
            id="pc-container" className="select" value={containerCode}
            onChange={(event) => setContainerCode(event.target.value)}
          >
            {CONTAINERS.map((option) => (
              <option key={option.code} value={option.code}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      {palletKey === 'CUSTOM' && (
        <div className="grid grid-4" style={{ gap: 0, columnGap: 12 }}>
          <div className="field">
            <label className="field-label" htmlFor="pc-cl">Palet Boy (mm)</label>
            <input
              id="pc-cl" className="input" type="number" min={1} value={customLength}
              onChange={(event) => setCustomLength(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pc-cw">Palet En (mm)</label>
            <input
              id="pc-cw" className="input" type="number" min={1} value={customWidth}
              onChange={(event) => setCustomWidth(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pc-cc">Kapasite (kg)</label>
            <input
              id="pc-cc" className="input" type="number" min={1} value={customCapacity}
              onChange={(event) => setCustomCapacity(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pc-ch">Azami Yükseklik (mm)</label>
            <input
              id="pc-ch" className="input" type="number" min={1} value={customHeight}
              onChange={(event) => setCustomHeight(event.target.value)}
            />
          </div>
        </div>
      )}

      <h3 className="mb-2 mt-3">Koli Bilgisi</h3>

      <div className="grid grid-3" style={{ gap: 0, columnGap: 12 }}>
        <div className="field">
          <label className="field-label" htmlFor="pc-bl">Koli Boy (mm)</label>
          <input
            id="pc-bl" className="input" type="number" min={1} value={boxLength}
            onChange={(event) => setBoxLength(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pc-bw">Koli En (mm)</label>
          <input
            id="pc-bw" className="input" type="number" min={1} value={boxWidth}
            onChange={(event) => setBoxWidth(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pc-bh">Koli Yükseklik (mm)</label>
          <input
            id="pc-bh" className="input" type="number" min={1} value={boxHeight}
            onChange={(event) => setBoxHeight(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pc-bwt">Koli Ağırlığı (kg)</label>
          <input
            id="pc-bwt" className="input" type="number" min={0} step="0.1" value={boxWeight}
            onChange={(event) => setBoxWeight(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pc-bc">Toplam Koli / Sandık</label>
          <input
            id="pc-bc" className="input" type="number" min={0} value={boxCount}
            onChange={(event) => setBoxCount(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="checkbox-row" style={{ marginTop: 26 }}>
            <input
              type="checkbox" checked={noStack}
              onChange={(event) => setNoStack(event.target.checked)}
            />
            <span>İstifleme yasak (tek kat)</span>
          </label>
        </div>
      </div>

      {result === null && (
        <div className="alert alert-info">
          Koli ölçülerini ve adedini girin; palet ve konteyner planı anında hesaplanır.
        </div>
      )}

      {result?.oversized && (
        <div className="alert alert-danger">
          <IconAlert size={16} />
          <div>
            Koli seçilen palete <strong>sığmıyor</strong> ({boxLength}×{boxWidth} mm,
            palet {pallet.lengthMm}×{pallet.widthMm} mm). Daha büyük bir palet seçin
            veya koli ölçüsünü kontrol edin.
          </div>
        </div>
      )}

      {result && !result.oversized && (
        <>
          <h3 className="mb-2 mt-3">Sonuç</h3>

          <div className="calc-result mb-3">
            <div className="calc-tile">
              <div className="calc-tile-label">Katman Başına Koli</div>
              <div className="calc-tile-value">{result.perLayer}</div>
              <div className="calc-tile-sub">{result.layers} kat istif</div>
            </div>
            <div className="calc-tile">
              <div className="calc-tile-label">Palet Başına Koli</div>
              <div className="calc-tile-value">{result.perPallet}</div>
            </div>
            <div className="calc-tile" style={{ borderColor: 'var(--mke-gold)' }}>
              <div className="calc-tile-label">Toplam Palet</div>
              <div className="calc-tile-value" style={{ color: 'var(--mke-navy)' }}>
                {result.palletCount.toLocaleString('tr-TR')}
              </div>
              <div className="calc-tile-sub">{pallet.label}</div>
            </div>
            <div className="calc-tile">
              <div className="calc-tile-label">Yığın Yüksekliği</div>
              <div className="calc-tile-value">{result.stackHeightMm}</div>
              <div className="calc-tile-sub">mm (palet tahtası dahil)</div>
            </div>
            <div className="calc-tile">
              <div className="calc-tile-label">Brüt Tonaj</div>
              <div className="calc-tile-value">{(result.grossWeightKg / 1000).toFixed(2)}</div>
              <div className="calc-tile-sub">
                ton · net {Math.round(result.netWeightKg).toLocaleString('tr-TR')} kg
              </div>
            </div>
            <div className="calc-tile" style={{ borderColor: 'var(--mke-red)' }}>
              <div className="calc-tile-label">Konteyner</div>
              <div className="calc-tile-value" style={{ color: 'var(--mke-navy)' }}>
                {result.containersNeeded}
              </div>
              <div className="calc-tile-sub">{container.label}</div>
            </div>
          </div>

          <div className="mb-2">
            <div className="text-xs text-muted mb-1">
              Hacim doluluğu — {result.totalVolumeM3.toFixed(1)} m³
            </div>
            <div className="container-bar">
              <div
                className="container-fill"
                style={{ width: `${Math.min(100, result.volumeFill)}%` }}
              />
              <div className="container-label">%{result.volumeFill.toFixed(1)}</div>
            </div>
          </div>

          <div className="mb-3">
            <div className="text-xs text-muted mb-1">
              Ağırlık doluluğu — {Math.round(result.grossWeightKg).toLocaleString('tr-TR')} kg
            </div>
            <div className="container-bar">
              <div
                className="container-fill"
                style={{ width: `${Math.min(100, result.weightFill)}%` }}
              />
              <div className="container-label">%{result.weightFill.toFixed(1)}</div>
            </div>
          </div>

          <div className="alert alert-info">
            <IconAlert size={16} />
            <div>
              Belirleyici kısıt: <strong>{result.limiting}</strong>. Konteyner başına{' '}
              {result.palletsPerContainer} palet
              {result.stackable ? ' (çift kat istif)' : ' (tek kat)'}.
              {' '}Palet alanına göre {result.byPallet}, ağırlığa göre {result.byWeight},
              hacme göre {result.byVolume} konteyner gerekiyor; en büyüğü esas alındı.
              {result.layersByWeight < result.layersByHeight && !noStack && (
                <> Kat sayısını <strong>ağırlık</strong> sınırlıyor: yükseklik{' '}
                {result.layersByHeight} kata izin veriyor, palet kapasitesi{' '}
                {result.layersByWeight} kata.</>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button type="button" className="btn" onClick={() => void copySummary()}>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? ' Kopyalandı' : ' Özeti Kopyala'}
            </button>
            <button type="button" className="btn btn-primary" onClick={printSheet}>
              <IconDownload size={14} /> Palet Planı (PDF / Yazdır)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
