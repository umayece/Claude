import { prisma } from '../lib/prisma';
import { getRateMap, toTryAt } from './currency.service';

/**
 * Yerel kural tabanlı yanıt motoru.
 *
 * AI sağlayıcı anahtarı tanımlı değilken devreye girer. Önceki sürüm
 * yalnızca girdi bağlamını geri yazıyordu ve bu "anlamsız metin" olarak
 * görünüyordu. Bu motor artık SORUYU SINIFLANDIRIR ve yanıtı doğrudan
 * veritabanından üretir — dışarıya hiçbir veri gönderilmez.
 *
 * Kasıtlı olarak basit: anahtar kelime eşleşmesi. Bir niyet tanınmazsa
 * bunu açıkça söyler ve neleri yanıtlayabildiğini listeler; uydurma
 * yapmaz.
 */

export interface AnswerScope {
  userId: string;
  /** Kullanıcının erişebildiği şirketleri sınırlayan Prisma koşulu. */
  companyWhere: Record<string, unknown>;
}

type Intent =
  | 'WEEK_EVENTS' | 'DEAL_TOTALS' | 'OVERDUE_TASKS' | 'TENDER_DEADLINES'
  | 'LOW_STOCK' | 'EXCHANGE_RATES' | 'COMPANY_STATS' | 'UPCOMING_VISITS'
  | 'LOSS_ANALYSIS' | 'BIGGEST_BUSINESS' | 'FOREIGN_MARKETS'
  | 'DELIVERY_STATUS' | 'EXPORT_LICENCE' | 'OVERVIEW' | 'UNKNOWN';

// Sıra ÖNEMLİDİR: ilk eşleşen kazanır. Daha dar niyetler (en büyük iş,
// termin, ihracat izni) genel niyetlerden (fırsat, ciro) ÖNCE gelir;
// aksi halde "en büyük iş kimle" sorusu 'DEAL_TOTALS'a düşerdi.
const INTENT_KEYWORDS: [Intent, string[]][] = [
  ['BIGGEST_BUSINESS', [
    'en büyük iş', 'en buyuk is', 'en büyük satış', 'en yüksek cirolu',
    'en yüksek tutarlı', 'en büyük sözleşme', 'en büyük müşteri',
    'en karlı', 'en kârlı', 'kiminle en', 'en büyük anlaşma',
  ]],
  ['DELIVERY_STATUS', [
    'termin', 'teslimat', 'geciken teslim', 'yaklaşan teslim',
    'ne zaman teslim', 'sevkiyat tarihi',
  ]],
  ['EXPORT_LICENCE', [
    'ihracat izni', 'ihracat lisans', 'euc', 'son kullanıcı belgesi',
    'msb izni', 'ssb izni', 'sevkiyat izni', 'lisans durumu',
  ]],
  ['FOREIGN_MARKETS', [
    'hangi ülke', 'yurtdışı', 'yurt dışı', 'yabancı müşteri',
    'ihracat pazar', 'uluslararası müşteri', 'hangi ülkeler',
  ]],
  ['WEEK_EVENTS', ['bu hafta', 'haftaki', 'takvim', 'etkinlik', 'ajanda', 'program']],
  ['OVERDUE_TASKS', ['gecikmiş', 'geciken', 'geciktir', 'bekleyen görev', 'açık görev']],
  ['TENDER_DEADLINES', ['ihale', 'teslim tarihi', 'son teklif', 'şartname']],
  ['LOW_STOCK', ['stok', 'kritik stok', 'envanter', 'depo']],
  ['EXCHANGE_RATES', ['kur', 'döviz', 'dolar', 'euro', 'tcmb']],
  ['LOSS_ANALYSIS', ['kayıp', 'kaybed', 'neden kaybet', 'başarısız']],
  ['UPCOMING_VISITS', ['ziyaret', 'heyet', 'ataşe', 'delegasyon', 'protokol']],
  ['DEAL_TOTALS', ['fırsat', 'anlaşma', 'pipeline', 'huni', 'satış tutar', 'ciro', 'toplam']],
  ['COMPANY_STATS', ['müşteri', 'şirket', 'kurum', 'firma', 'kaç tane']],
  ['OVERVIEW', ['özet', 'genel', 'durum', 'rapor', 'brifing']],
];

