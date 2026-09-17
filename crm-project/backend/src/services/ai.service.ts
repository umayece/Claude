import Anthropic from '@anthropic-ai/sdk';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { BadRequest, NotFound } from '../lib/errors';
import { toTry } from './currency.service';
import { answerLocally, type AnswerScope } from './localAnswer.service';
import { getSetting, SETTING_KEYS } from './settings.service';

export const AI_TASKS = ['COMPANY_SUMMARY', 'TENDER_RISK', 'FREEFORM'] as const;
export type AiTaskKind = (typeof AI_TASKS)[number];

export interface AiRequest {
  task: AiTaskKind;
  /** COMPANY_SUMMARY için şirket, TENDER_RISK için ihale kimliği. */
  entityId?: string;
  /** FREEFORM görevlerde kullanıcı sorusu. */
  question?: string;
}

export interface AiPreparedPrompt {
  system: string;
  userMessage: string;
  /** Kullanıcıya gösterilecek başlık. */
  title: string;
  /** Modelin kullandığı bağlamın kaynak özeti (şeffaflık için). */
  contextSummary: string;
  /** Yerel motorun niyet sınıflandırması için ham kullanıcı sorusu. */
  rawQuestion?: string;
  /** Yerel motorun hangi görev için çalıştığı. */
  task: AiTaskKind;
}

const SYSTEM_BASE = [
  'Sen MKE A.Ş. bünyesinde çalışan bir kurumsal satış analistisin.',
  'Sana yalnızca CRM veritabanından çıkarılmış yapılandırılmış veriler verilir.',
  'Kurallar:',
  '- Yalnızca verilen veriye dayan. Veride olmayan bir rakam, tarih veya kişi uydurma.',
  '- Bir bilgi eksikse "veride yok" diye açıkça belirt.',
  '- Yanıtı Türkçe, madde işaretli ve kısa paragraflarla yaz.',
  '- Para birimlerini kayıtta göründüğü gibi koru; kendi kurunu uydurma.',
].join('\n');

