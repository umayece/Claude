import { Router } from 'express';
import { Prisma, type CompanyType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { BadRequest, Conflict, NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { buildOrderBy, paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { companyScope, assertCompanyAccess } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { auditAction } from '../middleware/audit';
import { logActivity } from '../services/activity.service';
import { toTry } from '../services/currency.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

const COMPANY_TYPES = ['B2G', 'B2B', 'B2C', 'OTHER'] as const;

const SORTABLE = ['createdAt', 'updatedAt', 'name', 'status'] as const;

const companyBodySchema = z.object({
  name: z.string().trim().min(2, 'Şirket adı en az 2 karakter olmalıdır.').max(200),
  type: z.enum(COMPANY_TYPES).default('B2B'),
  status: z.string().trim().max(60).default('Potansiyel'),
  sector: z.string().trim().max(80).nullish(),
  website: z.string().trim().max(255).nullish(),
  email: z.string().trim().email('Geçerli bir e-posta giriniz.').max(255).nullish().or(z.literal('')),
  phone: z.string().trim().max(40).nullish(),
  taxNumber: z.string().trim().max(30).nullish(),
  taxOffice: z.string().trim().max(120).nullish(),
  address: z.string().trim().max(1000).nullish(),
  country: z.string().trim().max(80).default('Türkiye'),
  countryCode: z.string().trim().length(2).toUpperCase().default('TR'),
  cityId: z.string().uuid().nullish(),
  /// Şehir listesinde olmayan lokasyonlar için serbest metin.
  cityName: z.string().trim().max(120).nullish(),
  districtName: z.string().trim().max(120).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  notes: z.string().max(5000).nullish(),
  ownerId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
  customFields: z.record(z.unknown()).nullish(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  type: z.enum(COMPANY_TYPES).optional(),
  status: z.string().trim().max(60).optional(),
  sector: z.string().trim().max(80).optional(),
  cityId: z.string().uuid().optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  /// "domestic" → yalnızca Türkiye, "international" → yurt dışı.
  scope: z.enum(['domestic', 'international']).optional(),
  ownerId: z.string().uuid().optional(),
  sort: z.string().max(40).optional(),
  /** Harita modunda yalnızca koordinatı çözülebilen kayıtlar döner. */
  mapOnly: z.coerce.boolean().optional(),
  /** "30" → son 30 günde oluşturulanlar (harita filtresi). */
  createdWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

const listInclude = {
  city: {
    select: {
      id: true, name: true, latitude: true, longitude: true,
      country: true, countryCode: true,
    },
  },
  owner: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  _count: { select: { contacts: true, deals: true, tenders: true, contracts: true, tickets: true } },
} satisfies Prisma.CompanyInclude;

type CompanyWithRelations = Prisma.CompanyGetPayload<{ include: typeof listInclude }>;

/**
 * Harita kaydının koordinatı.
 *
 * Şirkete elle koordinat girilmemiş olsa bile bağlı olduğu şehrin koordinatı
 * kullanılır; böylece harita "boş" kalmaz. `coordinateSource` ile istemci
 * pinin kesin mi yaklaşık mı olduğunu gösterebilir.
 */
function resolveCoordinates(company: CompanyWithRelations) {
  if (company.latitude !== null && company.longitude !== null) {
    return {
      latitude: company.latitude,
      longitude: company.longitude,
      coordinateSource: 'COMPANY' as const,
    };
  }
  if (company.city) {
    return {
      latitude: company.city.latitude,
      longitude: company.city.longitude,
      coordinateSource: 'CITY' as const,
    };
  }
  return { latitude: null, longitude: null, coordinateSource: 'NONE' as const };
}

function serialize(company: CompanyWithRelations) {
  const coords = resolveCoordinates(company);
  return {
    ...company,
    latitude: coords.latitude,
    longitude: coords.longitude,
    coordinateSource: coords.coordinateSource,
    /** Elle girilmiş ham koordinat — düzenleme formu bunu gösterir. */
    rawLatitude: company.latitude,
    rawLongitude: company.longitude,
    // Listede bir şehir seçilmişse onun adı, yoksa serbest metin gösterilir.
    displayCity: company.city?.name ?? company.cityName ?? null,
  };
}

interface ResolvedLocation {
  latitude: number | null;
  longitude: number | null;
  country: string;
  countryCode: string;
}

/**
 * Konumu tek yerde çözer.
 *
 * - Şehir seçilmişse koordinat ve ÜLKE o kayıttan türetilir; böylece
 *   "Berlin seçip ülke Türkiye kalması" gibi tutarsızlık imkânsızdır.
 * - Kullanıcının elle girdiği koordinat ASLA ezilmez (yurt dışı serbest
 *   metin lokasyonlarda tek konum kaynağı budur).
 * - Şehir yoksa gövdeden gelen ülke bilgisi kullanılır.
 */
async function resolveLocation(data: {
  cityId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  country?: string | null;
  countryCode?: string | null;
}): Promise<ResolvedLocation> {
  const latitude = data.latitude ?? null;
  const longitude = data.longitude ?? null;

  if (data.cityId) {
    const city = await prisma.city.findUnique({
      where: { id: data.cityId },
      select: { latitude: true, longitude: true, country: true, countryCode: true },
    });
    if (!city) throw BadRequest('Seçilen şehir bulunamadı.');
    return {
      latitude: latitude ?? city.latitude,
      longitude: longitude ?? city.longitude,
      country: city.country,
      countryCode: city.countryCode,
    };
  }

  return {
    latitude,
    longitude,
    country: data.country?.trim() || 'Türkiye',
    countryCode: (data.countryCode ?? 'TR').toUpperCase(),
  };
}

function buildWhere(query: ListQuery, user: Express.Request['user']): Prisma.CompanyWhereInput {
  const and: Prisma.CompanyWhereInput[] = [{ deletedAt: null }, companyScope(user)];

  if (query.q) {
    and.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { taxNumber: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { website: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }
  if (query.type) and.push({ type: query.type as CompanyType });
  if (query.status) and.push({ status: query.status });
  if (query.sector) and.push({ sector: query.sector });
  if (query.cityId) and.push({ cityId: query.cityId });
  if (query.countryCode) and.push({ countryCode: query.countryCode });
  if (query.scope === 'domestic') and.push({ countryCode: 'TR' });
  if (query.scope === 'international') and.push({ countryCode: { not: 'TR' } });
  if (query.ownerId) and.push({ ownerId: query.ownerId });
  if (query.createdWithinDays) {
    and.push({ createdAt: { gte: new Date(Date.now() - query.createdWithinDays * 86_400_000) } });
  }
  // Harita modu: koordinatı olan VEYA bir şehre bağlı kayıtlar.
  if (query.mapOnly) {
    and.push({
      OR: [
        { AND: [{ latitude: { not: null } }, { longitude: { not: null } }] },
        { cityId: { not: null } },
      ],
    });
  }
  return { AND: and };
}

/** GET /api/v1/companies — sayfalanmış liste. */
router.get(
  '/',
  requirePermission('company:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const orderBy = buildOrderBy(
      query.sort,
      SORTABLE,
      'createdAt',
    );
    const where = buildWhere(query, req.user);

    const [rows, total] = await prisma.$transaction([
      prisma.company.findMany({
        where,
        include: listInclude,
        orderBy,
        skip: page.skip,
        take: page.take,
      }),
      prisma.company.count({ where }),
    ]);

    res.json(paginated(rows.map(serialize), total, page));
  }),
);

/**
 * GET /api/v1/companies/map — harita katmanı.
 *
 * Isı haritası binlerce noktayla çalışır; ayrı bir uç kullanmak liste
 * uç noktasının ağır `include` yükünü haritadan uzak tutar.
 */
router.get(
  '/map',
  requirePermission('company:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const where = buildWhere({ ...query, mapOnly: true }, req.user);

    const rows = await prisma.company.findMany({
      where,
      // Harita üst sınırı sabit: tarayıcı canvas'ı sonsuz nokta çizemez.
      take: 2000,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, name: true, type: true, status: true, sector: true,
        latitude: true, longitude: true, createdAt: true,
        country: true, countryCode: true, cityName: true,
        city: {
          select: {
            id: true, name: true, latitude: true, longitude: true,
            country: true, countryCode: true,
          },
        },
        deals: {
          where: { deletedAt: null, stage: 'Kazanıldı' },
          select: { amount: true, exchangeRate: true },
        },
        _count: { select: { tenders: { where: { deletedAt: null } } } },
      },
    });

    const points = rows
      .map((row) => {
        const latitude = row.latitude ?? row.city?.latitude ?? null;
        const longitude = row.longitude ?? row.city?.longitude ?? null;
        if (latitude === null || longitude === null) return null;
        const revenueTry = row.deals.reduce((sum, d) => sum + toTry(d.amount, d.exchangeRate), 0);
        return {
          id: row.id,
          name: row.name,
          type: row.type,
          status: row.status,
          sector: row.sector,
          // Şehir listesinden seçilmemişse serbest metin adı kullanılır.
          cityName: row.city?.name ?? row.cityName ?? null,
          country: row.city?.country ?? row.country,
          countryCode: row.city?.countryCode ?? row.countryCode,
          latitude,
          longitude,
          coordinateSource: row.latitude !== null && row.longitude !== null ? 'COMPANY' : 'CITY',
          revenueTry,
          tenderCount: row._count.tenders,
          createdAt: row.createdAt,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    res.json({ data: points, meta: { total: points.length, capped: rows.length === 2000 } });
  }),
);

/** GET /api/v1/companies/trash — çöp kutusu. */
router.get(
  '/trash',
  requirePermission('company:delete'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);
    const where: Prisma.CompanyWhereInput = {
      AND: [
        { deletedAt: { not: null } },
        companyScope(req.user),
        ...(query.q ? [{ name: { contains: query.q, mode: 'insensitive' as const } }] : []),
      ],
    };

    const [rows, total] = await prisma.$transaction([
      prisma.company.findMany({
        where,
        include: listInclude,
        orderBy: { deletedAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      prisma.company.count({ where }),
    ]);

    const retention = env.trashRetentionDays;
    res.json(
      paginated(
        rows.map((row) => {
          const deletedAt = row.deletedAt!;
          const purgeAt = new Date(deletedAt.getTime() + retention * 86_400_000);
          return {
            ...serialize(row),
            purgeAt,
            daysUntilPurge: Math.max(0, Math.ceil((purgeAt.getTime() - Date.now()) / 86_400_000)),
          };
        }),
        total,
        page,
      ),
    );
  }),
);

/** GET /api/v1/companies/:id */
router.get(
  '/:id',
  requirePermission('company:read'),
  asyncHandler(async (req, res) => {
    const company = await prisma.company.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [companyScope(req.user)] },
      include: {
        ...listInclude,
        contacts: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { lastName: 'asc' }],
          include: { phones: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] } },
        },
        deals: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 },
        tenders: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 },
        contracts: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 },
        tickets: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!company) throw NotFound('Şirket bulunamadı.');

    const revenueTry = company.deals
      .filter((d) => d.stage === 'Kazanıldı')
      .reduce((sum, d) => sum + toTry(d.amount, d.exchangeRate), 0);

    res.json({ ...serialize(company as unknown as CompanyWithRelations), revenueTry, contacts: company.contacts, deals: company.deals, tenders: company.tenders, contracts: company.contracts, tickets: company.tickets });
  }),
);