export function classifyIntent(question: string): Intent {
  const normalized = question.toLocaleLowerCase('tr');
  for (const [intent, keywords] of INTENT_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return intent;
  }
  return 'UNKNOWN';
}

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
}

function fmtTry(value: number): string {
  return `${Math.round(value).toLocaleString('tr-TR')} ₺`;
}

/** Sorunun yanıtını Markdown benzeri düz metin olarak üretir. */
export async function answerLocally(question: string, scope: AnswerScope): Promise<string> {
  const intent = classifyIntent(question);

  switch (intent) {
    case 'WEEK_EVENTS': return weekEvents(scope);
    case 'DEAL_TOTALS': return dealTotals(scope);
    case 'OVERDUE_TASKS': return overdueTasks(scope);
    case 'TENDER_DEADLINES': return tenderDeadlines(scope);
    case 'LOW_STOCK': return lowStock();
    case 'EXCHANGE_RATES': return exchangeRates();
    case 'COMPANY_STATS': return companyStats(scope);
    case 'UPCOMING_VISITS': return upcomingVisits();
    case 'LOSS_ANALYSIS': return lossAnalysis(scope);
    case 'BIGGEST_BUSINESS': return biggestBusiness(scope);
    case 'FOREIGN_MARKETS': return foreignMarkets(scope);
    case 'DELIVERY_STATUS': return deliveryStatus(scope);
    case 'EXPORT_LICENCE': return exportLicenceStatus(scope);
    case 'OVERVIEW': return overview(scope);
    default: return unknownIntent(question);
  }
}

function header(title: string): string {
  return `### ${title}\n\n`;
}

