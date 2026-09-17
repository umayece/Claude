import { Router, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, assertCompanyAccess, companyScope } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimit';
import { writeAudit } from '../middleware/audit';
import { prisma } from '../lib/prisma';
import { NotFound } from '../lib/errors';
import { logActivity } from '../services/activity.service';
import {
  activeModel, AI_TASKS, isModelConfigured, preparePrompt, streamCompletion,
  type AiTaskKind,
} from '../services/ai.service';
import { companyScope as scopeFor } from '../middleware/rbac';

const router = Router();
router.use(authenticate, requireMfaComplete);

const streamSchema = z.object({
  task: z.enum(AI_TASKS),
  entityId: z.string().uuid().optional(),
  question: z.string().trim().max(8000).optional(),
});
type StreamBody = z.infer<typeof streamSchema>;

/**
 * SSE kare yazıcısı.
 *
 * Her olay `event:` + `data:` çifti olarak gider ve veri JSON'dur; çünkü
 * ham metin token'ları satır sonu içerebilir ve SSE'de satır sonu kare
 * ayıracıdır. JSON kodlaması bu kaymayı imkânsız kılar.
 */
function sse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function openSseStream(res: Response): NodeJS.Timeout {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx arkasında tamponlama SSE'yi bozar; açıkça kapatılır.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Ara sunucuların boşta kalan bağlantıyı düşürmesini engelleyen yorum karesi.
  return setInterval(() => res.write(': keep-alive\n\n'), 15_000);
}

/** İstenen görevin hedef kaydına erişim yetkisini doğrular. */
async function authorizeTarget(
  user: Express.Request['user'],
  task: AiTaskKind,
  entityId: string | undefined,
): Promise<{ companyId: string | null; tenderId: string | null }> {
  if (task === 'COMPANY_SUMMARY' && entityId) {
    const company = await assertCompanyAccess(user, entityId);
    return { companyId: company.id, tenderId: null };
  }
  if (task === 'TENDER_RISK' && entityId) {
    const tender = await prisma.tender.findFirst({
      where: { id: entityId, deletedAt: null, company: companyScope(user) },
      select: { id: true, companyId: true },
    });
    if (!tender) throw NotFound('İhale bulunamadı.');
    return { companyId: tender.companyId, tenderId: tender.id };
  }
  return { companyId: null, tenderId: null };
}

/** GET /api/v1/ai/status — istemci hangi motorun çalıştığını bilsin. */
router.get(
  '/status',
  requirePermission('ai:use'),
  asyncHandler(async (_req, res) => {
    const configured = await isModelConfigured();
    res.json({
      modelConfigured: configured,
      model: configured ? await activeModel() : 'local-rule-engine',
      tasks: AI_TASKS,
      streaming: true,
    });
  }),
);

/**
 * POST /api/v1/ai/stream — token bazlı SSE akışı.
 *
 * Olay sözleşmesi:
 *   event: meta   → { title, contextSummary, model, streamedAt }
 *   event: token  → { text }
 *   event: done   → { finished: true, characters }
 *   event: error  → { message }
 *
 * Hata akış AÇILDIKTAN sonra ortaya çıkarsa HTTP durumu artık
 * değiştirilemez; bu yüzden hata da bir SSE karesi olarak gönderilir.
 */