/** GET /api/v1/companies/:id/timeline — kronolojik akış (sayfalanmış). */
router.get(
  '/:id/timeline',
  requirePermission('company:read'),
  asyncHandler(async (req, res) => {
    await assertCompanyAccess(req.user, String(req.params.id));
    const page = parsePagination(req.query as Record<string, unknown>);

    const where: Prisma.ActivityWhereInput = { companyId: req.params.id };
    const [rows, total] = await prisma.$transaction([
      prisma.activity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.activity.count({ where }),
    ]);

    res.json(paginated(rows, total, page));
  }),
);

/** POST /api/v1/companies */
router.post(
  '/',
  requirePermission('company:write'),
  validate(companyBodySchema),
  auditAction('COMPANY_CREATE', 'Company'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof companyBodySchema>;
    const location = await resolveLocation(body);

    // Aynı isim + vergi numarası ikilisi çift kayıt göstergesidir.
    const duplicate = await prisma.company.findFirst({
      where: {
        deletedAt: null,
        OR: [
          ...(body.taxNumber ? [{ taxNumber: body.taxNumber }] : []),
          { name: { equals: body.name, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, taxNumber: true },
    });
    if (duplicate && req.query.force !== 'true') {
      throw Conflict('Benzer bir şirket kaydı zaten var.', { duplicate });
    }

    const company = await prisma.company.create({
      data: {
        name: body.name,
        type: body.type,
        status: body.status,
        sector: body.sector ?? null,
        website: body.website ?? null,
        email: body.email || null,
        phone: body.phone ?? null,
        taxNumber: body.taxNumber ?? null,
        taxOffice: body.taxOffice ?? null,
        address: body.address ?? null,
        country: location.country,
        countryCode: location.countryCode,
        cityId: body.cityId ?? null,
        cityName: body.cityName ?? null,
        districtName: body.districtName ?? null,
        latitude: location.latitude,
        longitude: location.longitude,
        notes: body.notes ?? null,
        ownerId: body.ownerId ?? req.user!.id,
        departmentId: body.departmentId ?? req.user!.departmentId,
        customFields: (body.customFields ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      include: listInclude,
    });

    req.auditContext = { entityType: 'Company', entityId: company.id };
    await logActivity({
      type: 'SYSTEM', title: 'Şirket kaydı oluşturuldu',
      companyId: company.id, userId: req.user!.id,
    });

    res.status(201).json(serialize(company));
  }),
);

/** PUT /api/v1/companies/:id */
router.put(
  '/:id',
  requirePermission('company:write'),
  validate(companyBodySchema.partial()),
  auditAction('COMPANY_UPDATE', 'Company'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await assertCompanyAccess(req.user, id);

    const body = req.body as Partial<z.infer<typeof companyBodySchema>>;
    const existing = await prisma.company.findUniqueOrThrow({ where: { id } });

    // Koordinat çözümlemesi güncel cityId üzerinden yapılır: şehir
    // değiştirildiğinde eski şehrin koordinatı yapışıp kalmamalı.
    const nextCityId = body.cityId !== undefined ? body.cityId : existing.cityId;
    const cityChanged = body.cityId !== undefined && body.cityId !== existing.cityId;
    const location = await resolveLocation({
      cityId: nextCityId,
      latitude: body.latitude !== undefined ? body.latitude : cityChanged ? null : existing.latitude,
      longitude: body.longitude !== undefined ? body.longitude : cityChanged ? null : existing.longitude,
      country: body.country ?? existing.country,
      countryCode: body.countryCode ?? existing.countryCode,
    });

    const company = await prisma.company.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.sector !== undefined ? { sector: body.sector } : {}),
        ...(body.website !== undefined ? { website: body.website } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.taxNumber !== undefined ? { taxNumber: body.taxNumber } : {}),
        ...(body.taxOffice !== undefined ? { taxOffice: body.taxOffice } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.districtName !== undefined ? { districtName: body.districtName } : {}),
        ...(body.cityName !== undefined ? { cityName: body.cityName } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
        ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
        ...(body.customFields !== undefined
          ? { customFields: (body.customFields ?? Prisma.DbNull) as Prisma.InputJsonValue }
          : {}),
        cityId: nextCityId,
        country: location.country,
        countryCode: location.countryCode,
        latitude: location.latitude,
        longitude: location.longitude,
      },
      include: listInclude,
    });

    if (body.status && body.status !== existing.status) {
      await logActivity({
        type: 'STAGE_CHANGE',
        title: `Durum değişti: ${existing.status} → ${body.status}`,
        companyId: id, userId: req.user!.id,
        metadata: { from: existing.status, to: body.status },
      });
    }

    res.json(serialize(company));
  }),
);