async function weekEvents(scope: AnswerScope): Promise<string> {
  const now = new Date();
  // Haftanın başı pazartesi kabul edilir.
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  const [tasks, tenders, visits] = await Promise.all([
    prisma.task.findMany({
      where: {
        deletedAt: null,
        dueDate: { gte: start, lt: end },
        OR: [{ company: scope.companyWhere }, { companyId: null, assignedUserId: scope.userId }],
      },
      include: { company: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 40,
    }),
    prisma.tender.findMany({
      where: { deletedAt: null, submissionDeadline: { gte: start, lt: end }, company: scope.companyWhere },
      include: { company: { select: { name: true } } },
      orderBy: { submissionDeadline: 'asc' },
      take: 20,
    }),
    prisma.protocolVisit.findMany({
      where: { deletedAt: null, startDate: { gte: start, lt: end } },
      orderBy: { startDate: 'asc' },
      take: 20,
    }),
  ]);

  let out = header(
    `Bu Hafta (${fmtDate(start)} – ${fmtDate(new Date(end.getTime() - 86_400_000))})`,
  );

  out += `**Görevler (${tasks.length})**\n`;
  out += tasks.length
    ? tasks.map((t) =>
        `- ${fmtDate(t.dueDate)}${t.isAllDay ? '' : ` ${t.startTime ?? ''}`} — ${t.title}` +
        `${t.company ? ` · ${t.company.name}` : ''} [${t.status}]`).join('\n')
    : '- Bu hafta planlanmış görev yok.';

  out += `\n\n**İhale Teslimleri (${tenders.length})**\n`;
  out += tenders.length
    ? tenders.map((t) =>
        `- ${fmtDate(t.submissionDeadline)} — ${t.tenderNumber} ${t.title} · ${t.company.name}`).join('\n')
    : '- Bu hafta teslim tarihi olan ihale yok.';

  out += `\n\n**Protokol / Heyet (${visits.length})**\n`;
  out += visits.length
    ? visits.map((v) => `- ${fmtDate(v.startDate)} — ${v.title} (${v.country}) [${v.status}]`).join('\n')
    : '- Bu hafta planlanmış ziyaret yok.';

  return out;
}

async function dealTotals(scope: AnswerScope): Promise<string> {
  const deals = await prisma.deal.findMany({
    where: { deletedAt: null, company: scope.companyWhere },
    select: { stage: true, amount: true, currency: true },
  });

  if (deals.length === 0) return `${header('Satış Fırsatları')}Kayıtlı fırsat bulunamadı.`;

  const rates = await getRateMap();
  const byStage = new Map<string, { count: number; total: number }>();
  for (const deal of deals) {
    const bucket = byStage.get(deal.stage) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += toTryAt(deal.amount, deal.currency, rates);
    byStage.set(deal.stage, bucket);
  }

  const won = byStage.get('Kazanıldı');
  const lost = byStage.get('Kaybedildi');
  const openTotal = [...byStage.entries()]
    .filter(([stage]) => stage !== 'Kazanıldı' && stage !== 'Kaybedildi')
    .reduce((sum, [, v]) => sum + v.total, 0);

  let out = header('Satış Fırsatları — Aşama Dağılımı');
  out += `Toplam **${deals.length}** fırsat kaydı.\n\n`;
  out += [...byStage.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([stage, v]) => `- **${stage}**: ${v.count} adet · ${fmtTry(v.total)}`)
    .join('\n');

  out += `\n\n**Açık fırsat hacmi:** ${fmtTry(openTotal)}`;
  if (won) out += `\n**Kazanılan:** ${won.count} adet · ${fmtTry(won.total)}`;
  if (won && lost && won.count + lost.count > 0) {
    out += `\n**Kazanma oranı:** %${Math.round((won.count / (won.count + lost.count)) * 100)}`;
  }
  out += "\n\n_Tutarlar GÜNCEL kurla TL'ye çevrilmiştir._";
  return out;
}

async function overdueTasks(scope: AnswerScope): Promise<string> {
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      dueDate: { lt: new Date() },
      status: { notIn: ['Tamamlandı', 'İptal'] },
      OR: [{ company: scope.companyWhere }, { companyId: null, assignedUserId: scope.userId }],
    },
    include: { company: { select: { name: true } }, assignedUser: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
    take: 40,
  });

  if (tasks.length === 0) return `${header('Gecikmiş Görevler')}Gecikmiş görev yok. ✅`;

  let out = header(`Gecikmiş Görevler (${tasks.length})`);
  out += tasks.map((t) => {
    const days = Math.floor((Date.now() - (t.dueDate?.getTime() ?? Date.now())) / 86_400_000);
    return `- **${days} gün** — ${t.title}${t.company ? ` · ${t.company.name}` : ''}` +
      `${t.assignedUser ? ` (${t.assignedUser.name})` : ''} [${t.priority}]`;
  }).join('\n');

  return out;
}

async function tenderDeadlines(scope: AnswerScope): Promise<string> {
  const tenders = await prisma.tender.findMany({
    where: {
      deletedAt: null,
      company: scope.companyWhere,
      status: { notIn: ['Kazanıldı', 'Kaybedildi', 'İptal'] },
    },
    include: { company: { select: { name: true, country: true } } },
    orderBy: { submissionDeadline: 'asc' },
    take: 30,
  });

  if (tenders.length === 0) return `${header('İhaleler')}Açık ihale kaydı yok.`;

  let out = header(`Açık İhaleler (${tenders.length})`);
  out += tenders.map((t) => {
    const days = t.submissionDeadline
      ? Math.ceil((t.submissionDeadline.getTime() - Date.now()) / 86_400_000)
      : null;
    const deadline = days === null ? 'tarih yok'
      : days < 0 ? `${Math.abs(days)} gün GEÇTİ`
      : `${days} gün kaldı`;
    return `- ${t.tenderNumber} — ${t.title}\n  · ${t.company.name} (${t.company.country})` +
      ` · ${t.status} · **${deadline}**` +
      `${t.specificationText ? ' · şartname yüklü' : ' · şartname yok'}`;
  }).join('\n');

  return out;
}

