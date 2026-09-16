import crypto from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { Unauthorized } from '../lib/errors';

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  email: string;
  role: Role;
  departmentId: string | null;
  /** Kullanıcının oturum nesli. Artırıldığında dağıtılmış tüm token'lar geçersizleşir. */
  tv: number;
  /** MFA tamamlandı mı? false ise yalnızca /mfa/verify çağrılabilir. */
  mfa: boolean;
  jti: string;
}

export interface RefreshTokenClaims extends JwtPayload {
  sub: string;
  tv: number;
  jti: string;
}

const ISSUER = 'mke-crm';
const AUDIENCE = 'mke-crm-client';

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface AccessTokenInput {
  userId: string;
  email: string;
  role: Role;
  departmentId: string | null;
  tokenVersion: number;
  mfaSatisfied: boolean;
}

export function signAccessToken(input: AccessTokenInput): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const options: SignOptions = {
    expiresIn: env.jwt.accessTtl as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: input.userId,
    jwtid: jti,
  };
  const token = jwt.sign(
    {
      email: input.email,
      role: input.role,
      departmentId: input.departmentId,
      tv: input.tokenVersion,
      mfa: input.mfaSatisfied,
    },
    env.jwt.accessSecret,
    options,
  );
  return { token, jti };
}

export function signRefreshToken(userId: string, tokenVersion: number): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const options: SignOptions = {
    expiresIn: env.jwt.refreshTtl as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: userId,
    jwtid: jti,
  };
  const token = jwt.sign({ tv: tokenVersion }, env.jwt.refreshSecret, options);
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.jwt.accessSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as AccessTokenClaims;
  } catch {
    throw Unauthorized('Oturum geçersiz veya süresi dolmuş.');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    return jwt.verify(token, env.jwt.refreshSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as RefreshTokenClaims;
  } catch {
    throw Unauthorized('Yenileme anahtarı geçersiz veya süresi dolmuş.');
  }
}

/** Access token'ı jti bazında kara listeye alır (çıkış / zorla sonlandırma). */
export async function revokeAccessToken(claims: AccessTokenClaims): Promise<void> {
  if (!claims.jti || !claims.exp) return;
  const expiresAt = new Date(claims.exp * 1000);
  await prisma.revokedToken.upsert({
    where: { jti: claims.jti },
    update: { expiresAt },
    create: { jti: claims.jti, userId: claims.sub, expiresAt },
  });
}

export async function isAccessTokenRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return true;
  const hit = await prisma.revokedToken.findUnique({ where: { jti } });
  return hit !== null;
}

/** Süresi dolmuş kara liste kayıtlarını siler; tablo sonsuz büyümez. */
export async function purgeExpiredRevocations(): Promise<number> {
  const result = await prisma.revokedToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
