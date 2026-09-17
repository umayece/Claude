import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Zorunlu ortam değişkeni eksik: ${name}`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

// Üretimde varsayılan sır kullanımı sessizce kabul edilmez.
function secret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 32) {
    if (isProduction) {
      throw new Error(`${name} üretim ortamında en az 32 karakter olmalıdır.`);
    }
    return `dev-only-insecure-${name}-000000000000000000000000`;
  }
  return value;
}

export const env = {
  nodeEnv,
  isProduction,
  port: int('PORT', 4000),
  databaseUrl: required('DATABASE_URL', 'postgresql://crm:crm@localhost:5432/crm?schema=public'),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  jwt: {
    accessSecret: secret('JWT_ACCESS_SECRET'),
    refreshSecret: secret('JWT_REFRESH_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },

  trashRetentionDays: int('TRASH_RETENTION_DAYS', 30),
  enableBackgroundJobs: bool('ENABLE_BACKGROUND_JOBS', true),
  tcmbUrl: process.env.TCMB_URL ?? 'https://www.tcmb.gov.tr/kurlar/today.xml',
  /** İş günü içinde kur çekme aralığı (dakika). */
  exchangeSyncIntervalMinutes: int('EXCHANGE_SYNC_INTERVAL_MINUTES', 30),
  /** TCMB'ye ulaşılamazsa açık kaynak yedeğe düşülsün mü? */
  exchangeFallbackEnabled: bool('EXCHANGE_FALLBACK_ENABLED', true),
  exchangeFallbackUrl:
    process.env.EXCHANGE_FALLBACK_URL ?? 'https://api.frankfurter.app/latest',

  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-opus-5',
  },
} as const;
