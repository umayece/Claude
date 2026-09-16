import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { purgeExpiredRevocations } from '../utils/jwt';

export interface CleanupResult {
  cutoff: Date;
  purgedCompanies: number;
  purgedOrphans: Record<string, number>;
  purgedRefreshTokens: number;
  purgedRevokedTokens: number;
  durationMs: number;
}

/**
 * Çöp kutusu temizliği.
 *
 * YETİM KAYIT RİSKİ: şemadaki `onDelete: Cascade` yalnızca şirket
 * SİLİNDİĞİNDE devreye girer. Şirketten bağımsız olarak yumuşak silinmiş
 * fırsat/teklif/sözleşme/kişi kayıtları (şirketi hâlâ ayakta) hiçbir
 * cascade tarafından toplanmaz ve sonsuza dek tabloda kalır. Bu yüzden
 * temizlik iki aşamalıdır:
 *
 *   1) Süresi dolmuş şirketler kalıcı silinir (cascade alt kayıtları alır).
 *   2) Şirketi ayakta olan ama kendisi süresi dolmuş alt kayıtlar ayrıca
 *      taranıp silinir.
 *
 * Ayrıca `Activity` gibi kayıtlar `SetNull` ilişkilerle geride kalabilir;
 * bu yüzden bağlantısız aktivite ve e-posta kayıtları da toplanır.
 */
export async function runTrashCleanup(): Promise<CleanupResult> {
  const started = Date.now();
  const cutoff = new Date(Date.now() - env.trashRetentionDays * 86_400_000);

  // 1) Süresi dolmuş şirketler — cascade zinciri alt kayıtları temizler.
  const expiredCompanies = await prisma.company.findMany({
    where: { deletedAt: { not: null, lt: cutoff } },
    select: { id: true },
    take: 500,
  });

  let purgedCompanies = 0;
  for (const company of expiredCompanies) {
    try {
      await prisma.company.delete({ where: { id: company.id } });
      purgedCompanies += 1;
    } catch (error) {
      // Tek bir kaydın başarısızlığı tüm işi düşürmemeli.
      console.error(`[trashCleanup] şirket silinemedi (${company.id}):`, error);
    }
  }

  // 2) Şirketi ayakta olan yetim alt kayıtlar.
  const expired = { deletedAt: { not: null, lt: cutoff } } as const;
  const purgedOrphans: Record<string, number> = {};

  const [tasks, tickets, contracts, offers, tenders, deals, contacts, products, notes] =
    await prisma.$transaction([
      prisma.task.deleteMany({ where: expired }),
      prisma.ticket.deleteMany({ where: expired }),
      prisma.contract.deleteMany({ where: expired }),
      prisma.offer.deleteMany({ where: expired }),
      prisma.tender.deleteMany({ where: expired }),
      prisma.deal.deleteMany({ where: expired }),
      prisma.contact.deleteMany({ where: expired }),
      prisma.product.deleteMany({ where: expired }),
      prisma.note.deleteMany({ where: expired }),
    ]);

  purgedOrphans.tasks = tasks.count;
  purgedOrphans.tickets = tickets.count;
  purgedOrphans.contracts = contracts.count;
  purgedOrphans.offers = offers.count;
  purgedOrphans.tenders = tenders.count;
  purgedOrphans.deals = deals.count;
  purgedOrphans.contacts = contacts.count;
  purgedOrphans.products = products.count;
  purgedOrphans.notes = notes.count;

  // 3) Hiçbir kayda bağlı olmayan aktiviteler. `SetNull` ilişkiler
  // yüzünden geride kalan bu satırlar zaman tünelinde asla görünmez
  // ama tabloyu şişirir.
  const danglingActivities = await prisma.activity.deleteMany({
    where: {
      companyId: null, contactId: null, dealId: null,
      tenderId: null, contractId: null, ticketId: null,
      createdAt: { lt: cutoff },
    },
  });
  purgedOrphans.activities = danglingActivities.count;

  // 4) Süresi dolmuş kimlik doğrulama kayıtları.
  const refreshTokens = await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
  });
  const revokedTokens = await purgeExpiredRevocations();

  const result: CleanupResult = {
    cutoff,
    purgedCompanies,
    purgedOrphans,
    purgedRefreshTokens: refreshTokens.count,
    purgedRevokedTokens: revokedTokens,
    durationMs: Date.now() - started,
  };

  console.log('[trashCleanup] tamamlandı:', JSON.stringify(result));
  return result;
}

/** Günde bir kez çalışacak zamanlayıcı. */
export function scheduleTrashCleanup(): NodeJS.Timeout {
  const DAY_MS = 24 * 60 * 60 * 1000;
  // İlk çalıştırma açılıştan 2 dakika sonra: başlangıç yükünü sunucunun
  // ayağa kalkmasıyla çakıştırmamak için.
  setTimeout(() => {
    void runTrashCleanup().catch((e) => console.error('[trashCleanup] hata:', e));
  }, 2 * 60_000);

  const timer = setInterval(() => {
    void runTrashCleanup().catch((e) => console.error('[trashCleanup] hata:', e));
  }, DAY_MS);
  timer.unref?.();
  return timer;
}