const TASK_SYSTEM: Record<AiTaskKind, string> = {
  COMPANY_SUMMARY: [
    SYSTEM_BASE,
    '',
    'Görevin: şirketin CRM geçmişini yöneticiye 60 saniyede okunacak şekilde özetlemek.',
    'Şu başlıkları kullan: "Genel Durum", "Ticari Hacim", "Açık Süreçler", "Riskler ve Dikkat Noktaları", "Önerilen Sonraki Adım".',
  ].join('\n'),
  TENDER_RISK: [
    SYSTEM_BASE,
    '',
    'Görevin: ihale şartnamesi ve CRM verisinden risk analizi çıkarmak.',
    'Şu başlıkları kullan: "Özet Değerlendirme", "Teknik Riskler", "Ticari ve Finansal Riskler",',
    '"Takvim / Teslimat Riski", "Eksik Bilgiler", "Aksiyon Önerileri".',
    'Her riske [DÜŞÜK] / [ORTA] / [YÜKSEK] etiketi ver.',
  ].join('\n'),
  FREEFORM: [
    SYSTEM_BASE,
    '',
    'Görevin: kullanıcının CRM verisi hakkındaki sorusunu yanıtlamak.',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// Bağlam toplama — CRM'den modele gidecek veri burada sınırlandırılır.
// ---------------------------------------------------------------------------

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '-';
}

function fmtMoney(amount: number, currency: string): string {
  return `${amount.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${currency}`;
}

async function buildCompanyContext(companyId: string): Promise<AiPreparedPrompt> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    include: {
      city: { select: { name: true } },
      contacts: {
        where: { deletedAt: null },
        select: { firstName: true, lastName: true, title: true, departmentName: true },
        take: 20,
      },
      deals: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          title: true, stage: true, amount: true, currency: true, exchangeRate: true,
          expectedCloseDate: true, lossReason: true, winProbabilityScore: true,
        },
      },
      tenders: {
        where: { deletedAt: null },
        orderBy: { submissionDeadline: 'desc' },
        take: 15,
        select: {
          title: true, status: true, estimatedValue: true, currency: true,
          submissionDeadline: true, lossReason: true,
        },
      },
      contracts: {
        where: { deletedAt: null },
        orderBy: { startDate: 'desc' },
        take: 15,
        select: { title: true, status: true, amount: true, currency: true, startDate: true, endDate: true },
      },
      tickets: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { ticketNumber: true, title: true, status: true, priority: true, category: true, createdAt: true },
      },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { type: true, title: true, createdAt: true },
      },
    },
  });

  if (!company) throw NotFound('Şirket bulunamadı.');

  const totalTry = company.deals
    .filter((d) => d.stage === 'Kazanıldı')
    .reduce((sum, d) => sum + toTry(d.amount, d.exchangeRate), 0);

  const lines: string[] = [];
  lines.push('## ŞİRKET KÜNYESİ');
  lines.push(`Ad: ${company.name}`);
  lines.push(`Tip: ${company.type} | Durum: ${company.status} | Sektör: ${company.sector ?? '-'}`);
  lines.push(`Şehir: ${company.city?.name ?? '-'} | Web: ${company.website ?? '-'}`);
  lines.push(`CRM'e giriş: ${fmtDate(company.createdAt)}`);
  lines.push(`Kazanılmış işlerin TL karşılığı toplamı: ${fmtMoney(totalTry, 'TRY')}`);

  lines.push('', '## İLGİLİ KİŞİLER');
  lines.push(
    company.contacts.length
      ? company.contacts
          .map((c) => `- ${c.firstName} ${c.lastName}${c.title ? ` (${c.title})` : ''}${c.departmentName ? ` — ${c.departmentName}` : ''}`)
          .join('\n')
      : '- Kayıt yok',
  );

  lines.push('', '## SATIŞ FIRSATLARI');
  lines.push(
    company.deals.length
      ? company.deals
          .map((d) =>
            `- ${d.title} | Aşama: ${d.stage} | Tutar: ${fmtMoney(d.amount, d.currency)}` +
            ` | Beklenen kapanış: ${fmtDate(d.expectedCloseDate)}` +
            (d.winProbabilityScore !== null ? ` | Skor: ${d.winProbabilityScore}` : '') +
            (d.lossReason ? ` | Kayıp nedeni: ${d.lossReason}` : ''),
          )
          .join('\n')
      : '- Kayıt yok',
  );

  lines.push('', '## İHALELER');
  lines.push(
    company.tenders.length
      ? company.tenders
          .map((t) =>
            `- ${t.title} | Durum: ${t.status} | Yaklaşık bedel: ${fmtMoney(t.estimatedValue, t.currency)}` +
            ` | Son teslim: ${fmtDate(t.submissionDeadline)}` + (t.lossReason ? ` | Kayıp: ${t.lossReason}` : ''),
          )
          .join('\n')
      : '- Kayıt yok',
  );

  lines.push('', '## SÖZLEŞMELER');
  lines.push(
    company.contracts.length
      ? company.contracts
          .map((c) => `- ${c.title} | ${c.status} | ${fmtMoney(c.amount, c.currency)} | ${fmtDate(c.startDate)} → ${fmtDate(c.endDate)}`)
          .join('\n')
      : '- Kayıt yok',
  );

  lines.push('', '## DESTEK / GARANTİ TALEPLERİ');
  lines.push(
    company.tickets.length
      ? company.tickets
          .map((t) => `- [${t.ticketNumber}] ${t.title} | ${t.category} | ${t.status} | Öncelik: ${t.priority} | ${fmtDate(t.createdAt)}`)
          .join('\n')
      : '- Kayıt yok',
  );

  lines.push('', '## SON ETKİLEŞİMLER (en yeniden eskiye)');
  lines.push(
    company.activities.length
      ? company.activities.map((a) => `- ${fmtDate(a.createdAt)} [${a.type}] ${a.title}`).join('\n')
      : '- Kayıt yok',
  );

  return {
    system: TASK_SYSTEM.COMPANY_SUMMARY,
    userMessage: `Aşağıdaki CRM verisine dayanarak şirket geçmişi özeti çıkar.\n\n${lines.join('\n')}`,
    task: 'COMPANY_SUMMARY',
    title: `${company.name} — Şirket Geçmişi Özeti`,
    contextSummary:
      `${company.contacts.length} kişi, ${company.deals.length} fırsat, ${company.tenders.length} ihale, ` +
      `${company.contracts.length} sözleşme, ${company.tickets.length} destek kaydı, ${company.activities.length} etkileşim`,
  };
}

