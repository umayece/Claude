/** Uygulama genelinde tek tip hata sözleşmesi. */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly expose: boolean;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = statusCode < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const BadRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const Unauthorized = (message = 'Kimlik doğrulama gerekli.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const Forbidden = (message = 'Bu işlem için yetkiniz yok.') =>
  new AppError(403, 'FORBIDDEN', message);

export const NotFound = (message = 'Kayıt bulunamadı.') =>
  new AppError(404, 'NOT_FOUND', message);

export const Conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);

export const TooManyRequests = (message = 'Çok fazla deneme yapıldı.') =>
  new AppError(429, 'TOO_MANY_REQUESTS', message);
