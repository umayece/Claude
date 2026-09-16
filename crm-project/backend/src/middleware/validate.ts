import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * Şema doğrulama. Doğrulanmış (ve kırpılmış) değer ilgili alana geri yazılır;
 * böylece rota gövdesi yalnızca şemada tanımlı alanları görür ve
 * kütle atama (mass assignment) ile yetki alanı ezilmesi engellenir.
 */
export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    if (source === 'query') {
      // Express 5'te req.query salt okunur olabilir; türetilmiş değeri ayrı taşırız.
      (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    } else {
      req[source] = result.data as never;
    }
    next();
  };
}

export function validated<T>(req: Request): T {
  return ((req as Request & { validatedQuery?: unknown }).validatedQuery ?? req.query) as T;
}

export type Infer<T extends ZodTypeAny> = z.infer<T>;
