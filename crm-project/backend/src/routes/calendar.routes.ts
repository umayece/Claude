import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { BadRequest } from '../lib/errors';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { requirePermission, companyScope } from '../middleware/rbac';
import { validate, validated } from '../middleware/validate';
import { taskScope } from './tasks.routes';

const router = Router();
router.use(authenticate, requireMfaComplete);

export type CalendarEventType =
  | 'TASK' | 'TENDER_DEADLINE' | 'CONTRACT_RENEWAL' | 'BIRTHDAY' | 'MILESTONE';

/** Takvim istemcisinin beklediği tek tip etkinlik sözleşmesi. */
export interface CalendarEvent {
  id: string;
  title: string;
  /** YYYY-AA-GG */
  date: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  type: CalendarEventType;
  priority: string | null;
  status: string | null;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  description: string | null;
  /** İlgili kaydın kendi kimliği — "Detaya git" bağlantısı için. */
  sourceId: string;
  isOverdue: boolean;
}

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  includeTasks: z.coerce.boolean().default(true),
  includeTenders: z.coerce.boolean().default(true),
  includeContracts: z.coerce.boolean().default(true),
  includeBirthdays: z.coerce.boolean().default(false),
  includeMilestones: z.coerce.boolean().default(false),
});
type Query = z.infer<typeof querySchema>;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Doğum günü tarihlerini sorgulanan aralığa yansıtır.
 *
 * Kişide yıl olmayabilir (yalnızca ay/gün girilmiş olabilir); bu yüzden
 * doğum günü bir "yıllık tekrar eden" olay olarak, aralığın kapsadığı HER
 * yıl için ayrı ayrı üretilir.
 */
function birthdayOccurrences(
  month: number,
  day: number,
  from: Date,
  to: Date,
): string[] {
  const dates: string[] = [];
  for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year += 1) {
    // 29 Şubat, artık olmayan yıllarda 28 Şubat'a düşürülür.
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const effectiveDay = month === 2 && day === 29 && !isLeap ? 28 : day;
    const candidate = new Date(Date.UTC(year, month - 1, effectiveDay));
    if (candidate >= from && candidate <= to) dates.push(isoDate(candidate));
  }
  return dates;
}

/**
 * GET /api/v1/calendar
 * Tarih aralığındaki görevler, ihale teslimleri, sözleşme yenilemeleri,
 * hakediş vadeleri ve doğum günlerini tek listede döndürür.
 */