const stageSchema = z.object({ status: z.string().trim().min(1).max(60) });

/** PUT /api/v1/companies/:id/stage — süreç çubuğundan tek tıkla aşama değişimi. */
router.put(
  '/:id/stage',
  requirePermission('company:write'),
  validate(stageSchema),
  auditAction('COMPANY_STAGE_CHANGE', 'Company'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await assertCompanyAccess(req.user, id);
    const { status } = req.body as z.infer<typeof stageSchema>;

    const before = await prisma.company.findUniqueOrThrow({
      where: { id }, select: { status: true },
    });
    const company = await prisma.company.update({
      where: { id }, data: { status }, include: listInclude,
    });

    await logActivity({
      type: 'STAGE_CHANGE',
      title: `${existing.name}: ${before.status} → ${status}`,
      companyId: id, userId: req.user!.id,
      metadata: { from: before.status, to: status },
    });

    res.json(serialize(company));
  }),
);

/**
 * DELETE /api/v1/companies/:id — yumuşak silme (çöp kutusu).
 *
 * Kayıt fiziksel olarak silinmez; ilişkili fırsat/teklif/sözleşme kayıtları
 * da aynı anda yumuşak silinir. Böylece kalıcı temizlik sırasında
 * `onDelete: Cascade` yetim kayıt bırakmaz ve geri yükleme mümkün kalır.
 */
