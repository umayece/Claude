import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { NotFound } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { normalizePhone } from '../utils/phone';
import { paginated, parsePagination } from '../utils/pagination';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, assertCompanyAccess, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { auditAction } from '../middleware/audit';
import { logActivity } from '../services/activity.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

const PHONE_LABELS = ['İş', 'Cep', 'Sabit', 'Dahili', 'Faks'] as const;

const phoneSchema = z.object({
  id: z.string().uuid().optional(),
  number: z.string().trim().min(3, 'Telefon numarası çok kısa.').max(40),
  label: z.enum(PHONE_LABELS).default('Cep'),
  isPrimary: z.boolean().default(false),
  isInactive: z.boolean().default(false),
  inactiveReason: z.string().trim().max(200).nullish(),
});

/**
 * Esnek doğum tarihi: yalnızca yıl ("1978") veya yalnızca ay/gün ("14 Mart")
 * girilebilir. Tek kısıt: ay ile gün birlikte anlamlıdır — biri varsa
 * diğeri de olmalıdır, aksi halde "ayı bilinen ama günü bilinmeyen" kayıt
 * takvimde konumlandırılamaz.
 */
/**
 * Alanların tek tanımı. Doğum günü kuralı ayrı bir `superRefine` olarak
 * uygulanır; şema `.and()` ile birleştirilseydi ortaya çıkan ZodIntersection
 * `.partial()` desteklemez ve kısmi güncelleme (PUT) şeması kurulamazdı.
 */
const CONTACT_TYPES = [
  'Kurum Çalışanı', 'Bağımsız Danışman', 'Aracı/Komisyoncu',
  'Askeri Ataşe', 'Diğer',
] as const;

const contactFieldsSchema = z.object({
  /**
   * Şirket bağı ZORUNLU DEĞİL.
   *
   * Bağımsız danışman, aracı, komisyoncu ve askeri ataşe gibi kişilerin
   * kurumu çoğu zaman sistemde yoktur; kişiyi kaydedebilmek için sahte
   * bir şirket açmak zorunda kalmak veriyi bozar.
   */
  companyId: z.string().uuid().nullish(),
  contactType: z.enum(CONTACT_TYPES).default('Kurum Çalışanı'),

  // --- Bağımsız kişinin kendi adres/konum bilgisi ---
  addressLine: z.string().trim().max(400).nullish(),
  cityName: z.string().trim().max(120).nullish(),
  country: z.string().trim().max(80).default('Türkiye'),
  countryCode: z.string().trim().length(2).toUpperCase().default('TR'),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  firstName: z.string().trim().min(1, 'Ad zorunludur.').max(80),
  lastName: z.string().trim().min(1, 'Soyad zorunludur.').max(80),
  title: z.string().trim().max(120).nullish(),
  email: z.string().trim().email('Geçerli bir e-posta giriniz.').max(255).nullish().or(z.literal('')),
  departmentName: z.string().trim().max(120).nullish(),
  managerName: z.string().trim().max(120).nullish(),
  website: z.string().trim().max(255).nullish(),
  sector: z.string().trim().max(80).nullish(),
  avatarUrl: z.string().trim().max(500_000).nullish(),
  linkedinUrl: z.string().trim().max(255).nullish(),
  notes: z.string().max(5000).nullish(),
  isPrimary: z.boolean().default(false),
  phones: z.array(phoneSchema).max(15).default([]),

  /** Esnek doğum tarihi: yalnızca yıl veya yalnızca ay/gün girilebilir. */
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).nullish(),
  birthMonth: z.number().int().min(1).max(12).nullish(),
  birthDay: z.number().int().min(1).max(31).nullish(),
});

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface BirthdayFields {
  birthMonth?: number | null;
  birthDay?: number | null;
}

/**
 * Ay ile gün birlikte anlamlıdır: biri varsa diğeri de olmalıdır, aksi
 * halde "ayı bilinen ama günü bilinmeyen" kayıt takvimde konumlandırılamaz.
 */
