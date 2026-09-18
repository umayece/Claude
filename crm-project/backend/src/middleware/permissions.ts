import type { Role } from '@prisma/client';

/**
 * Tek doğruluk kaynağı: izin matrisi.
 *
 * Kural: yetkiler yalnızca burada TANIMLANIR, rotalarda string olarak
 * yeniden yazılmaz. Rotada serbest metin yazılırsa yazım hatası sessizce
 * "izin verilmiş" anlamına gelebilir; `Permission` birleşim tipi bunu
 * derleme zamanında yakalar.
 */
export const PERMISSIONS = [
  'company:read', 'company:write', 'company:delete', 'company:restore',
  'contact:read', 'contact:write', 'contact:delete',
  'deal:read', 'deal:write', 'deal:delete',
  'offer:read', 'offer:write', 'offer:delete',
  'tender:read', 'tender:write', 'tender:delete',
  'contract:read', 'contract:write', 'contract:delete',
  'product:read', 'product:write', 'product:delete',
  'ticket:read', 'ticket:write', 'ticket:delete',
  'task:read', 'task:write', 'task:delete',
  'email:read', 'email:send',
  'ai:use',
  'audit:read',
  'user:read', 'user:write',
  'protocol:read', 'protocol:write', 'protocol:delete',
  'activity:read', 'activity:write', 'activity:delete',
  'document:read', 'document:write', 'document:delete',
  'settings:read', 'settings:write',
  'customfield:read', 'customfield:write',
  'system:backup',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  'company:read', 'contact:read', 'deal:read', 'offer:read', 'tender:read',
  'contract:read', 'product:read', 'ticket:read', 'task:read', 'email:read',
  'customfield:read', 'protocol:read', 'document:read', 'activity:read',
];

const SALES: Permission[] = [
  ...VIEWER,
  'company:write', 'contact:write', 'deal:write', 'offer:write',
  'tender:write', 'task:write', 'email:send', 'ai:use', 'ticket:write',
  'protocol:write', 'document:write', 'activity:write',
];

const SUPPORT: Permission[] = [
  ...VIEWER,
  'ticket:write', 'ticket:delete', 'task:write', 'contact:write',
  'email:send', 'ai:use', 'document:write', 'activity:write',
];

const MANAGER: Permission[] = [
  ...SALES,
  'company:delete', 'company:restore', 'contact:delete', 'deal:delete',
  'offer:delete', 'tender:delete', 'contract:write', 'contract:delete',
  'product:write', 'product:delete', 'ticket:delete', 'task:delete',
  'audit:read', 'user:read', 'customfield:write',
  'protocol:delete', 'document:delete', 'activity:delete',
];

const ADMIN: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ADMIN,
  MANAGER: dedupe(MANAGER),
  SALES: dedupe(SALES),
  SUPPORT: dedupe(SUPPORT),
  VIEWER: dedupe(VIEWER),
};

function dedupe(list: Permission[]): Permission[] {
  return Array.from(new Set(list));
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/**
 * Rol hiyerarşisi — ayrıcalık yükseltmeyi engellemek için kullanılır.
 * Bir kullanıcı ASLA kendi seviyesinden yüksek bir rol atayamaz.
 */
export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 10,
  SUPPORT: 20,
  SALES: 20,
  MANAGER: 50,
  ADMIN: 100,
};

export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  // Yalnızca ADMIN rol atayabilir ve kendi seviyesini aşan bir rol veremez.
  if (actorRole !== 'ADMIN') return false;
  return ROLE_RANK[targetRole] <= ROLE_RANK[actorRole];
}