router.get(
  '/',
  requirePermission('task:read'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<Query>(req);
    const { from, to } = query;

    if (to < from) throw BadRequest('Bitiş tarihi başlangıçtan önce olamaz.');
    // Aralık sınırı sorgu maliyetini öngörülebilir tutar.
    const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
    if (spanDays > 400) throw BadRequest('Takvim aralığı en fazla 400 gün olabilir.');

    const events: CalendarEvent[] = [];
    const now = new Date();

    if (query.includeTasks) {
      const tasks = await prisma.task.findMany({
        where: {
          AND: [
            { deletedAt: null },
            taskScope(req.user),
            { dueDate: { gte: from, lte: to } },
          ],
        },
        take: 1000,
        orderBy: { dueDate: 'asc' },
        include: {
          company: { select: { id: true, name: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      for (const task of tasks) {
        if (!task.dueDate) continue;
        events.push({
          id: `task:${task.id}`,
          sourceId: task.id,
          title: task.title,
          date: isoDate(task.dueDate),
          startTime: task.startTime,
          endTime: task.endTime,
          isAllDay: task.isAllDay,
          type: 'TASK',
          priority: task.priority,
          status: task.status,
          companyId: task.companyId,
          companyName: task.company?.name ?? null,
          contactId: task.contactId,
          contactName: task.contact ? `${task.contact.firstName} ${task.contact.lastName}` : null,
          description: task.description,
          isOverdue: task.dueDate < now && task.status !== 'Tamamlandı' && task.status !== 'İptal',
        });
      }
    }

    if (query.includeTenders) {
      const tenders = await prisma.tender.findMany({
        where: {
          AND: [
            { deletedAt: null },
            { company: companyScope(req.user) },
            { submissionDeadline: { gte: from, lte: to } },
          ],
        },
        take: 500,
        include: { company: { select: { id: true, name: true } } },
      });

      for (const tender of tenders) {
        if (!tender.submissionDeadline) continue;
        events.push({
          id: `tender:${tender.id}`,
          sourceId: tender.id,
          title: `İhale Teslimi: ${tender.title}`,
          date: isoDate(tender.submissionDeadline),
          startTime: null,
          endTime: null,
          isAllDay: true,
          type: 'TENDER_DEADLINE',
          priority: 'Yüksek',
          status: tender.status,
          companyId: tender.companyId,
          companyName: tender.company.name,
          contactId: null,
          contactName: null,
          description: `${tender.tenderNumber} — Yaklaşık bedel: ${tender.estimatedValue} ${tender.currency}`,
          isOverdue:
            tender.submissionDeadline < now &&
            !['Kazanıldı', 'Kaybedildi', 'İptal', 'Teklif Verildi'].includes(tender.status),
        });
      }
    }

    if (query.includeContracts) {
      const contracts = await prisma.contract.findMany({
        where: {
          AND: [
            { deletedAt: null },
            { company: companyScope(req.user) },
            { OR: [{ renewalDate: { gte: from, lte: to } }, { endDate: { gte: from, lte: to } }] },
          ],
        },
        take: 500,
        include: { company: { select: { id: true, name: true } } },
      });

      for (const contract of contracts) {
        const date = contract.renewalDate ?? contract.endDate;
        if (!date || date < from || date > to) continue;
        events.push({
          id: `contract:${contract.id}`,
          sourceId: contract.id,
          title: `Sözleşme ${contract.renewalDate ? 'Yenileme' : 'Bitiş'}: ${contract.title}`,
          date: isoDate(date),
          startTime: null,
          endTime: null,
          isAllDay: true,
          type: 'CONTRACT_RENEWAL',
          priority: 'Orta',
          status: contract.status,
          companyId: contract.companyId,
          companyName: contract.company.name,
          contactId: null,
          contactName: null,
          description: `${contract.contractNumber} — ${contract.amount} ${contract.currency}`,
          isOverdue: date < now && contract.status === 'Aktif',
        });
      }
    }

    if (query.includeMilestones) {
      const milestones = await prisma.paymentMilestone.findMany({
        where: {
          dueDate: { gte: from, lte: to },
          contract: { deletedAt: null, company: companyScope(req.user) },
        },
        take: 500,
        include: {
          contract: {
            select: {
              id: true, contractNumber: true, companyId: true,
              company: { select: { id: true, name: true } },
            },
          },
        },
      });

      for (const milestone of milestones) {
        events.push({
          id: `milestone:${milestone.id}`,
          sourceId: milestone.contract.id,
          title: `Hakediş: ${milestone.title}`,
          date: isoDate(milestone.dueDate),
          startTime: null,
          endTime: null,
          isAllDay: true,
          type: 'MILESTONE',
          priority: 'Yüksek',
          status: milestone.status,
          companyId: milestone.contract.companyId,
          companyName: milestone.contract.company.name,
          contactId: null,
          contactName: null,
          description: `${milestone.contract.contractNumber} — ${milestone.amount} ${milestone.currency}`,
          isOverdue: milestone.dueDate < now && milestone.status !== 'Tahsil Edildi',
        });
      }
    }

    if (query.includeBirthdays) {
      const contacts = await prisma.contact.findMany({
        where: {
          AND: [
            { deletedAt: null },
// Bağımsız kişi (companyId = null) hiçbir departmana ait değildir;
            // kurum kapsamı ona uygulanamaz, yetkisi olan herkes görür.
            { OR: [{ companyId: null }, { company: companyScope(req.user) }] },
            { birthMonth: { not: null } },
            { birthDay: { not: null } },
          ],
        },
        take: 2000,
        select: {
          id: true, firstName: true, lastName: true, title: true,
          birthYear: true, birthMonth: true, birthDay: true,
          companyId: true, company: { select: { id: true, name: true } },
        },
      });

      for (const contact of contacts) {
        const occurrences = birthdayOccurrences(contact.birthMonth!, contact.birthDay!, from, to);
        for (const date of occurrences) {
          const age = contact.birthYear
            ? Number.parseInt(date.slice(0, 4), 10) - contact.birthYear
            : null;
          events.push({
            id: `birthday:${contact.id}:${date}`,
            sourceId: contact.id,
            title: `🎂 ${contact.firstName} ${contact.lastName}`,
            date,
            startTime: null,
            endTime: null,
            isAllDay: true,
            type: 'BIRTHDAY',
            priority: null,
            status: null,
            companyId: contact.companyId,
            // Bağımsız kişinin kurumu yoktur; takvimde kişi türü gösterilir.
            companyName: contact.company?.name ?? 'Bağımsız kişi',
            contactId: contact.id,
            contactName: `${contact.firstName} ${contact.lastName}`,
            description: age !== null ? `${age}. yaş günü` : 'Doğum günü',
            isOverdue: false,
          });
        }
      }
    }

    // Aynı gün içinde saatli etkinlikler önce, tüm gün olanlar sonra.
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.isAllDay !== b.isAllDay) return a.isAllDay ? 1 : -1;
      return (a.startTime ?? '').localeCompare(b.startTime ?? '');
    });

    res.json({
      data: events,
      meta: {
        total: events.length,
        from: isoDate(from),
        to: isoDate(to),
        byType: events.reduce<Record<string, number>>((acc, e) => {
          acc[e.type] = (acc[e.type] ?? 0) + 1;
          return acc;
        }, {}),
      },
    });
  }),
);

export default router;