router.delete(
  '/:id',
  requirePermission('company:delete'),
  auditAction('COMPANY_SOFT_DELETE', 'Company'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const company = await assertCompanyAccess(req.user, id);
    const now = new Date();

    await prisma.$transaction([
      prisma.company.update({ where: { id }, data: { deletedAt: now, isArchived: true } }),
      prisma.contact.updateMany({ where: { companyId: id, deletedAt: null }, data: { deletedAt: now } }),
      prisma.deal.updateMany({ where: { companyId: id, deletedAt: null }, data: { deletedAt: now } }),
      prisma.offer.updateMany({ where: { companyId: id, deletedAt: null }, data: { deletedAt: now } }),
      prisma.tender.updateMany({ where: { companyId: id, deletedAt: null }, data: { deletedAt: now } }),
      prisma.contract.updateMany({ where: { companyId: id, deletedAt: null }, data: { deletedAt: now } }),
      prisma.ticket.updateMany({ where: { companyId: id, deletedAt: null }, data: { deletedAt: now } }),
      prisma.task.updateMany({ where: { companyId: id, deletedAt: null }, data: { deletedAt: now } }),
    ]);

    await logActivity({
      type: 'SYSTEM', title: `${company.name} çöp kutusuna taşındı`,
      companyId: id, userId: req.user!.id,
    });

    res.json({
      success: true,
      deletedAt: now,
      purgeAt: new Date(now.getTime() + env.trashRetentionDays * 86_400_000),
      message: `Kayıt çöp kutusuna taşındı. ${env.trashRetentionDays} gün içinde geri yüklenebilir.`,
    });
  }),
);