async function lowStock(): Promise<string> {
  const products = await prisma.product.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { stockQuantity: 'asc' },
    take: 200,
  });

  const critical = products.filter((p) => p.stockQuantity <= p.minStockLevel);

  let out = header('Stok Durumu');
  out += `Aktif ürün sayısı: **${products.length}**\n\n`;

  if (critical.length === 0) {
    out += 'Kritik seviyenin altında ürün yok. ✅';
  } else {
    out += `**Kritik stok (${critical.length})**\n`;
    out += critical.map((p) =>
      `- ${p.sku} — ${p.name}: ${p.stockQuantity.toLocaleString('tr-TR')} ${p.unit}` +
      ` (eşik: ${p.minStockLevel})`).join('\n');
  }

  return out;
}

async function exchangeRates(): Promise<string> {
  const rows = await prisma.exchangeRateCache.findMany({ orderBy: { code: 'asc' } });

  let out = header('Döviz Kurları');
  if (rows.length === 0) {
    return `${out}Önbellekte kur kaydı yok. Ayarlar → Döviz Kurları bölümünden elle giriş yapabilir veya TCMB senkronizasyonunu tetikleyebilirsiniz.`;
  }

  out += rows.map((r) =>
    `- **${r.code}**: ${r.rate.toFixed(4)} ₺ · kaynak: ${r.source} · ${r.updatedAt.toLocaleString('tr-TR')}`,
  ).join('\n');

  const oldest = rows.reduce((min, r) => (r.updatedAt < min ? r.updatedAt : min), rows[0]!.updatedAt);
  if (Date.now() - oldest.getTime() > 24 * 3_600_000) {
    out += '\n\n⚠️ Kurlar 24 saatten eski. TCMB\'ye erişilemiyorsa elle güncelleyin.';
  }

  return out;
}

