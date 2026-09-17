import crypto from 'node:crypto';
import { env } from '../lib/env';

/**
 * Veritabanında saklanan sırların (API anahtarları vb.) şifrelenmesi.
 *
 * AES-256-GCM kullanılır: hem gizlilik hem bütünlük sağlar. Anahtar,
 * JWT sırlarından türetilir — ayrı bir anahtar yönetimi (KMS) devreye
 * girene kadar bu, sırların veritabanı dökümünde düz metin durmasını
 * engelleyen makul bir alt sınırdır.
 *
 * NOT: Şifreleme anahtarı JWT_ACCESS_SECRET'tan türediği için bu sır
 * değiştirilirse saklanmış API anahtarları çözülemez; kullanıcıya
 * "yeniden girin" denir (sessizce bozuk değer döndürülmez).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function encryptionKey(): Buffer {
  // scrypt ile sabit bir tuzdan 32 baytlık anahtar türetilir.
  return crypto.scryptSync(env.jwt.accessSecret, 'mke-crm-settings-v1', 32);
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:ciphertext — hepsi base64
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

/** Çözülemezse null döner; çağıran "yeniden girin" akışına düşer. */
export function decryptSecret(stored: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = stored.split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) return null;

    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Anahtar değişmiş veya kayıt bozulmuş.
    return null;
  }
}

/** Arayüzde gösterilecek maskeli önizleme: sk-ant-…4f2a */
export function maskSecret(plain: string): string {
  if (plain.length <= 10) return '•'.repeat(plain.length);
  return `${plain.slice(0, 7)}…${plain.slice(-4)}`;
}
