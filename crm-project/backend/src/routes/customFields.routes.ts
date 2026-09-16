import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { BadRequest, NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { auditAction } from '../middleware/audit';

const router = Router();
router.use(authenticate, requireMfaComplete);

const ENTITY_TYPES = ['COMPANY', 'CONTACT', 'DEAL', 'TENDER'] as const;
const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT'] as const;

const bodySchema = z
  .object({
    entityType: z.enum(ENTITY_TYPES),
    // Alan anahtarı JSON yolunda kullanılır; yalnızca güvenli karakterler.
    fieldKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/i, 'Alan anahtarı harfle başlamalı, yalnızca harf/rakam/alt çizgi içermelidir.'),
    fieldLabel: z.string().trim().min(1).max(120),
    fieldType: z.enum(FIELD_TYPES).default('TEXT'),
    options: z.array(z.string().trim().min(1).max(100)).max(100).nullish(),
    isRequired: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(999).default(0),
    isActive: z.boolean().default(true),
  })
  .refine(
    (v) => v.fieldType !== 'SELECT' || (v.options?.length ?? 0) > 0,
    { message: 'SELECT tipi alanlar için en az bir seçenek gereklidir.', path: ['options'] },
  );

function serialize(row: {
  id: string; entityType: string; fieldKey: string; fieldLabel: string;
  fieldType: string; optionsJson: string | null; isRequired: boolean;
  sortOrder: number; isActive: boolean;
}) {
  let options: string[] = [];
  if (row.optionsJson) {
    try {
      const parsed: unknown = JSON.parse(row.optionsJson);
      if (Array.isArray(parsed)) options = parsed.filter((o): o is string => typeof o === 'string');
    } catch {
      // Bozuk JSON kaydı tüm listeyi düşürmemeli; boş seçenekle devam edilir.
      options = [];
    }
  }
  return { ...row, options, optionsJson: undefined };
}

/** GET /api/v1/custom-fields?entityType=COMPANY */
router.get(
  '/',
  requirePermission('customfield:read'),
  asyncHandler(async (req, res) => {
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
    if (entityType && !(ENTITY_TYPES as readonly string[]).includes(entityType)) {
      throw BadRequest('Geçersiz entityType.');
    }
    const rows = await prisma.customFieldDefinition.findMany({
      where: { ...(entityType ? { entityType } : {}), isActive: true },
      orderBy: [{ entityType: 'asc' }, { sortOrder: 'asc' }, { fieldLabel: 'asc' }],
    });
    res.json({ data: rows.map(serialize) });
  }),
);

/** POST /api/v1/custom-fields */
router.post(
  '/',
  requirePermission('customfield:write'),
  validate(bodySchema),
  auditAction('CUSTOM_FIELD_CREATE', 'CustomFieldDefinition'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof bodySchema>;
    const row = await prisma.customFieldDefinition.create({
      data: {
        entityType: body.entityType,
        fieldKey: body.fieldKey,
        fieldLabel: body.fieldLabel,
        fieldType: body.fieldType,
        optionsJson: body.options?.length ? JSON.stringify(body.options) : null,
        isRequired: body.isRequired,
        sortOrder: body.sortOrder,
        isActive: body.isActive,
      },
    });
    req.auditContext = { entityType: 'CustomFieldDefinition', entityId: row.id };
    res.status(201).json(serialize(row));
  }),
);

/** PUT /api/v1/custom-fields/:id */
router.put(
  '/:id',
  requirePermission('customfield:write'),
  validate(bodySchema.innerType().partial()),
  auditAction('CUSTOM_FIELD_UPDATE', 'CustomFieldDefinition'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.customFieldDefinition.findUnique({ where: { id } });
    if (!existing) throw NotFound('Özel alan tanımı bulunamadı.');

    const body = req.body as Partial<z.infer<ReturnType<typeof bodySchema.innerType>>>;
    const row = await prisma.customFieldDefinition.update({
      where: { id },
      data: {
        ...(body.fieldLabel !== undefined ? { fieldLabel: body.fieldLabel } : {}),
        ...(body.fieldType !== undefined ? { fieldType: body.fieldType } : {}),
        ...(body.options !== undefined
          ? { optionsJson: body.options?.length ? JSON.stringify(body.options) : null }
          : {}),
        ...(body.isRequired !== undefined ? { isRequired: body.isRequired } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    res.json(serialize(row));
  }),
);

/**
 * DELETE /api/v1/custom-fields/:id
 * Tanım pasifleştirilir, silinmez: kayıtların `customFields` JSON'undaki
 * veriler korunur ve alan yeniden açıldığında geri gelir.
 */
router.delete(
  '/:id',
  requirePermission('customfield:write'),
  auditAction('CUSTOM_FIELD_DEACTIVATE', 'CustomFieldDefinition'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.customFieldDefinition.findUnique({ where: { id } });
    if (!existing) throw NotFound('Özel alan tanımı bulunamadı.');
    await prisma.customFieldDefinition.update({ where: { id }, data: { isActive: false } });
    res.json({ success: true, message: 'Alan pasifleştirildi; mevcut veriler korundu.' });
  }),
);

export default router;