function checkBirthday(value: BirthdayFields, ctx: z.RefinementCtx): void {
  const hasMonth = value.birthMonth !== null && value.birthMonth !== undefined;
  const hasDay = value.birthDay !== null && value.birthDay !== undefined;

  if (hasMonth !== hasDay) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Ay ve gün birlikte girilmelidir.',
      path: ['birthDay'],
    });
    return;
  }

  if (hasMonth && hasDay && value.birthDay! > (DAYS_IN_MONTH[value.birthMonth! - 1] ?? 31)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Seçilen ay için geçersiz gün.',
      path: ['birthDay'],
    });
  }
}

const contactCreateSchema = contactFieldsSchema.superRefine(checkBirthday);
const contactUpdateSchema = contactFieldsSchema.partial().superRefine(checkBirthday);

type ContactBody = z.infer<typeof contactFieldsSchema>;

const contactInclude = {
  company: { select: { id: true, name: true, type: true } },
  phones: { orderBy: [{ isInactive: 'asc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }] },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.ContactInclude;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  companyId: z.string().uuid().optional(),
  contactType: z.enum(CONTACT_TYPES).optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  /** Yalnızca bağımsız (kurumsuz) kişileri süz. */
  standalone: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  /** "1-12": doğum günü bu ayda olan kişiler. */
  birthMonth: z.coerce.number().int().min(1).max(12).optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * Telefon dizisini kişiye yazar.
 *
 * Gelen dizi kaynağın tamamıdır (replace semantiği): listede olmayan
 * numaralar silinir, `id` taşıyanlar güncellenir, yeni gelenler eklenir.
 * Aynı anda birden fazla birincil numara olamaz.
 */
async function syncPhones(
  tx: Prisma.TransactionClient,
  contactId: string,
  phones: z.infer<typeof phoneSchema>[],
): Promise<void> {
  const incomingIds = phones.map((p) => p.id).filter((id): id is string => Boolean(id));

  await tx.contactPhone.deleteMany({
    where: { contactId, ...(incomingIds.length ? { id: { notIn: incomingIds } } : {}) },
  });

  // Yalnızca bir numara birincil olabilir; kullanıcı birden fazla işaretlerse
  // ilk aktif olan birincil kabul edilir.
  let primaryAssigned = false;
  for (const phone of phones) {
    const isPrimary = !phone.isInactive && phone.isPrimary && !primaryAssigned;
    if (isPrimary) primaryAssigned = true;

    const data = {
      number: phone.number,
      normalizedNumber: normalizePhone(phone.number),
      label: phone.label,
      isPrimary,
      isInactive: phone.isInactive,
      inactiveReason: phone.isInactive ? phone.inactiveReason ?? null : null,
    };

    if (phone.id) {
      await tx.contactPhone.update({ where: { id: phone.id }, data });
    } else {
      await tx.contactPhone.create({ data: { ...data, contactId } });
    }
  }

  // Hiç birincil yoksa ilk aktif numara birincil olur.
  if (!primaryAssigned) {
    const first = await tx.contactPhone.findFirst({
      where: { contactId, isInactive: false },
      orderBy: { createdAt: 'asc' },
    });
    if (first) await tx.contactPhone.update({ where: { id: first.id }, data: { isPrimary: true } });
  }
}

/** GET /api/v1/contacts */
router.get(
  '/',
  requirePermission('contact:read'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<ListQuery>(req);
    const page = parsePagination(query as unknown as Record<string, unknown>);

    const and: Prisma.ContactWhereInput[] = [
      { deletedAt: null },
      // Bağımsız kişi (companyId = null) hiçbir departmana ait değildir;
      // departman kapsamı ona uygulanamaz. `contact:read` yetkisi olan
      // herkes görür. Kuruma bağlı kişiler eskisi gibi kapsamlanır.
      { OR: [{ companyId: null }, { company: companyScope(req.user) }] },
    ];
    if (query.companyId) and.push({ companyId: query.companyId });
    if (query.contactType) and.push({ contactType: query.contactType });
    if (query.countryCode) and.push({ countryCode: query.countryCode });
    // ?standalone=true → yalnızca kuruma bağlı OLMAYAN kişiler
    if (query.standalone === true) and.push({ companyId: null });
    if (query.standalone === false) and.push({ NOT: { companyId: null } });
    if (query.birthMonth) and.push({ birthMonth: query.birthMonth });
    if (query.q) {
      const digits = query.q.replace(/\D+/g, '');
      and.push({
        OR: [
          { firstName: { contains: query.q, mode: 'insensitive' } },
          { lastName: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { title: { contains: query.q, mode: 'insensitive' } },
          { departmentName: { contains: query.q, mode: 'insensitive' } },
          { cityName: { contains: query.q, mode: 'insensitive' } },
          { country: { contains: query.q, mode: 'insensitive' } },
          // Şirket adıyla arama: "Aselsan" yazan kullanıcı o kurumun
          // kişilerini görmeyi bekler.
          { company: { name: { contains: query.q, mode: 'insensitive' } } },
          // Kullanım dışı numaralar da eşleşir (isInactive filtresi YOK).
          ...(digits.length >= 3
            ? [{ phones: { some: { normalizedNumber: { contains: digits } } } }]
            : []),
        ],
      });
    }

    const where: Prisma.ContactWhereInput = { AND: and };
    const [rows, total] = await prisma.$transaction([
      prisma.contact.findMany({
        where,
        include: contactInclude,
        orderBy: [{ isPrimary: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      prisma.contact.count({ where }),
    ]);

    res.json(paginated(rows, total, page));
  }),
);

/** GET /api/v1/contacts/:id — kişi kartı + ilişkili fırsatlar. */
router.get(
  '/:id',
  requirePermission('contact:read'),
  asyncHandler(async (req, res) => {
    const contact = await prisma.contact.findFirst({
      where: {
        id: req.params.id, deletedAt: null,
        // Bağımsız kişi hiçbir departmana ait değildir; kapsam ona uygulanmaz.
        OR: [{ companyId: null }, { company: companyScope(req.user) }],
      },
      include: {
        ...contactInclude,
        deals: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, title: true, stage: true, amount: true, currency: true,
            expectedCloseDate: true, winProbabilityScore: true,
          },
        },
        offers: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, offerNumber: true, title: true, status: true, total: true, currency: true },
        },
        tickets: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, ticketNumber: true, title: true, status: true, priority: true },
        },
      },
    });
    if (!contact) throw NotFound('Kişi bulunamadı.');
    res.json(contact);
  }),
);

/** POST /api/v1/contacts */
router.post(
  '/',
  requirePermission('contact:write'),
  validate(contactCreateSchema),
  auditAction('CONTACT_CREATE', 'Contact'),
  asyncHandler(async (req, res) => {
    const body = req.body as ContactBody;
    // Şirket verildiyse erişim doğrulanır; verilmediyse kişi bağımsızdır.
    if (body.companyId) await assertCompanyAccess(req.user, body.companyId);

    const contact = await prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          companyId: body.companyId ?? null,
          contactType: body.contactType,
          addressLine: body.addressLine ?? null,
          cityName: body.cityName ?? null,
          country: body.country,
          countryCode: body.countryCode,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          firstName: body.firstName,
          lastName: body.lastName,
          title: body.title ?? null,
          email: body.email || null,
          departmentName: body.departmentName ?? null,
          managerName: body.managerName ?? null,
          website: body.website ?? null,
          sector: body.sector ?? null,
          avatarUrl: body.avatarUrl ?? null,
          linkedinUrl: body.linkedinUrl ?? null,
          notes: body.notes ?? null,
          isPrimary: body.isPrimary,
          birthYear: body.birthYear ?? null,
          birthMonth: body.birthMonth ?? null,
          birthDay: body.birthDay ?? null,
        },
      });
      await syncPhones(tx, created.id, body.phones);
      return tx.contact.findUniqueOrThrow({ where: { id: created.id }, include: contactInclude });
    });

    req.auditContext = { entityType: 'Contact', entityId: contact.id };
    await logActivity({
      type: 'SYSTEM',
      title: `Kişi eklendi: ${contact.firstName} ${contact.lastName}`,
      companyId: contact.companyId, contactId: contact.id, userId: req.user!.id,
    });

    res.status(201).json(contact);
  }),
);

