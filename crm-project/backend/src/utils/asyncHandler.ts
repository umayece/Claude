import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Async rota gövdelerindeki reddedilen promise'leri Express hata zincirine taşır.
 * Bu sarmalayıcı olmadan `await` içinde fırlayan hatalar süreçte unhandled rejection olur.
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req as T, res, next).catch(next);
  };
}
