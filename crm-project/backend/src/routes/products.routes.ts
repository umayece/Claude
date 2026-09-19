import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { BadRequest, NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { buildOrderBy, paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { auditAction } from '../middleware/audit';
import { SUPPORTED_CURRENCIES } from '../services/currency.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

export const PRODUCT_CATEGORIES = [
  'Mühimmat', 'Ağır Silah', 'Kimyasal', 'Yedek Parça', 'Hizmet', 'Diğer',
] as const;

export const PRODUCT_UNITS = ['Adet', 'Kg', 'Ton', 'Koli', 'Saat', 'Metre'] as const;

const productBodySchema = z.object({
  sku: z.string().trim().min(1, 'Stok kodu zorunludur.').max(60),
  name: z.string().trim().min(2).max(200),
  description: z.string().max(5000).nullish(),
  category: z.string().trim().min(1).max(60),
  unitPrice: z.number().min(0).max(1e12).default(0),
  currency: z.enum(SUPPORTED_CURRENCIES).default('USD'),
  taxRate: z.number().min(0).max(100).default(20),
  stockQuantity: z.number().int().min(0).max(1e9).default(0),
  minStockLevel: z.number().int().min(0).max(1e9).default(0),
  unit: z.string().trim().max(20).default('Adet'),
  isActive: z.boolean().default(true),

  // --- Ambalaj / lojistik (koli-palet-konteyner hesabı için) ---
  // Şemada tanımlıydı ama API'ye açılmamıştı; hesaplayıcı katalogdan
  // ambalaj okuyabilsin diye buraya alındı.
  unitWeightKg: z.number().min(0).max(1e6).nullish(),
  caseQuantity: z.number().int().min(0).max(1e6).nullish(),
  caseLengthCm: z.number().min(0).max(2000).nullish(),
  caseWidthCm: z.number().min(0).max(2000).nullish(),
  caseHeightCm: z.number().min(0).max(2000).nullish(),
  caseWeightKg: z.number().min(0).max(1e5).nullish(),
  hazardClass: z.string().trim().max(20).nullish(),

  // --- Savunma sanayii sınıflandırması ---
  /** BM madde numarası, ör. "UN0012". */
  unNumber: z.string().trim().max(12).nullish(),
  /** Birim başına net patlayıcı ağırlığı (gram) — sevkiyat izninin dayanağı. */
  neqGrams: z.number().min(0).max(1e9).nullish(),
  /** NATO Stok Numarası, 13 hane. */
  nsn: z.string().trim().max(20).nullish(),
  /** Askeri Liste sınıfı, ör. "ML3". */
  militaryListCategory: z.string().trim().max(20).nullish(),
  requiresExportLicence: z.boolean().default(true),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(60).optional(),
  isActive: z.coerce.boolean().optional(),
  lowStock: z.coerce.boolean().optional(),
  sort: z.string().max(40).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

/** GET /api/v1/products */
router.get(
  '/',
  requirePermission('product:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const orderBy = buildOrderBy(
      query.sort,
      ['createdAt', 'name', 'sku', 'unitPrice', 'stockQuantity'] as const,
      'name',
    );

    const and: Prisma.ProductWhereInput[] = [{ deletedAt: null }];
    if (query.category) and.push({ category: query.category });
    if (query.isActive !== undefined) and.push({ isActive: query.isActive });
    if (query.q) {
      and.push({
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { sku: { contains: query.q, mode: 'insensitive' } },
          { description: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.ProductWhereInput = { AND: and };
    const [rows, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        orderBy,
        skip: page.skip, take: page.take,
      }),
      prisma.product.count({ where }),
    ]);

    // Kritik stok filtresi iki sütunun karşılaştırmasıdır; Prisma bunu
    // doğrudan `where` içinde desteklemediği için sayfa üstünde uygulanır.
    const data = query.lowStock ? rows.filter((p) => p.stockQuantity <= p.minStockLevel) : rows;

    res.json(paginated(
      data.map((p) => ({ ...p, isLowStock: p.stockQuantity <= p.minStockLevel })),
      query.lowStock ? data.length : total,
      page,
    ));
  }),
);

/** GET /api/v1/products/:id */
router.get(
  '/:id',
  requirePermission('product:read'),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!product) throw NotFound('Ürün bulunamadı.');
    res.json({ ...product, isLowStock: product.stockQuantity <= product.minStockLevel });
  }),
);

/** POST /api/v1/products */
router.post(
  '/',
  requirePermission('product:write'),
  validate(productBodySchema),
  auditAction('PRODUCT_CREATE', 'Product'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productBodySchema>;
    const product = await prisma.product.create({ data: body });
    req.auditContext = { entityType: 'Product', entityId: product.id };
    res.status(201).json(product);
  }),
);