router.post(
  '/stream',
  requirePermission('ai:use'),
  aiLimiter,
  validate(streamSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as StreamBody;
    const target = await authorizeTarget(req.user, body.task, body.entityId);

    // Bağlam ve yetki doğrulaması akış AÇILMADAN önce yapılır ki
    // hatalar normal JSON hata gövdesiyle dönebilsin.
    const prompt = await preparePrompt(body);

    const controller = new AbortController();
    // İstemci sekmeyi kapatırsa üretimi sürdürmenin anlamı yok.
    req.on('close', () => controller.abort());

    const configured = await isModelConfigured();
    const modelLabel = configured ? await activeModel() : 'local-rule-engine';

    const heartbeat = openSseStream(res);
    let characters = 0;

    sse(res, 'meta', {
      title: prompt.title,
      contextSummary: prompt.contextSummary,
      model: modelLabel,
      streamedAt: new Date().toISOString(),
    });

    try {
      for await (const token of streamCompletion(prompt, {
        signal: controller.signal,
        // Yerel motor sorguları kullanıcının erişim kapsamıyla sınırlanır.
        scope: { userId: req.user!.id, companyWhere: scopeFor(req.user) },
      })) {
        characters += token.length;
        sse(res, 'token', { text: token });
      }
      sse(res, 'done', { finished: true, characters });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI yanıtı üretilemedi.';
      sse(res, 'error', { message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }

    // Denetim kaydı: hangi kullanıcı hangi kayıt için AI çalıştırdı.
    await writeAudit({
      req,
      action: `AI_${body.task}`,
      entityType: body.task === 'TENDER_RISK' ? 'Tender' : 'Company',
      entityId: body.entityId ?? null,
      changes: { characters, model: modelLabel },
      statusCode: 200,
    });

    if (target.companyId && characters > 0) {
      await logActivity({
        type: 'SYSTEM',
        title: body.task === 'TENDER_RISK'
          ? 'AI şartname risk analizi çalıştırıldı'
          : 'AI şirket geçmişi özeti çalıştırıldı',
        companyId: target.companyId,
        tenderId: target.tenderId,
        userId: req.user!.id,
        metadata: { task: body.task, characters },
      });
    }
  }),
);

/**
 * POST /api/v1/ai/generate — akışsız (senkron) sürüm.
 * Rapor üretimi veya arka plan işleri gibi akışa ihtiyaç duymayan
 * çağrılar için; aynı motoru kullanır.
 */
router.post(
  '/generate',
  requirePermission('ai:use'),
  aiLimiter,
  validate(streamSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as StreamBody;
    await authorizeTarget(req.user, body.task, body.entityId);
    const prompt = await preparePrompt(body);

    let text = '';
    for await (const token of streamCompletion(prompt, {
      scope: { userId: req.user!.id, companyWhere: scopeFor(req.user) },
    })) {
      text += token;
    }

    await writeAudit({
      req, action: `AI_${body.task}`,
      entityType: body.task === 'TENDER_RISK' ? 'Tender' : 'Company',
      entityId: body.entityId ?? null,
      changes: { characters: text.length },
      statusCode: 200,
    });

    const configured = await isModelConfigured();
    res.json({
      title: prompt.title,
      contextSummary: prompt.contextSummary,
      model: configured ? await activeModel() : 'local-rule-engine',
      text,
    });
  }),
);

const saveSchema = z.object({
  companyId: z.string().uuid().nullish(),
  tenderId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(300),
  content: z.string().min(1).max(200_000),
});

/** POST /api/v1/ai/save-to-timeline — üretilen analizi kalıcı not olarak iliştir. */
router.post(
  '/save-to-timeline',
  requirePermission('ai:use'),
  validate(saveSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof saveSchema>;
    let companyId = body.companyId ?? null;

    if (companyId) await assertCompanyAccess(req.user, companyId);
    if (body.tenderId) {
      const tender = await prisma.tender.findFirst({
        where: { id: body.tenderId, deletedAt: null, company: companyScope(req.user) },
        select: { companyId: true },
      });
      if (!tender) throw NotFound('İhale bulunamadı.');
      companyId ??= tender.companyId;
    }

    await logActivity({
      type: 'NOTE',
      title: body.title,
      body: body.content,
      companyId,
      tenderId: body.tenderId ?? null,
      userId: req.user!.id,
      metadata: { source: 'AI_ASSISTANT' },
    });

    res.status(201).json({ success: true });
  }),
);

export default router;