async function companyStats(scope: AnswerScope): Promise<string> {
  const companies = await prisma.company.findMany({
    where: { deletedAt: null, ...scope.companyWhere },
    select: { type: true, status: true, country: true, countryCode: true },
  });

  if (companies.length === 0) return `${header('Müşteri Portföyü')}Kayıtlı kurum yok.`;

  const count = <T extends string>(key: (c: (typeof companies)[number]) => T) => {
    const map = new Map<T, number>();
    for (const c of companies) map.set(key(c), (map.get(key(c)) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };

  let out = header('Müşteri Portföyü');
  out += `Toplam **${companies.length}** kurum.\n\n`;
  out += '**Tipe göre**\n';
  out += count((c) => c.type).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  out += '\n\n**Aşamaya göre**\n';
  out += count((c) => c.status).map(([k, v]) => `- ${k}: ${v}`).join('\n');

  const domestic = companies.filter((c) => c.countryCode === 'TR').length;
  out += `\n\n**Kapsam**\n- Yurt içi: ${domestic}\n- Yurt dışı: ${companies.length - domestic}`;

  const byCountry = count((c) => c.country).filter(([k]) => k !== 'Türkiye').slice(0, 8);
  if (byCountry.length) {
    out += '\n\n**En çok kurum bulunan yurt dışı pazarlar**\n';
    out += byCountry.map(([k, v]) => `- ${k}: ${v}`).join('\n');
  }

  return out;
}

async function upcomingVisits(): Promise<string> {
  const visits = await prisma.protocolVisit.findMany({
    where: { deletedAt: null, startDate: { gte: new Date() } },
    include: {
      _count: { select: { participants: true, checklist: true, agenda: true } },
      host: { select: { name: true } },
    },
    orderBy: { startDate: 'asc' },
    take: 20,
  });

  if (visits.length === 0) return `${header('Protokol & Heyet')}Planlanmış ziyaret yok.`;

  let out = header(`Yaklaşan Ziyaretler (${visits.length})`);
  for (const visit of visits) {
    const pending = await prisma.visitChecklistItem.count({
      where: { visitId: visit.id, isDone: false },
    });
    out += `- **${fmtDate(visit.startDate)}** — ${visit.title}\n`;
    out += `  · ${visit.country} · ${visit.visitType} · ${visit.status}\n`;
    out += `  · ${visit._count.participants} katılımcı · ${visit._count.agenda} program maddesi`;
    out += pending > 0 ? ` · ⚠️ ${pending} açık kontrol maddesi\n` : ' · kontrol listesi tamam ✅\n';
  }

  return out;
}

async function lossAnalysis(scope: AnswerScope): Promise<string> {
  const rows = await prisma.deal.groupBy({
    by: ['lossReason'],
    where: {
      deletedAt: null,
      company: scope.companyWhere,
      stage: 'Kaybedildi',
      lossReason: { not: null },
    },
    _count: { _all: true },
  });

  if (rows.length === 0) return `${header('Kayıp Analizi')}Kayıp nedeni işaretlenmiş fırsat yok.`;

  const total = rows.reduce((sum, r) => sum + r._count._all, 0);

  let out = header(`Kayıp Nedenleri (${total} kayıp)`);
  out += rows
    .sort((a, b) => b._count._all - a._count._all)
    .map((r) => `- **${r.lossReason}**: ${r._count._all} (%${Math.round((r._count._all / total) * 100)})`)
    .join('\n');

  return out;
}

async function overview(scope: AnswerScope): Promise<string> {
  const [companies, deals, tenders, overdue, visits] = await Promise.all([
    prisma.company.count({ where: { deletedAt: null, ...scope.companyWhere } }),
    prisma.deal.findMany({
      where: { deletedAt: null, company: scope.companyWhere },
      select: { stage: true, amount: true, currency: true },
    }),
    prisma.tender.count({
      where: {
        deletedAt: null, company: scope.companyWhere,
        status: { notIn: ['Kazanıldı', 'Kaybedildi', 'İptal'] },
      },
    }),
    prisma.task.count({
      where: {
        deletedAt: null, dueDate: { lt: new Date() },
        status: { notIn: ['Tamamlandı', 'İptal'] },
        OR: [{ company: scope.companyWhere }, { companyId: null, assignedUserId: scope.userId }],
      },
    }),
    prisma.protocolVisit.count({ where: { deletedAt: null, startDate: { gte: new Date() } } }),
  ]);

  const rates = await getRateMap();
  const openValue = deals
    .filter((d) => d.stage !== 'Kazanıldı' && d.stage !== 'Kaybedildi')
    .reduce((sum, d) => sum + toTryAt(d.amount, d.currency, rates), 0);
  const wonValue = deals
    .filter((d) => d.stage === 'Kazanıldı')
    .reduce((sum, d) => sum + toTryAt(d.amount, d.currency, rates), 0);

  return [
    header('Genel Durum'),
    `- **Kurum sayısı:** ${companies}`,
    `- **Fırsat sayısı:** ${deals.length}`,
    `- **Açık fırsat hacmi:** ${fmtTry(openValue)}`,
    `- **Kazanılan iş hacmi:** ${fmtTry(wonValue)}`,
    `- **Açık ihale:** ${tenders}`,
    `- **Gecikmiş görev:** ${overdue}`,
    `- **Yaklaşan ziyaret:** ${visits}`,
    '',
    `_Güncel kur: 1 USD = ${rates.USD.toFixed(2)} ₺ · 1 EUR = ${rates.EUR.toFixed(2)} ₺_`,
  ].join('\n');
}

/**
 * "En büyük iş kimle?" — en yüksek tutarlı sözleşme ve fırsat.
 *
 * Karşılaştırma ANLIK kurla TL'ye çevrilerek yapılır; ham `amount`
 * sıralaması 100.000 TRY'yi 90.000 USD'nin üstüne koyardı ve yanıt
 * yanlış olurdu. Bu yüzden aday küme çekilip TL'ye çevrildikten sonra
 * sıralanıyor.
 */
async function biggestBusiness(scope: AnswerScope): Promise<string> {
  const rates = await getRateMap();
  const where = { deletedAt: null, company: scope.companyWhere };

  const [contracts, deals] = await Promise.all([
    prisma.contract.findMany({
      where,
      // Kur farkı sıralamayı değiştirebileceği için tek kayıt değil,
      // makul bir aday kümesi çekilir.
      take: 50,
      orderBy: { amount: 'desc' },
      select: {
        id: true, contractNumber: true, title: true, amount: true, currency: true,
        startDate: true, status: true, deliveryDate: true,
        company: { select: { id: true, name: true, country: true } },
      },
    }),
    prisma.deal.findMany({
      where: { ...where, stage: { notIn: ['Kaybedildi'] } },
      take: 50,
      orderBy: { amount: 'desc' },
      select: {
        id: true, title: true, amount: true, currency: true, stage: true,
        expectedCloseDate: true,
        company: { select: { id: true, name: true, country: true } },
      },
    }),
  ]);

  const rankedContracts = contracts
    .map((c) => ({ ...c, try: toTryAt(c.amount, c.currency, rates) }))
    .sort((a, b) => b.try - a.try);
  const rankedDeals = deals
    .map((d) => ({ ...d, try: toTryAt(d.amount, d.currency, rates) }))
    .sort((a, b) => b.try - a.try);

  const topContract = rankedContracts[0];
  const topDeal = rankedDeals[0];

  if (!topContract && !topDeal) {
    return `${header('En Büyük İş')}Sistemde henüz sözleşme veya fırsat kaydı yok.`;
  }

  let out = header('En Büyük İş');

  if (topContract) {
    out += `**Sözleşme.** Sistemdeki en yüksek tutarlı sözleşme `
      + `**${topContract.company?.name ?? 'bilinmeyen kurum'}** ile imzalanan `
      + `**${topContract.amount.toLocaleString('tr-TR')} ${topContract.currency}** `
      + `(≈ ${fmtTry(topContract.try)}) değerindeki sözleşmedir.\n`
      + `- Sözleşme No: ${topContract.contractNumber}\n`
      + `- Konu: ${topContract.title}\n`
      + `- Başlangıç: ${fmtDate(topContract.startDate)}\n`
      + `- Durum: ${topContract.status}\n`
      + `- Ülke: ${topContract.company?.country ?? '-'}\n`
      + (topContract.deliveryDate ? `- Termin: ${fmtDate(topContract.deliveryDate)}\n` : '')
      + '\n';
  }

  if (topDeal) {
    out += `**Fırsat.** En yüksek hacimli açık fırsat `
      + `**${topDeal.company?.name ?? 'bilinmeyen kurum'}** nezdindeki `
      + `**${topDeal.amount.toLocaleString('tr-TR')} ${topDeal.currency}** `
      + `(≈ ${fmtTry(topDeal.try)}) değerindeki "${topDeal.title}" kaydıdır.\n`
      + `- Aşama: ${topDeal.stage}\n`
      + `- Beklenen kapanış: ${fmtDate(topDeal.expectedCloseDate)}\n\n`;
  }

  if (rankedContracts.length > 1) {
    out += '**Takip eden sözleşmeler:**\n';
    for (const row of rankedContracts.slice(1, 5)) {
      out += `- ${row.company?.name ?? '-'} — ${fmtTry(row.try)} (${row.contractNumber})\n`;
    }
  }

  out += '\n_Tutarlar bugünkü kurla TL karşılığına çevrilerek sıralanmıştır._';
  return out;
}

/** Yurt dışı pazarlar: ülke bazında kurum sayısı ve hacim. */
async function foreignMarkets(scope: AnswerScope): Promise<string> {
  const rates = await getRateMap();

  const companies = await prisma.company.findMany({
    where: {
      AND: [
        { deletedAt: null },
        scope.companyWhere as never,
        { NOT: { countryCode: 'TR' } },
      ],
    },
    select: {
      id: true, name: true, country: true, countryCode: true, type: true,
      deals: {
        where: { deletedAt: null, stage: 'Kazanıldı' },
        select: { amount: true, currency: true },
      },
      contracts: {
        where: { deletedAt: null },
        select: { amount: true, currency: true },
      },
    },
    take: 500,
  });

  if (companies.length === 0) {
    return `${header('Yurt Dışı Pazarlar')}Sistemde Türkiye dışında kayıtlı kurum bulunmuyor.`;
  }

  const byCountry = new Map<string, { count: number; revenueTry: number; names: string[] }>();
  for (const company of companies) {
    const revenue = [...company.deals, ...company.contracts]
      .reduce((sum, row) => sum + toTryAt(row.amount, row.currency, rates), 0);
    const entry = byCountry.get(company.country)
      ?? { count: 0, revenueTry: 0, names: [] };
    entry.count += 1;
    entry.revenueTry += revenue;
    if (entry.names.length < 4) entry.names.push(company.name);
    byCountry.set(company.country, entry);
  }

  const ranked = [...byCountry.entries()].sort((a, b) => b[1].revenueTry - a[1].revenueTry);
  const totalTry = ranked.reduce((sum, [, v]) => sum + v.revenueTry, 0);

  let out = header('Yurt Dışı Pazarlar');
  out += `${companies.length} yabancı kurum, ${ranked.length} ülkede. `
    + `Toplam hacim ≈ ${fmtTry(totalTry)}.\n\n`;
  for (const [country, value] of ranked) {
    out += `**${country}** — ${value.count} kurum, ${fmtTry(value.revenueTry)}\n`
      + `  ${value.names.join(', ')}${value.count > value.names.length ? ' …' : ''}\n`;
  }
  out += '\n_Hacim, kazanılmış fırsatlar ve sözleşmelerin bugünkü kurla TL karşılığıdır._';
  return out;
}

/** Termin durumu: gecikmiş ve 30 gün içinde terminlenen siparişler. */
async function deliveryStatus(scope: AnswerScope): Promise<string> {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 30);

  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      company: scope.companyWhere,
      deliveredAt: null,
      status: { notIn: ['Feshedildi', 'Taslak'] },
      deliveryDate: { not: null, lte: horizon },
    },
    orderBy: { deliveryDate: 'asc' },
    take: 40,
    select: {
      contractNumber: true, title: true, deliveryDate: true,
      originalDeliveryDate: true,
      company: { select: { name: true } },
    },
  });

  if (contracts.length === 0) {
    return `${header('Termin Durumu')}Gecikmiş veya 30 gün içinde terminlenen sipariş yok.`;
  }

  const days = (d: Date): number => Math.round(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
      - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000,
  );

  const late = contracts.filter((c) => days(c.deliveryDate!) < 0);
  const soon = contracts.filter((c) => days(c.deliveryDate!) >= 0);

  let out = header('Termin Durumu');

  if (late.length > 0) {
    out += `**Gecikmiş (${late.length}):**\n`;
    for (const row of late) {
      const slip = row.originalDeliveryDate
        && row.originalDeliveryDate.getTime() !== row.deliveryDate!.getTime();
      out += `- ${row.company?.name ?? '-'} — ${row.contractNumber}: `
        + `${Math.abs(days(row.deliveryDate!))} gün gecikti `
        + `(termin ${fmtDate(row.deliveryDate)})`
        + (slip ? ` · ilk taahhüt ${fmtDate(row.originalDeliveryDate)}` : '')
        + '\n';
    }
    out += '\n';
  }

  if (soon.length > 0) {
    out += `**Yaklaşan (${soon.length}):**\n`;
    for (const row of soon) {
      out += `- ${row.company?.name ?? '-'} — ${row.contractNumber}: `
        + `${days(row.deliveryDate!)} gün kaldı (${fmtDate(row.deliveryDate)})\n`;
    }
  }

  return out;
}