/** POST /api/v1/companies/:id/restore — çöp kutusundan geri yükle. */
router.post(
  '/:id/restore',
  requirePermission('company:restore'),
  auditAction('COMPANY_RESTORE', 'Company'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const company = await prisma.company.findFirst({
      where: { id, deletedAt: { not: null }, AND: [companyScope(req.user)] },
      select: { id: true, name: true, deletedAt: true },
    });
    if (!company) throw NotFound('Çöp kutusunda böyle bir kayıt yok.');

    // Yalnızca şirketle BİRLİKTE silinen alt kayıtlar geri gelir; daha önce
    // ayrıca silinmiş olanlar çöp kutusunda kalmaya devam eder.
    const deletedAt = company.deletedAt!;
    const windowStart = new Date(deletedAt.getTime() - 5000);
    const windowEnd = new Date(deletedAt.getTime() + 5000);
    const range = { gte: windowStart, lte: windowEnd };

    await prisma.$transaction([
      prisma.company.update({ where: { id }, data: { deletedAt: null, isArchived: false } }),
      prisma.contact.updateMany({ where: { companyId: id, deletedAt: range }, data: { deletedAt: null } }),
      prisma.deal.updateMany({ where: { companyId: id, deletedAt: range }, data: { deletedAt: null } }),
      prisma.offer.updateMany({ where: { companyId: id, deletedAt: range }, data: { deletedAt: null } }),
      prisma.tender.updateMany({ where: { companyId: id, deletedAt: range }, data: { deletedAt: null } }),
      prisma.contract.updateMany({ where: { companyId: id, deletedAt: range }, data: { deletedAt: null } }),
      prisma.ticket.updateMany({ where: { companyId: id, deletedAt: range }, data: { deletedAt: null } }),
      prisma.task.updateMany({ where: { companyId: id, deletedAt: range }, data: { deletedAt: null } }),
    ]);

    await logActivity({
      type: 'SYSTEM', title: `${company.name} çöp kutusundan geri yüklendi`,
      companyId: id, userId: req.user!.id,
    });

    res.json({ success: true, message: 'Kayıt geri yüklendi.' });
  }),
);

/**
 * DELETE /api/v1/companies/:id/permanent — kalıcı silme (yalnızca ADMIN).
 * Cascade zinciri şemada tanımlı; alt kayıtlar birlikte gider.
 */
router.delete(
  '/:id/permanent',
  requirePermission('company:delete'),
  auditAction('COMPANY_HARD_DELETE', 'Company'),
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'ADMIN') throw NotFound('Kayıt bulunamadı.');
    const id = String(req.params.id);
    const company = await prisma.company.findFirst({
      where: { id, deletedAt: { not: null } },
      select: { id: true, name: true },
    });
    if (!company) throw NotFound('Yalnızca çöp kutusundaki kayıtlar kalıcı silinebilir.');

    await prisma.company.delete({ where: { id } });
    res.json({ success: true, message: `${company.name} kalıcı olarak silindi.` });
  }),
);

export default router;
