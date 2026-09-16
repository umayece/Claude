import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { env } from '../lib/env';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Uç nokta bulunamadı: ${req.method} ${req.path}` },
  });
}

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  stack?: string;
}

/**
 * Merkezi hata yakalayıcı.
 * İç hata metinleri (Prisma sorgu gövdeleri, stack) istemciye sızdırılmaz;
 * 5xx durumunda istemci genel bir mesaj alır, ayrıntı yalnızca loga yazılır.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let status = 500;
  const body: ErrorBody = { code: 'INTERNAL_ERROR', message: 'Beklenmeyen bir hata oluştu.' };

  if (err instanceof AppError) {
    status = err.statusCode;
    body.code = err.code;
    body.message = err.message;
    if (err.details !== undefined) body.details = err.details;
  } else if (err instanceof ZodError) {
    status = 422;
    body.code = 'VALIDATION_ERROR';
    body.message = 'Gönderilen veri doğrulanamadı.';
    body.details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        status = 409;
        body.code = 'DUPLICATE';
        body.message = `Bu kayıt zaten mevcut (${(err.meta?.target as string[] | undefined)?.join(', ') ?? 'benzersiz alan'}).`;
        break;
      case 'P2003':
        status = 409;
        body.code = 'FK_CONSTRAINT';
        body.message = 'İlişkili kayıtlar olduğu için işlem tamamlanamadı.';
        break;
      case 'P2025':
        status = 404;
        body.code = 'NOT_FOUND';
        body.message = 'Kayıt bulunamadı.';
        break;
      default:
        status = 400;
        body.code = 'DATABASE_ERROR';
        body.message = 'Veritabanı isteği işlenemedi.';
    }
  } else if (err instanceof SyntaxError && 'body' in err) {
    status = 400;
    body.code = 'INVALID_JSON';
    body.message = 'İstek gövdesi geçerli JSON değil.';
  }

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    if (!env.isProduction && err instanceof Error) body.stack = err.stack;
  }

  if (res.headersSent) return;
  res.status(status).json({ error: body });
}