async function buildTenderContext(tenderId: string): Promise<AiPreparedPrompt> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, deletedAt: null },
    include: {
      company: { select: { name: true, type: true, sector: true, status: true } },
      contracts: { select: { title: true, status: true, amount: true, currency: true } },
      tasks: {
        where: { deletedAt: null },
        select: { title: true, status: true, dueDate: true },
        take: 20,
      },
    },
  });

  if (!tender) throw NotFound('İhale bulunamadı.');

  const history = await prisma.tender.findMany({
    where: { companyId: tender.companyId, deletedAt: null, id: { not: tender.id } },
    select: { title: true, status: true, lossReason: true, estimatedValue: true, currency: true },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });

  const daysLeft = tender.submissionDeadline
    ? Math.ceil((tender.submissionDeadline.getTime() - Date.now()) / 86_400_000)
    : null;

  const lines: string[] = [];
  lines.push('## İHALE KÜNYESİ');
  lines.push(`İhale No: ${tender.tenderNumber}`);
  lines.push(`Başlık: ${tender.title}`);
  lines.push(`İdare / Kurum: ${tender.company.name} (${tender.company.type}, ${tender.company.sector ?? 'sektör belirtilmemiş'})`);
  lines.push(`Durum: ${tender.status} | Usul: ${tender.method ?? '-'}`);
  lines.push(`Yaklaşık bedel: ${fmtMoney(tender.estimatedValue, tender.currency)}`);
  lines.push(`İlan: ${fmtDate(tender.announcementDate)} | Son teklif: ${fmtDate(tender.submissionDeadline)}` +
    (daysLeft !== null ? ` (kalan gün: ${daysLeft})` : ''));
  lines.push(`Açıklama: ${tender.description ?? '-'}`);

  lines.push('', '## ŞARTNAME METNİ');
  // Şartname çok uzun olabilir; bağlam penceresini taşırmamak için kırpılır
  // ve kırpıldığı kullanıcıya bildirilir (sessiz kesme yapılmaz).
  const MAX_SPEC_CHARS = 40_000;
  const spec = tender.specificationText ?? '';
  if (!spec) {
    lines.push('(Şartname metni CRM kaydına yüklenmemiş — analiz yalnızca künye verisine dayanır.)');
  } else if (spec.length > MAX_SPEC_CHARS) {
    lines.push(spec.slice(0, MAX_SPEC_CHARS));
    lines.push(`\n[UYARI: şartname ${spec.length} karakter; ilk ${MAX_SPEC_CHARS} karakter analiz edildi.]`);
  } else {
    lines.push(spec);
  }

  lines.push('', '## BU KURUMLA GEÇMİŞ İHALELER');
  lines.push(
    history.length
      ? history
          .map((h) => `- ${h.title} | ${h.status} | ${fmtMoney(h.estimatedValue, h.currency)}` + (h.lossReason ? ` | Kayıp: ${h.lossReason}` : ''))
          .join('\n')
      : '- Geçmiş ihale kaydı yok',
  );

  lines.push('', '## AÇIK GÖREVLER');
  lines.push(
    tender.tasks.length
      ? tender.tasks.map((t) => `- ${t.title} | ${t.status} | Termin: ${fmtDate(t.dueDate)}`).join('\n')
      : '- Görev kaydı yok',
  );

  return {
    system: TASK_SYSTEM.TENDER_RISK,
    userMessage: `Aşağıdaki ihale için risk analizi çıkar.\n\n${lines.join('\n')}`,
    task: 'TENDER_RISK',
    title: `${tender.tenderNumber} — Şartname Risk Analizi`,
    contextSummary:
      `${spec.length} karakter şartname, ${history.length} geçmiş ihale, ${tender.tasks.length} açık görev`,
  };
}

export async function preparePrompt(request: AiRequest): Promise<AiPreparedPrompt> {
  switch (request.task) {
    case 'COMPANY_SUMMARY':
      if (!request.entityId) throw BadRequest('COMPANY_SUMMARY için entityId (şirket kimliği) zorunludur.');
      return buildCompanyContext(request.entityId);
    case 'TENDER_RISK':
      if (!request.entityId) throw BadRequest('TENDER_RISK için entityId (ihale kimliği) zorunludur.');
      return buildTenderContext(request.entityId);
    case 'FREEFORM': {
      const question = request.question?.trim();
      if (!question) throw BadRequest('Soru metni boş olamaz.');
      if (question.length > 8000) throw BadRequest('Soru metni 8000 karakteri aşamaz.');
      return {
        system: TASK_SYSTEM.FREEFORM,
        userMessage: question,
        task: 'FREEFORM',
        rawQuestion: question,
        title: 'AI Asistan',
        contextSummary: 'serbest soru',
      };
    }
    default:
      throw BadRequest('Desteklenmeyen AI görevi.');
  }
}

// ---------------------------------------------------------------------------
// Üretim motoru
// ---------------------------------------------------------------------------

// Anahtar çalışma zamanında değişebildiği için istemci anahtara göre
// önbelleklenir; anahtar değişince yeni istemci kurulur.
let client: Anthropic | null = null;
let clientKey: string | null = null;

