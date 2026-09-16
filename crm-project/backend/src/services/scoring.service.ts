/**
 * Kazanma olasılığı skoru (0-100).
 *
 * Kasıtlı olarak deterministik ve açıklanabilir: satış ekibinin skoru
 * savunabilmesi gerekir. Her bileşen ağırlığı sabittir ve toplam 100'ü aşmaz.
 */

const STAGE_WEIGHTS: Record<string, number> = {
  'Potansiyel': 10,
  'İletişime Geçildi': 20,
  'Teklif Hazırlanıyor': 35,
  'Teklif Verildi': 50,
  'Müzakere': 70,
  'Kazanıldı': 100,
  'Kaybedildi': 0,
};

export interface ScoreFactors {
  stage?: string | null;
  /** İhale/fırsat kapanışına kalan gün. Negatifse süre geçmiş. */
  daysToClose?: number | null;
  /** Şirketle geçmişte kazanılmış anlaşma sayısı. */
  wonDealCount?: number;
  /** Şirketle kaybedilmiş anlaşma sayısı. */
  lostDealCount?: number;
  /** Son 90 günde kaydedilen etkileşim sayısı. */
  recentActivityCount?: number;
  /** Tutar TL karşılığı — çok büyük işler istatistiksel olarak daha zordur. */
  amountTry?: number;
  hasOffer?: boolean;
  hasContact?: boolean;
}

export function calculateWinProbability(f: ScoreFactors): number {
  let score = STAGE_WEIGHTS[f.stage ?? 'Potansiyel'] ?? 10;

  if (f.stage === 'Kazanıldı') return 100;
  if (f.stage === 'Kaybedildi') return 0;

  const won = f.wonDealCount ?? 0;
  const lost = f.lostDealCount ?? 0;
  if (won + lost > 0) {
    const winRate = won / (won + lost);
    score += Math.round((winRate - 0.5) * 20); // -10 .. +10
  }

  const activity = f.recentActivityCount ?? 0;
  score += Math.min(10, Math.round(activity * 1.5));

  if (f.hasOffer) score += 6;
  if (f.hasContact) score += 4;

  const days = f.daysToClose;
  if (typeof days === 'number') {
    if (days < 0) score -= 15;          // teslim tarihi geçmiş
    else if (days <= 7) score += 5;     // yakın kapanış, süreç canlı
    else if (days > 180) score -= 8;    // çok uzak, belirsizlik yüksek
  }

  const amount = f.amountTry ?? 0;
  if (amount > 50_000_000) score -= 8;
  else if (amount > 10_000_000) score -= 4;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export const LOSS_REASONS = [
  'Yüksek Fiyat',
  'Şartname Uyumsuzluğu',
  'Teslimat Süresi',
  'Rakip Tercihi',
  'İhale İptali',
] as const;

export type LossReason = (typeof LOSS_REASONS)[number];
