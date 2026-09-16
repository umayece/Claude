import bcrypt from 'bcryptjs';
import { BadRequest } from '../lib/errors';

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Kullanıcı sayımı düşük olduğunda e-posta bulunamadı durumunda da
 * bcrypt maliyetini ödeyerek zamanlama sızıntısını (user enumeration) engeller.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7K.5TpzR0pJaJT0hVJ2VvVwVlKK1Bq2';

export async function burnTiming(): Promise<void> {
  await bcrypt.compare('invalid-password-placeholder', DUMMY_HASH);
}

export function assertPasswordStrength(plain: string): void {
  if (plain.length < 10) {
    throw BadRequest('Şifre en az 10 karakter olmalıdır.');
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(plain)).length;
  if (classes < 3) {
    throw BadRequest('Şifre küçük harf, büyük harf, rakam ve sembolden en az üçünü içermelidir.');
  }
}
