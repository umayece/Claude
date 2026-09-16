import { BadRequest } from '../lib/errors';

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Sayfalama her liste ucunda zorunludur. Üst sınır sunucu tarafında
 * sabitlenir; istemci `pageSize=100000` göndererek tabloyu dökemez.
 */
export function parsePagination(query: Record<string, unknown>): PageParams {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const requested = Number.parseInt(String(query.pageSize ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  if (requested < 1) throw BadRequest('pageSize 1 veya daha büyük olmalıdır.');
  const pageSize = Math.min(requested, MAX_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function paginated<T>(data: T[], total: number, params: PageParams): Paginated<T> {
  return {
    data,
    meta: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    },
  };
}

/** Beyaz listeye dayalı sıralama — ham kullanıcı girdisi orderBy'a geçmez. */
export function parseSort<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): { field: T; direction: 'asc' | 'desc' } {
  const input = String(raw ?? '');
  const desc = input.startsWith('-');
  const field = (desc ? input.slice(1) : input) as T;
  return {
    field: allowed.includes(field) ? field : fallback,
    direction: desc ? 'desc' : input ? 'asc' : 'desc',
  };
}

/**
 * Beyaz listeye dayalı, TİPLİ orderBy nesnesi üretir.
 *
 * `{ [sort.field]: sort.direction }` şeklinde hesaplanan bir anahtar,
 * TypeScript'te `{ [x: string]: 'asc' | 'desc' }` (indeks imzası) tipine
 * genişler ve Prisma'nın `OrderByWithRelationInput` tipine atanamaz.
 * Burada dönen `Partial<Record<T, ...>>` ise yapısal olarak uyumludur.
 */
export function buildOrderBy<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): Partial<Record<T, 'asc' | 'desc'>> {
  const { field, direction } = parseSort(raw, allowed, fallback);
  return { [field]: direction } as Partial<Record<T, 'asc' | 'desc'>>;
}