/** PUT /api/v1/contacts/:id */
router.put(
  '/:id',
  requirePermission('contact:write'),
  validate(contactUpdateSchema),
  auditAction('CONTACT_UPDATE', 'Contact'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.contact.findFirst({
      where: {
        id, deletedAt: null,
        OR: [{ companyId: null }, { company: companyScope(req.user) }],
      },
      select: { id: true, companyId: true },
    });
    if (!existing) throw NotFound('Kişi bulunamadı.');

    const body = req.body as Partial<ContactBody>;
    if (body.companyId && body.companyId !== existing.companyId) {
      await assertCompanyAccess(req.user, body.companyId);
    }

    const contact = await prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id },
        data: {
          ...(body.companyId !== undefined ? { companyId: body.companyId ?? null } : {}),
          ...(body.contactType !== undefined ? { contactType: body.contactType } : {}),
          ...(body.addressLine !== undefined ? { addressLine: body.addressLine } : {}),
          ...(body.cityName !== undefined ? { cityName: body.cityName } : {}),
          ...(body.country !== undefined ? { country: body.country } : {}),
          ...(body.countryCode !== undefined ? { countryCode: body.countryCode } : {}),
          ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
          ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
          ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
          ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.email !== undefined ? { email: body.email || null } : {}),
          ...(body.departmentName !== undefined ? { departmentName: body.departmentName } : {}),
          ...(body.managerName !== undefined ? { managerName: body.managerName } : {}),
          ...(body.website !== undefined ? { website: body.website } : {}),
          ...(body.sector !== undefined ? { sector: body.sector } : {}),
          ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
          ...(body.linkedinUrl !== undefined ? { linkedinUrl: body.linkedinUrl } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
          ...(body.birthYear !== undefined ? { birthYear: body.birthYear } : {}),
          ...(body.birthMonth !== undefined ? { birthMonth: body.birthMonth } : {}),
          ...(body.birthDay !== undefined ? { birthDay: body.birthDay } : {}),
        },
      });
      if (body.phones !== undefined) await syncPhones(tx, id, body.phones);
      return tx.contact.findUniqueOrThrow({ where: { id }, include: contactInclude });
    });

    res.json(contact);
  }),
);

