import { prisma } from '../lib/prisma';
import { getRateMap, toTry } from './currency.service';

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
  | 'LOSS_ANALYSIS' | 'OVERVIEW' | 'UNKNOWN';

const INTENT_KEYWORDS: [Intent, string[]][] = [
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
    select: { stage: true, amount: true, currency: true, exchangeRate: true },
  });

  if (deals.length === 0) return `${header('Satış Fırsatları')}Kayıtlı fırsat bulunamadı.`;

  const byStage = new Map<string, { count: number; total: number }>();
  for (const deal of deals) {
    const bucket = byStage.get(deal.stage) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += toTry(deal.amount, deal.exchangeRate);
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
  out += "\n\n_Tutarlar kayıt anındaki (donmuş) kurla TL'ye çevrilmiştir._";
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
      select: { stage: true, amount: true, exchangeRate: true },
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

  const openValue = deals
    .filter((d) => d.stage !== 'Kazanıldı' && d.stage !== 'Kaybedildi')
    .reduce((sum, d) => sum + toTry(d.amount, d.exchangeRate), 0);
  const wonValue = deals
    .filter((d) => d.stage === 'Kazanıldı')
    .reduce((sum, d) => sum + toTry(d.amount, d.exchangeRate), 0);

  const rates = await getRateMap();

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
    '- **Özet:** "genel durum"',
    '',
    'Serbest metin analizi için **Ayarlar → AI Sağlayıcı** bölümünden bir API anahtarı tanımlayın.',
  ].join('\n');
}