/** İhracat izni ve Son Kullanıcı Belgesi durumu. */
async function exportLicenceStatus(scope: AnswerScope): Promise<string> {
  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      company: scope.companyWhere,
      status: { notIn: ['Feshedildi'] },
      NOT: { exportLicenceStatus: 'Gerekli Değil' },
    },
    orderBy: { exportLicenceExpiresAt: 'asc' },
    take: 60,
    select: {
      contractNumber: true, title: true,
      exportLicenceStatus: true, exportLicenceNumber: true,
      exportLicenceExpiresAt: true, eucStatus: true,
      company: { select: { name: true, country: true } },
    },
  });

  if (contracts.length === 0) {
    return `${header('İhracat İzinleri')}İzin takibi gereken sözleşme bulunmuyor.`;
  }

  const byStatus = new Map<string, typeof contracts>();
  for (const row of contracts) {
    const list = byStatus.get(row.exportLicenceStatus) ?? [];
    list.push(row);
    byStatus.set(row.exportLicenceStatus, list);
  }

  let out = header('İhracat İzinleri');
  out += `${contracts.length} sözleşmede izin takibi var.\n\n`;

  for (const [status, list] of byStatus) {
    out += `**${status} (${list.length}):**\n`;
    for (const row of list.slice(0, 8)) {
      out += `- ${row.company?.name ?? '-'} (${row.company?.country ?? '-'}) — `
        + `${row.contractNumber}`
        + (row.exportLicenceNumber ? ` · İzin No: ${row.exportLicenceNumber}` : '')
        + (row.exportLicenceExpiresAt ? ` · Geçerlilik: ${fmtDate(row.exportLicenceExpiresAt)}` : '')
        + ` · EUC: ${row.eucStatus}\n`;
    }
    if (list.length > 8) out += `  … ve ${list.length - 8} kayıt daha\n`;
    out += '\n';
  }

  return out;
}

