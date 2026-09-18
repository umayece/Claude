/**
 * Termin (teslimat) takibi.
 *
 * Tek bir gerçek kaynağı: hem sözleşme detayı, hem kontrol paneli, hem de
 * bildirim zili aynı eşikleri ve aynı gecikme tanımını kullanır. Eşikler
 * iki yerde ayrı ayrı hesaplansaydı ekranlar birbirini tutmazdı.
 */

/** Kullanıcının uyarılmak istediği eşikler (gün). */
export const DELIVERY_REMINDER_DAYS = [30, 15, 7] as const;

export type DeliveryUrgency = 'GECIKTI' | 'BUGUN' | 'KRITIK' | 'YAKIN' | 'UZAK' | 'YOK';

export interface DeliveryInfo {
  deliveryDate: string | null;
  originalDeliveryDate: string | null;
  /** Bugünden termine kalan tam gün. Negatifse gecikme. */
  daysUntil: number | null;
  isOverdue: boolean;
  /** Teslim edilmiş siparişler hatırlatıcı üretmez. */
  isDelivered: boolean;
  /** Tetiklenen eşik (30/15/7) — hiçbiri değilse null. */
  reminderTier: number | null;
  urgency: DeliveryUrgency;
  /** Orijinal taahhüde göre kayma (gün). Revize edilmediyse 0. */
  slipDays: number;
}

/**
 * Gün farkını takvim günü olarak hesaplar.
 *
 * Saat bileşeni sıfırlanır: 23:00'te kaydedilen bir termin ile 01:00'de
 * kaydedilen bir termin aynı güne düşüyorsa "kalan gün" aynı olmalıdır.
 * Ham milisaniye farkı bölünseydi sonuç saate göre bir gün oynardı.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

export interface DeliveryInput {
  deliveryDate: Date | null;
  originalDeliveryDate?: Date | null;
  deliveredAt?: Date | null;
}

export function deliveryInfo(input: DeliveryInput, now: Date = new Date()): DeliveryInfo {
  const { deliveryDate, originalDeliveryDate = null, deliveredAt = null } = input;

  if (!deliveryDate) {
    return {
      deliveryDate: null,
      originalDeliveryDate: null,
      daysUntil: null,
      isOverdue: false,
      isDelivered: deliveredAt !== null,
      reminderTier: null,
      urgency: 'YOK',
      slipDays: 0,
    };
  }

  const daysUntil = calendarDaysBetween(now, deliveryDate);
  const isDelivered = deliveredAt !== null;
  const isOverdue = !isDelivered && daysUntil < 0;

  // En dar eşik kazanır: 7 günden az kalmışsa uyarı "7 gün" seviyesidir,
  // aynı anda 30 ve 15 eşiklerini de aşmış olmasına rağmen.
  const reminderTier = isDelivered || daysUntil < 0
    ? null
    : DELIVERY_REMINDER_DAYS.find(
      (threshold, index) => {
        const tighter = DELIVERY_REMINDER_DAYS[index + 1];
        return daysUntil <= threshold && (tighter === undefined || daysUntil > tighter);
      },
    ) ?? null;

  let urgency: DeliveryUrgency;
  if (isDelivered) urgency = 'YOK';
  else if (daysUntil < 0) urgency = 'GECIKTI';
  else if (daysUntil === 0) urgency = 'BUGUN';
  else if (daysUntil <= 7) urgency = 'KRITIK';
  else if (daysUntil <= 30) urgency = 'YAKIN';
  else urgency = 'UZAK';

  const slipDays = originalDeliveryDate
    ? calendarDaysBetween(originalDeliveryDate, deliveryDate)
    : 0;

  return {
    deliveryDate: deliveryDate.toISOString(),
    originalDeliveryDate: originalDeliveryDate?.toISOString() ?? null,
    daysUntil,
    isOverdue,
    isDelivered,
    reminderTier,
    urgency,
    slipDays,
  };
}

/**
 * Hatırlatıcı üretilmeli mi?
 *
 * Teslim edilmiş siparişler ve terminine 30 günden fazla olan siparişler
 * zile düşmez — aksi halde zil kalıcı olarak dolu kalır ve okunmaz hâle
 * gelir. Gecikmiş olanlar her zaman düşer.
 */
export function isDeliveryActionable(info: DeliveryInfo): boolean {
  if (info.isDelivered) return false;
  return info.isOverdue || info.reminderTier !== null || info.urgency === 'BUGUN';
}

/** Sorgu için: 30 gün içinde terminlenen veya gecikmiş sözleşmelerin tarih sınırı. */
export function deliveryWindowEnd(now: Date = new Date()): Date {
  const end = new Date(now);
  end.setDate(end.getDate() + Math.max(...DELIVERY_REMINDER_DAYS));
  end.setHours(23, 59, 59, 999);
  return end;
}
