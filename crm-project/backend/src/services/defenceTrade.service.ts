/**
 * Savunma sanayii dış ticaret sabitleri ve kuralları.
 *
 * Tek doğruluk kaynağı: Incoterms listesi, EUC ve ihracat izni durumları
 * hem Zod şemalarında hem de arayüz seçicilerinde buradan türer. İki yerde
 * ayrı ayrı yazılsaydı yazım farkı sessizce "geçersiz durum" üretirdi.
 */

/**
 * Incoterms 2020 teslim şekilleri.
 *
 * `sellerPaysFreight`: navlunu satıcı üstlenir mi? Teklif maliyetine
 * nakliyenin dahil olup olmadığını belirler — FOB ile CIF arasındaki fark
 * bir teklifte yüzde onları bulabilir.
 */
export const INCOTERMS = [
  { code: 'EXW', label: 'EXW — Ex Works (Fabrika Teslimi)', sellerPaysFreight: false },
  { code: 'FCA', label: 'FCA — Free Carrier (Taşıyıcıya Teslim)', sellerPaysFreight: false },
  { code: 'FAS', label: 'FAS — Free Alongside Ship (Gemi Doğrultusunda)', sellerPaysFreight: false },
  { code: 'FOB', label: 'FOB — Free On Board (Gemi Bordasında)', sellerPaysFreight: false },
  { code: 'CFR', label: 'CFR — Cost and Freight (Masraf ve Navlun)', sellerPaysFreight: true },
  { code: 'CIF', label: 'CIF — Cost, Insurance and Freight (Masraf, Sigorta, Navlun)', sellerPaysFreight: true },
  { code: 'CPT', label: 'CPT — Carriage Paid To (Taşıma Ödenmiş)', sellerPaysFreight: true },
  { code: 'CIP', label: 'CIP — Carriage and Insurance Paid To', sellerPaysFreight: true },
  { code: 'DAP', label: 'DAP — Delivered At Place (Belirlenen Yerde Teslim)', sellerPaysFreight: true },
  { code: 'DPU', label: 'DPU — Delivered at Place Unloaded (Boşaltılmış Teslim)', sellerPaysFreight: true },
  { code: 'DDP', label: 'DDP — Delivered Duty Paid (Gümrük Vergisi Ödenmiş)', sellerPaysFreight: true },
] as const;

export const INCOTERM_CODES = INCOTERMS.map((item) => item.code) as unknown as
  [string, ...string[]];

/** Son Kullanıcı Belgesi (End User Certificate) durumu. */
export const EUC_STATUSES = [
  'Gerekli Değil', 'Talep Edildi', 'Beklemede', 'Alındı', 'Reddedildi',
] as const;

/**
 * İhracat izni durumu.
 *
 * Savunma sanayii ihracatında sevkiyat, izin onaylanmadan BAŞLAYAMAZ;
 * bu alan sözleşmenin sevk edilebilirliğini belirleyen kapıdır.
 */
export const EXPORT_LICENCE_STATUSES = [
  'Gerekli Değil', 'Başvurulmadı', 'Başvuruldu', 'İnceleniyor',
  'Onaylandı', 'Reddedildi', 'Süresi Doldu',
] as const;

/** İzni veren makamlar. */
export const LICENCE_AUTHORITIES = [
  'MSB (Millî Savunma Bakanlığı)',
  'SSB (Savunma Sanayii Başkanlığı)',
  'Dışişleri Bakanlığı',
  'Ticaret Bakanlığı',
  'Diğer',
] as const;

/**
 * BM tehlike sınıfları (Sınıf 1 — patlayıcılar).
 *
 * Konteyner yükleme limitlerini, ayrıştırma kurallarını ve liman
 * kabulünü doğrudan belirler.
 */
export const UN_HAZARD_CLASSES = [
  { code: '1.1', label: '1.1 — Kütlesel patlama tehlikesi' },
  { code: '1.2', label: '1.2 — Parça saçma tehlikesi' },
  { code: '1.3', label: '1.3 — Yangın, hafif patlama/parça tehlikesi' },
  { code: '1.4', label: '1.4 — Önemli tehlike arz etmeyen' },
  { code: '1.5', label: '1.5 — Çok duyarsız, kütlesel patlama tehlikeli' },
  { code: '1.6', label: '1.6 — Aşırı duyarsız, kütlesel patlama tehlikesiz' },
] as const;

export type ExportReadiness = 'HAZIR' | 'BEKLIYOR' | 'ENGELLI' | 'GEREKSIZ';

export interface ExportGateInput {
  exportLicenceStatus: string;
  exportLicenceExpiresAt: Date | null;
  eucStatus: string;
}

export interface ExportGate {
  readiness: ExportReadiness;
  /** Kullanıcıya gösterilecek tek cümlelik gerekçe. */
  reason: string;
  /** İzin süresi dolmaya bu kadar gün kaldı (yoksa null). */
  licenceDaysLeft: number | null;
}

/**
 * Sevkiyat yapılabilir mi?
 *
 * Kural sırası önemlidir: REDDEDİLDİ ve SÜRESİ DOLDU her şeyin önüne geçer,
 * çünkü bu durumlarda sevkiyat hukuken mümkün değildir. EUC eksikliği
 * "bekliyor"dur — izin süreci devam edebilir.
 */
export function exportGate(input: ExportGateInput, now: Date = new Date()): ExportGate {
  const { exportLicenceStatus: licence, eucStatus: euc, exportLicenceExpiresAt } = input;

  const licenceDaysLeft = exportLicenceExpiresAt
    ? Math.round(
      (Date.UTC(
        exportLicenceExpiresAt.getFullYear(),
        exportLicenceExpiresAt.getMonth(),
        exportLicenceExpiresAt.getDate(),
      ) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000,
    )
    : null;

  if (licence === 'Gerekli Değil') {
    return { readiness: 'GEREKSIZ', reason: 'İhracat izni gerekmiyor.', licenceDaysLeft };
  }
  if (licence === 'Reddedildi') {
    return {
      readiness: 'ENGELLI',
      reason: 'İhracat izni reddedildi — sevkiyat yapılamaz.',
      licenceDaysLeft,
    };
  }
  if (licence === 'Süresi Doldu' || (licenceDaysLeft !== null && licenceDaysLeft < 0)) {
    return {
      readiness: 'ENGELLI',
      reason: 'İhracat izninin süresi doldu — yenilenmeden sevkiyat yapılamaz.',
      licenceDaysLeft,
    };
  }
  if (licence !== 'Onaylandı') {
    return {
      readiness: 'BEKLIYOR',
      reason: `İhracat izni henüz onaylanmadı (${licence}).`,
      licenceDaysLeft,
    };
  }
  if (euc === 'Talep Edildi' || euc === 'Beklemede') {
    return {
      readiness: 'BEKLIYOR',
      reason: 'Son Kullanıcı Belgesi bekleniyor.',
      licenceDaysLeft,
    };
  }
  if (euc === 'Reddedildi') {
    return {
      readiness: 'ENGELLI',
      reason: 'Son Kullanıcı Belgesi reddedildi — sevkiyat yapılamaz.',
      licenceDaysLeft,
    };
  }
  if (licenceDaysLeft !== null && licenceDaysLeft <= 30) {
    return {
      readiness: 'HAZIR',
      reason: `Sevkiyata hazır, ancak izin ${licenceDaysLeft} gün sonra doluyor.`,
      licenceDaysLeft,
    };
  }
  return { readiness: 'HAZIR', reason: 'Sevkiyata hazır.', licenceDaysLeft };
}