function unknownIntent(question: string): string {
  return [
    header('Soruyu Yanıtlayamadım'),
    `"${question.slice(0, 160)}" sorusunu tanıyamadım.`,
    '',
    'Yerel motor çalışıyor (dışarıya veri gönderilmiyor) ve şu konuları yanıtlayabilir:',
    '',
    '- **Takvim:** "bu haftaki etkinlikler", "bu hafta programım ne?"',
    '- **Satış:** "toplam fırsatlar", "pipeline durumu", "açık fırsat hacmi"',
    '- **Görevler:** "gecikmiş görevler"',
    '- **İhaleler:** "açık ihaleler", "teslim tarihi yaklaşanlar"',
    '- **Stok:** "kritik stok", "envanter durumu"',
    '- **Kur:** "güncel döviz kurları"',
    '- **Portföy:** "kaç müşterimiz var", "şirket dağılımı"',
    '- **Protokol:** "yaklaşan heyet ziyaretleri"',
    '- **Analiz:** "kayıp nedenleri"',
    '- **En büyük iş:** "en büyük iş kimle", "en yüksek cirolu sözleşme"',
    '- **İhracat pazarları:** "hangi ülkelere satıyoruz", "yurt dışı müşteriler"',
    '- **Termin:** "geciken teslimatlar", "yaklaşan termin"',
    '- **İzinler:** "ihracat izni durumu", "EUC bekleyenler"',
    '- **Özet:** "genel durum"',
    '',
    'Serbest metin analizi için **Ayarlar → AI Sağlayıcı** bölümünden bir API anahtarı tanımlayın.',
  ].join('\n');
}
