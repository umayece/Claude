import { createApp } from './app';
import { env } from './lib/env';
import { prisma } from './lib/prisma';
import { scheduleTrashCleanup } from './jobs/trashCleanup';
import { scheduleExchangeRateSync } from './jobs/exchangeRateSync';

async function main(): Promise<void> {
  await prisma.$connect();
  console.log('[server] veritabanı bağlantısı kuruldu.');

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] MKE CRM API http://localhost:${env.port} üzerinde (${env.nodeEnv})`);
  });

  const timers: NodeJS.Timeout[] = [];
  if (env.enableBackgroundJobs) {
    timers.push(scheduleTrashCleanup(), scheduleExchangeRateSync());
    console.log('[server] arka plan işleri etkin: trashCleanup, exchangeRateSync');
  }

  // Düzgün kapanış: açık isteklerin bitmesine izin verilir, sonra bağlantılar kapanır.
  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} alındı, kapanıyor...`);
    for (const timer of timers) clearInterval(timer);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    // Takılı kalan bağlantılar süreci sonsuza dek açık tutmasın.
    setTimeout(() => process.exit(1), 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[server] başlatılamadı:', error);
  process.exit(1);
});