/** PUT /api/v1/products/:id */
router.put(
  '/:id',
  requirePermission('product:write'),
  validate(productBodySchema.partial()),
  auditAction('PRODUCT_UPDATE', 'Product'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw NotFound('Ürün bulunamadı.');
    const product = await prisma.product.update({
      where: { id },
      data: req.body as Prisma.ProductUpdateInput,
    });
    res.json(product);
  }),
);

/** DELETE /api/v1/products/:id */
router.delete(
  '/:id',
  requirePermission('product:delete'),
  auditAction('PRODUCT_DELETE', 'Product'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw NotFound('Ürün bulunamadı.');
    await prisma.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// CSV içe aktarma
// ---------------------------------------------------------------------------

const importSchema = z.object({
  csv: z.string().min(1, 'CSV içeriği boş olamaz.').max(5_000_000),
  /** true ise mevcut SKU'lar güncellenir, false ise atlanır. */
  updateExisting: z.boolean().default(true),
  delimiter: z.enum([',', ';', '\t']).default(';'),
});

/**
 * Basit ama doğru CSV çözümleyici: tırnak içindeki ayraç ve çift tırnak
 * kaçışını ("") destekler. Harici bağımlılık eklemeden RFC 4180'in
 * kullandığımız alt kümesini karşılar.
 */
function parseCsv(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += char;
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }

  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  // Türkçe biçim: "1.250,50" → 1250.50
  const normalized = value.trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * POST /api/v1/products/import-csv
 *
 * Beklenen başlıklar (büyük/küçük harf duyarsız):
 * sku;name;category;unitPrice;currency;taxRate;stockQuantity;unit;description
 */
router.post(
  '/import-csv',
  requirePermission('product:write'),
  validate(importSchema),
  auditAction('PRODUCT_IMPORT_CSV', 'Product'),
  asyncHandler(async (req, res) => {
    const { csv, updateExisting, delimiter } = req.body as z.infer<typeof importSchema>;
    const rows = parseCsv(csv, delimiter);
    if (rows.length < 2) throw BadRequest('CSV en az bir başlık ve bir veri satırı içermelidir.');

    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const index = (name: string): number => header.indexOf(name.toLowerCase());

    const skuIdx = index('sku');
    const nameIdx = index('name');
    if (skuIdx === -1 || nameIdx === -1) {
      throw BadRequest('CSV başlıklarında "sku" ve "name" sütunları zorunludur.', { header });
    }

    const categoryIdx = index('category');
    const priceIdx = index('unitprice');
    const currencyIdx = index('currency');
    const taxIdx = index('taxrate');
    const stockIdx = index('stockquantity');
    const unitIdx = index('unit');
    const descIdx = index('description');

    const created: string[] = [];
    const updated: string[] = [];
    const skipped: { line: number; sku: string; reason: string }[] = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i]!;
      const sku = (row[skuIdx] ?? '').trim();
      const name = (row[nameIdx] ?? '').trim();
      const lineNo = i + 1;

      if (!sku || !name) {
        skipped.push({ line: lineNo, sku, reason: 'sku veya name boş' });
        continue;
      }

      const currencyRaw = (row[currencyIdx] ?? 'TRY').trim().toUpperCase();
      const currency = (SUPPORTED_CURRENCIES as readonly string[]).includes(currencyRaw)
        ? currencyRaw
        : 'TRY';

      const data = {
        name,
        category: (row[categoryIdx] ?? 'Diğer').trim() || 'Diğer',
        unitPrice: toNumber(row[priceIdx], 0),
        currency,
        taxRate: toNumber(row[taxIdx], 20),
        stockQuantity: Math.trunc(toNumber(row[stockIdx], 0)),
        unit: (row[unitIdx] ?? 'Adet').trim() || 'Adet',
        description: (row[descIdx] ?? '').trim() || null,
      };

      const existing = await prisma.product.findUnique({ where: { sku } });
      if (existing) {
        if (!updateExisting) {
          skipped.push({ line: lineNo, sku, reason: 'SKU zaten var' });
          continue;
        }
        await prisma.product.update({
          where: { sku },
          data: { ...data, deletedAt: null },
        });
        updated.push(sku);
      } else {
        await prisma.product.create({ data: { sku, ...data } });
        created.push(sku);
      }
    }

    req.auditContext = {
      entityType: 'Product',
      changes: { created: created.length, updated: updated.length, skipped: skipped.length },
    };

    res.json({
      success: true,
      summary: {
        totalRows: rows.length - 1,
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
      },
      skipped,
    });
  }),
);

export default router;
