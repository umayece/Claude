import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';

export type ActivityType =
  | 'NOTE' | 'CALL' | 'EMAIL' | 'WHATSAPP'
  | 'STAGE_CHANGE' | 'TASK' | 'TICKET' | 'SYSTEM';

export interface ActivityInput {
  type: ActivityType;
  title: string;
  body?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  tenderId?: string | null;
  contractId?: string | null;
  ticketId?: string | null;
  userId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Kronolojik akışa tek bir olay iliştirir.
 * Timeline yazımı ana iş akışını bloklamamalı; çağıranlar bunu `void` ile
 * bekleyebilir ya da atomikliği gerekiyorsa aynı transaction içinde kullanır.
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        tenderId: input.tenderId ?? null,
        contractId: input.contractId ?? null,
        ticketId: input.ticketId ?? null,
        userId: input.userId ?? null,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    console.error('[activity] akışa yazılamadı:', error);
  }
}
