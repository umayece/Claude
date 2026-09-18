/**
 * Bildirim havuzu.
 *
 * Zil tek bir uç noktadan beslenir. Farklı kaynaklar (gecikmiş görev,
 * yaklaşan termin) istemcide ayrı ayrı çekilseydi sayaç tutarsız olur ve
 * her kaynak için ayrı bir zil rozeti gerekirdi. Burada hepsi tek bir
 * sıralı listeye indirgeniyor.
 */
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate, requireMfaComplete } from '../middleware/auth';
import { companyScope } from '../middleware/rbac';
import {
  deliveryInfo, deliveryWindowEnd, isDeliveryActionable,
} from '../services/delivery.service';

const router = Router();
router.use(authenticate, requireMfaComplete);

export type NotificationKind = 'TASK_OVERDUE' | 'DELIVERY_DUE' | 'DELIVERY_OVERDUE';

interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Tıklanınca gidilecek uygulama içi yol. */
  href: string;
  /** Sıralama anahtarı: küçük olan daha acil. */
  severity: number;
  dueDate: string | null;
  daysUntil: number | null;
}

/**
 * GET /api/v1/notifications
 *
 * Gecikmiş görevler + termin uyarıları (30/15/7 gün ve gecikenler).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const scope = companyScope(req.user);

    // --- Gecikmiş görevler ---
    // Kullanıcıya atanmış veya atamasız açık görevler; tamamlananlar hariç.
    const taskWhere: Prisma.TaskWhereInput = {
      deletedAt: null,
      status: { not: 'Tamamlandı' },
      dueDate: { lt: now },
      OR: [{ assignedUserId: req.user!.id }, { assignedUserId: null }],
      AND: [{ OR: [{ companyId: null }, { company: scope }] }],
    };

    // --- Termin uyarıları ---
    // Feshedilen/iptal edilen sözleşme uyarı üretmez; teslim edilmiş olanlar
    // `isDeliveryActionable` tarafından elenir.
    const contractWhere: Prisma.ContractWhereInput = {
      deletedAt: null,
      deliveredAt: null,
      status: { notIn: ['Feshedildi', 'Taslak'] },
      deliveryDate: { not: null, lte: deliveryWindowEnd(now) },
      company: scope,
    };

    const [tasks, contracts, taskTotal] = await prisma.$transaction([
      prisma.task.findMany({
        where: taskWhere,
        orderBy: { dueDate: 'asc' },
        take: 25,
        select: {
          id: true, title: true, type: true, dueDate: true,
          companyId: true, company: { select: { name: true } },
        },
      }),
      prisma.contract.findMany({
        where: contractWhere,
        orderBy: { deliveryDate: 'asc' },
        take: 50,
        select: {
          id: true, contractNumber: true, title: true,
          deliveryDate: true, originalDeliveryDate: true, deliveredAt: true,
          company: { select: { id: true, name: true } },
        },
      }),
      prisma.task.count({ where: taskWhere }),
    ]);

    const items: NotificationItem[] = [];

    for (const task of tasks) {
      const due = task.dueDate!;
      const lateDays = Math.max(
        0,
        Math.round((now.getTime() - due.getTime()) / 86_400_000),
      );
      items.push({
        id: `task:${task.id}`,
        kind: 'TASK_OVERDUE',
        title: task.title,
        body: `${task.company?.name ?? 'Genel'} · ${lateDays} gün gecikti`,
        href: task.companyId ? `/companies/${task.companyId}` : '/tasks',
        // Gecikmiş görev, yaklaşan terminden daha acil değildir ama
        // gecikmiş terminle aynı kefede tutulur.
        severity: -lateDays,
        dueDate: due.toISOString(),
        daysUntil: -lateDays,
      });
    }

    for (const contract of contracts) {
      const info = deliveryInfo(contract, now);
      if (!isDeliveryActionable(info)) continue;

      const overdue = info.isOverdue;
      const label = overdue
        ? `${Math.abs(info.daysUntil!)} gün gecikti`
        : info.daysUntil === 0
          ? 'Termin bugün'
          : `Termine ${info.daysUntil} gün kaldı`;

      items.push({
        id: `delivery:${contract.id}`,
        kind: overdue ? 'DELIVERY_OVERDUE' : 'DELIVERY_DUE',
        title: `${contract.contractNumber} — ${contract.title}`,
        body: `${contract.company?.name ?? '—'} · ${label}`
          + (info.slipDays > 0 ? ` · ${info.slipDays} gün revize` : ''),
        href: `/contracts/${contract.id}`,
        severity: info.daysUntil ?? 0,
        dueDate: info.deliveryDate,
        daysUntil: info.daysUntil,
      });
    }

    // En acil en üstte: gecikenler (negatif) önce, sonra yaklaşanlar.
    items.sort((a, b) => a.severity - b.severity);

    res.json({
      data: items,
      meta: {
        total: items.length,
        taskOverdueTotal: taskTotal,
        deliveryTotal: items.filter((i) => i.kind !== 'TASK_OVERDUE').length,
      },
    });
  }),
);

export default router;
