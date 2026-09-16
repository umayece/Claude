import { prisma } from '../lib/prisma';

/**
 * İnsan okunur belge numarası üretir: IHL-2026-0007 gibi.
 *
 * Numaralar yıl bazında sıfırlanır. Aynı anda gelen iki isteğin aynı numarayı
 * üretmemesi için benzersiz kısıt (schema'daki @unique) son savunmadır;
 * çakışma halinde bir sonraki boşta numara denenir.
 */
export async function nextSequence(prefix: 'TKL' | 'IHL' | 'SZL' | 'TKT'): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const latest = await findLatest(prefix, pattern);
    const next = latest + 1 + attempt;
    const candidate = `${pattern}${String(next).padStart(4, '0')}`;
    if (!(await exists(prefix, candidate))) return candidate;
  }

  // Yoğun eşzamanlılıkta çakışmayı kesin kesen son çare.
  return `${pattern}${Date.now().toString().slice(-6)}`;
}

async function findLatest(prefix: string, pattern: string): Promise<number> {
  const parse = (value: string | undefined): number => {
    if (!value) return 0;
    const parsed = Number.parseInt(value.slice(pattern.length), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  switch (prefix) {
    case 'TKL': {
      const row = await prisma.offer.findFirst({
        where: { offerNumber: { startsWith: pattern } },
        orderBy: { offerNumber: 'desc' },
        select: { offerNumber: true },
      });
      return parse(row?.offerNumber);
    }
    case 'IHL': {
      const row = await prisma.tender.findFirst({
        where: { tenderNumber: { startsWith: pattern } },
        orderBy: { tenderNumber: 'desc' },
        select: { tenderNumber: true },
      });
      return parse(row?.tenderNumber);
    }
    case 'SZL': {
      const row = await prisma.contract.findFirst({
        where: { contractNumber: { startsWith: pattern } },
        orderBy: { contractNumber: 'desc' },
        select: { contractNumber: true },
      });
      return parse(row?.contractNumber);
    }
    default: {
      const row = await prisma.ticket.findFirst({
        where: { ticketNumber: { startsWith: pattern } },
        orderBy: { ticketNumber: 'desc' },
        select: { ticketNumber: true },
      });
      return parse(row?.ticketNumber);
    }
  }
}

async function exists(prefix: string, candidate: string): Promise<boolean> {
  switch (prefix) {
    case 'TKL':
      return (await prisma.offer.count({ where: { offerNumber: candidate } })) > 0;
    case 'IHL':
      return (await prisma.tender.count({ where: { tenderNumber: candidate } })) > 0;
    case 'SZL':
      return (await prisma.contract.count({ where: { contractNumber: candidate } })) > 0;
    default:
      return (await prisma.ticket.count({ where: { ticketNumber: candidate } })) > 0;
  }
}
