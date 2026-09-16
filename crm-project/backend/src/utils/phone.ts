/**
 * Türkiye odaklı telefon normalizasyonu.
 * Aramada yalnızca `normalizedNumber` kullanılır; görüntüleme ham `number` üzerinden yapılır.
 */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('90') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('0') && digits.length === 11) return `90${digits.slice(1)}`;
  if (digits.length === 10) return `90${digits}`;
  return digits;
}

/** 905321234567 -> +90 532 123 45 67 */
export function formatPhone(raw: string): string {
  const n = normalizePhone(raw);
  if (n.length === 12 && n.startsWith('90')) {
    return `+90 ${n.slice(2, 5)} ${n.slice(5, 8)} ${n.slice(8, 10)} ${n.slice(10, 12)}`;
  }
  return raw;
}

/** Kısmi arama için: kullanıcı "532 123" yazsa da eşleşsin. */
export function phoneSearchFragment(raw: string): string {
  return (raw ?? '').replace(/\D+/g, '');
}