async function getClient(): Promise<Anthropic | null> {
  const apiKey = await getSetting(SETTING_KEYS.aiApiKey);
  if (!apiKey) {
    client = null;
    clientKey = null;
    return null;
  }
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

export async function isModelConfigured(): Promise<boolean> {
  return Boolean(await getSetting(SETTING_KEYS.aiApiKey));
}

export async function activeModel(): Promise<string> {
  return (await getSetting(SETTING_KEYS.aiModel)) || env.ai.model;
}

export interface AiStreamOptions {
  /** İstemci bağlantıyı kapattığında üretimi durdurmak için. */
  signal?: AbortSignal;
  /** Yerel motorun veritabanı sorgularını kullanıcı kapsamıyla sınırlar. */
  scope?: AnswerScope;
}

/**
 * Yanıtı token token üretir.
 *
 * ANTHROPIC_API_KEY tanımlı değilse hiçbir veri dışarı çıkmaz; yerine
 * aşağıdaki kural tabanlı yerel motor devreye girer. Böylece demo ve
 * kapalı ağ kurulumlarında modül işlevsiz kalmaz.
 */
export async function* streamCompletion(
  prompt: AiPreparedPrompt,
  options: AiStreamOptions = {},
): AsyncGenerator<string, void, void> {
  const anthropic = await getClient();

  if (!anthropic) {
    yield* localEngine(prompt, options.scope);
    return;
  }

  // NOT: `thinking` parametresi bilinçli olarak gönderilmiyor. Claude Opus 5
  // parametre verilmediğinde adaptif düşünmeyi zaten varsayılan olarak
  // çalıştırır; böylece SDK sürümleri arasında tip uyumsuzluğu riski olmaz.
  const model = await activeModel();

  const stream = anthropic.messages.stream(
    {
      model,
      // Özet/analiz çıktıları bilinçli olarak kısa tutulur; uzun bir rapor
      // değil, ekranda okunacak bir brifing üretiyoruz.
      max_tokens: 8000,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.userMessage }],
    },
    options.signal ? { signal: options.signal } : undefined,
  );

  try {
    for await (const event of stream) {
      if (options.signal?.aborted) break;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'max_tokens') {
      yield '\n\n_[Yanıt uzunluk sınırına ulaştığı için kesildi.]_';
    }
  } catch (error) {
    if (options.signal?.aborted) return;
    // Model hatası kullanıcı için akışın içinde görünür olmalı; sessizce
    // yarım kalan bir metin "tamamlandı" sanılır.
    const message = error instanceof Anthropic.APIError
      ? `AI servisi yanıt veremedi (HTTP ${error.status}).`
      : 'AI servisine ulaşılamadı.';
    console.error('[ai] akış hatası:', error);
    throw new Error(message);
  } finally {
    stream.abort();
  }
}

/**
 * Yerel motor: API anahtarı yokken bile ekranda anlamlı, VERİYE DAYALI bir
 * yanıt üretir. Hiçbir dış çağrı yapmaz.
 *
 * Önceki sürüm yalnızca girdi bağlamını geri yazıyordu; artık soru
 * sınıflandırılıp yanıt doğrudan veritabanından derleniyor.
 */
async function* localEngine(
  prompt: AiPreparedPrompt,
  scope?: AnswerScope,
): AsyncGenerator<string, void, void> {
  const banner =
    '> **Yerel motor** — AI sağlayıcı anahtarı tanımlı olmadığı için hiçbir veri ' +
    'dışarıya gönderilmedi. Aşağıdaki yanıt doğrudan CRM veritabanından üretildi. ' +
    'Serbest metin analizi için Ayarlar → AI Sağlayıcı bölümünden anahtar tanımlayın.\n\n';

  let text: string;

  if (!scope) {
    text = `${banner}Yanıt üretilemedi: kullanıcı kapsamı çözülemedi.`;
  } else if (prompt.task === 'FREEFORM') {
    text = banner + (await answerLocally(prompt.rawQuestion ?? '', scope));
  } else {
    // Şirket özeti / ihale risk analizi: model olmadan yorum üretilemez,
    // ancak toplanan bağlam yapılandırılmış biçimde sunulabilir.
    text =
      `${banner}### ${prompt.title}\n\n` +
      'Model tabanlı yorum için anahtar gerekir. Aşağıda, analizin dayanacağı ' +
      `CRM verisi derlenmiş hâliyle listelenmiştir (${prompt.contextSummary}).\n\n` +
      prompt.userMessage.split('\n').slice(1).join('\n');
  }

  // Akış davranışını taklit et ki istemci tarafı tek kod yolundan ilerlesin.
  const tokens = text.match(/\S+\s*/g) ?? [text];
  for (const token of tokens) {
    yield token;
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
}