/** DELETE /api/v1/contacts/:id/avatar — profil fotoğrafını kaldır. */
router.delete(
  '/:id/avatar',
  requirePermission('contact:write'),
  auditAction('CONTACT_AVATAR_REMOVE', 'Contact'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.contact.findFirst({
      where: {
        id, deletedAt: null,
        OR: [{ companyId: null }, { company: companyScope(req.user) }],
      },
      select: { id: true },
    });
    if (!existing) throw NotFound('Kişi bulunamadı.');

    const contact = await prisma.contact.update({
      where: { id },
      data: { avatarUrl: null },
      include: contactInclude,
    });
    res.json(contact);
  }),
);

/** DELETE /api/v1/contacts/:id — yumuşak silme. */
router.delete(
  '/:id',
  requirePermission('contact:delete'),
  auditAction('CONTACT_DELETE', 'Contact'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.contact.findFirst({
      where: {
        id, deletedAt: null,
        OR: [{ companyId: null }, { company: companyScope(req.user) }],
      },
      select: { id: true, companyId: true, firstName: true, lastName: true },
    });
    if (!existing) throw NotFound('Kişi bulunamadı.');

    await prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    await logActivity({
      type: 'SYSTEM',
      title: `Kişi silindi: ${existing.firstName} ${existing.lastName}`,
      companyId: existing.companyId, userId: req.user!.id,
    });

    res.json({ success: true });
  }),
);

export default router;
