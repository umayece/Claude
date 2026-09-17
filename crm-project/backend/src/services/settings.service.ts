import { prisma } from '../lib/prisma';
import { decryptSecret, encryptSecret, maskSecret } from '../utils/crypto';
import { env } from '../lib/env';

/**
 * Çalışma zamanı ayarları.
 *
 * Öncelik sırası: veritabanındaki kayıt > ortam değişkeni. Böylece yönetici
 * sunucuyu yeniden başlatmadan anahtar girebilir, ancak ortam değişkeniyle
 * kurulmuş dağıtımlar da çalışmaya devam eder.
 */

export const SETTING_KEYS = {
  aiApiKey: 'ai.apiKey',
  aiModel: 'ai.model',
  aiProvider: 'ai.provider',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

const SECRET_KEYS = new Set<string>([SETTING_KEYS.aiApiKey]);

export interface SettingView {
  key: string;
  /** Sır olmayan ayarlarda gerçek değer, sırlarda maskelenmiş önizleme. */
  value: string | null;
  isSecret: boolean;
  isSet: boolean;
  description: string | null;
  updatedAt: Date | null;
  updatedByName: string | null;
  /** Değer ortam değişkeninden mi geliyor (DB'de kayıt yok)? */
  fromEnvironment: boolean;
}

// Sık okunan ayarlar için kısa ömürlü bellek önbelleği: her AI çağrısında
// veritabanına gitmeyi önler, ancak ayar değişimini de geciktirmez.
let cache: { values: Map<string, string>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

function invalidateCache(): void {
  cache = null;
}

async function loadAll(): Promise<Map<string, string>> {
  if (cache && cache.expiresAt > Date.now()) return cache.values;

  const rows = await prisma.systemSetting.findMany();
  const values = new Map<string, string>();

  for (const row of rows) {
    if (row.isSecret) {
      const plain = decryptSecret(row.value);
      // Çözülemeyen sır yok sayılır: bozuk bir değerle API'ye gitmek
      // sessiz 401'lere yol açardı.
      if (plain) values.set(row.key, plain);
    } else {
      values.set(row.key, row.value);
    }
  }

  cache = { values, expiresAt: Date.now() + CACHE_TTL_MS };
  return values;
}

/** Ayarın etkin değeri (DB > ortam değişkeni). */
export async function getSetting(key: SettingKey): Promise<string | null> {
  const values = await loadAll();
  const stored = values.get(key);
  if (stored) return stored;

  switch (key) {
    case SETTING_KEYS.aiApiKey:
      return env.ai.apiKey || null;
    case SETTING_KEYS.aiModel:
      return env.ai.model || null;
    default:
      return null;
  }
}

export async function setSetting(
  key: SettingKey,
  rawValue: string,
  userId: string | null,
  description?: string,
): Promise<void> {
  const isSecret = SECRET_KEYS.has(key);
  const value = isSecret ? encryptSecret(rawValue) : rawValue;

  await prisma.systemSetting.upsert({
    where: { key },
    update: { value, isSecret, updatedById: userId, ...(description ? { description } : {}) },
    create: { key, value, isSecret, updatedById: userId, description: description ?? null },
  });

  invalidateCache();
}

export async function clearSetting(key: SettingKey): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key } });
  invalidateCache();
}

/** Yönetim ekranı için görünüm — sırlar ASLA düz metin dönmez. */
export async function listSettings(): Promise<SettingView[]> {
  const rows = await prisma.systemSetting.findMany({
    include: { updatedBy: { select: { name: true } } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const descriptions: Record<string, string> = {
    [SETTING_KEYS.aiApiKey]: 'AI sağlayıcı API anahtarı (şifreli saklanır).',
    [SETTING_KEYS.aiModel]: 'Kullanılacak model kimliği.',
    [SETTING_KEYS.aiProvider]: 'AI sağlayıcısı: anthropic veya local.',
  };

  return Object.values(SETTING_KEYS).map((key) => {
    const row = byKey.get(key);
    const isSecret = SECRET_KEYS.has(key);

    if (!row) {
      // DB'de yoksa ortam değişkenine bak.
      const envValue =
        key === SETTING_KEYS.aiApiKey ? env.ai.apiKey
        : key === SETTING_KEYS.aiModel ? env.ai.model
        : '';
      return {
        key,
        value: envValue ? (isSecret ? maskSecret(envValue) : envValue) : null,
        isSecret,
        isSet: Boolean(envValue),
        description: descriptions[key] ?? null,
        updatedAt: null,
        updatedByName: null,
        fromEnvironment: Boolean(envValue),
      };
    }

    const plain = isSecret ? decryptSecret(row.value) : row.value;
    return {
      key,
      value: plain === null ? null : isSecret ? maskSecret(plain) : plain,
      isSecret,
      // Çözülemeyen sır "tanımlı değil" sayılır: yönetici yeniden girmeli.
      isSet: plain !== null,
      description: row.description ?? descriptions[key] ?? null,
      updatedAt: row.updatedAt,
      updatedByName: row.updatedBy?.name ?? null,
      fromEnvironment: false,
    };
  });
}
