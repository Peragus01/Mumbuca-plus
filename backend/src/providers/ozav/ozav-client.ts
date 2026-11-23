import { ProviderUnavailableError } from '../payment-provider.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OzavHttpResponse {
  status: number;
  body: unknown;
}

export interface OzavClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface OzavClient {
  get(path: string): Promise<OzavHttpResponse>;
  post(path: string, body: unknown, idempotencyKey?: string): Promise<OzavHttpResponse>;
}

/**
 * Minimal OZAV HTTP transport (adapted from Peragus ozav-client.ts: X-API-Key auth, JSON, timeout).
 * Network failures, timeouts and unparseable success bodies surface as ProviderUnavailableError.
 * Error messages never include the API key, request headers or response bodies.
 */
export function createOzavClient(opts: OzavClientOptions): OzavClient {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<OzavHttpResponse> {
    const label = `${method} ${path.split('?')[0]}`;
    const headers: Record<string, string> = { 'X-API-Key': opts.apiKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const kind = err instanceof Error ? err.name : 'error';
      throw new ProviderUnavailableError(`OZAV ${label} failed (${kind})`);
    }
    let parsed: unknown = null;
    try {
      const text = await res.text();
      parsed = text.length ? JSON.parse(text) : null;
    } catch {
      if (res.status >= 200 && res.status < 300) {
        throw new ProviderUnavailableError(`OZAV ${label} returned an unreadable body`);
      }
    }
    return { status: res.status, body: parsed };
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body, idempotencyKey) => request('POST', path, body, idempotencyKey),
  };
}
