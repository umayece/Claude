import { PrismaClient } from '@prisma/client';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __crmPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__crmPrisma ??
  new PrismaClient({
    log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!env.isProduction) {
  global.__crmPrisma = prisma;
}
