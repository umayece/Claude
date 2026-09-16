/**
 * Merkezi API istemcisi.
 *
 * Sorumlulukları:
 *  - Access token'ı bellekte tutmak (localStorage'a yazmak XSS yüzeyini büyütür;
 *    kalıcı oturum httpOnly refresh çerezinden sağlanır).
 *  - 401 alındığında TEK bir yenileme isteği çalıştırıp bekleyen istekleri
 *    tekrar denemek (eşzamanlı 401'lerde yenileme fırtınası olmaz).
 *  - Hata gövdesini tek tip `ApiError`'a çevirmek.
 */

const BASE_URL = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
const unauthorizedHandlers = new Set<() => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Oturum tamamen düştüğünde (yenileme de başarısız) tetiklenir. */
export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

function notifyUnauthorized(): void {
  accessToken = null;
  for (const handler of unauthorizedHandlers) handler();
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'HTTP_ERROR';
  let message = `İstek başarısız (HTTP ${response.status}).`;
  let details: unknown;

  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body) {
      const err = (body as { error: { code?: string; message?: string; details?: unknown } }).error;
      code = err.code ?? code;
      message = err.message ?? message;
      details = err.details;
    }
  } catch {
    // Gövde JSON değilse varsayılan mesajla devam edilir.
  }

  return new ApiError(response.status, code, message, details);
}

/** Yenileme akışı: aynı anda birden fazla 401 gelse de tek istek gider. */
async function refreshAccessToken(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { accessToken?: string };
      if (!data.accessToken) return false;
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Sonucu yayınladıktan sonra kilidi bırak.
      setTimeout(() => { refreshPromise = null; }, 0);
    }
  })();

  return refreshPromise;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  /** 401 sonrası yeniden deneme kapatılabilir (yenileme ucunun kendisi için). */
  retryOnUnauthorized?: boolean;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, retryOnUnauthorized = true } = options;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    return fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  };

  let response = await send();

  if (response.status === 401 && retryOnUnauthorized) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await send();
    } else {
      notifyUnauthorized();
      throw await parseError(response);
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return (await response.text()) as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),
  post: <T>(path: string, body?: unknown, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'POST', body, query }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Dosya indirme (yedekleme)
// ---------------------------------------------------------------------------

/**
 * Yetkili bir uçtan dosya indirir.
 * `<a download>` doğrudan kullanılamaz: Authorization başlığı taşımaz.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response = await fetch(buildUrl(path), { headers, credentials: 'include' });

  if (response.status === 401 && (await refreshAccessToken())) {
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    response = await fetch(buildUrl(path), { headers, credentials: 'include' });
  }

  if (!response.ok) throw await parseError(response);

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Bellek sızıntısını önlemek için nesne URL'i serbest bırakılır.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// SSE (AI akışı)
// ---------------------------------------------------------------------------

export interface SseHandlers {
  onMeta?: (data: { title: string; contextSummary: string; model: string }) => void;
  onToken?: (text: string) => void;
  onDone?: (data: { characters: number }) => void;
  onError?: (message: string) => void;
}

/**
 * POST gövdeli SSE akışı.
 *
 * Tarayıcının `EventSource` API'si yalnızca GET destekler ve özel başlık
 * taşıyamaz; bu yüzden akış `fetch` + `ReadableStream` ile elle çözülür.
 * Kareler "\n\n" ile ayrılır ve kısmi kare bir sonraki parçaya devredilir.
 */
export async function streamSse(
  path: string,
  body: unknown,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response = await fetch(buildUrl(path), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  });

  if (response.status === 401 && (await refreshAccessToken())) {
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    response = await fetch(buildUrl(path), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
      signal,
    });
  }

  if (!response.ok) {
    const error = await parseError(response);
    handlers.onError?.(error.message);
    throw error;
  }

  if (!response.body) {
    handlers.onError?.('Akış gövdesi alınamadı.');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (frame: string): void => {
    let event = 'message';
    const dataLines: string[] = [];

    for (const line of frame.split('\n')) {
      // ':' ile başlayan satırlar yorumdur (keep-alive kareleri).
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }

    if (dataLines.length === 0) return;

    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }

    switch (event) {
      case 'meta':
        handlers.onMeta?.(payload as { title: string; contextSummary: string; model: string });
        break;
      case 'token':
        handlers.onToken?.((payload as { text: string }).text);
        break;
      case 'done':
        handlers.onDone?.(payload as { characters: number });
        break;
      case 'error':
        handlers.onError?.((payload as { message: string }).message);
        break;
      default:
        break;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        dispatch(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf('\n\n');
      }
    }
    // Akış kapanırken tamponda kalan son kare.
    if (buffer.trim()) dispatch(buffer);
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      handlers.onError?.('Akış beklenmedik şekilde kesildi.');
    }
  } finally {
    reader.releaseLock();
  }
}
