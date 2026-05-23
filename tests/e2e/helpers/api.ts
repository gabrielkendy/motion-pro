/**
 * Tiny fetch wrapper used by the e2e specs.
 * Keeps a single base URL and optional Bearer token, returns parsed JSON + status.
 */

export interface ApiOptions {
  baseURL?: string;
  token?: string;
  headers?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: T;
  raw: string;
}

const DEFAULT_BASE = process.env.MV_BASE_URL || 'https://motionpro.vercel.app';

function buildHeaders(opts: ApiOptions, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    'Accept': 'application/json',
    ...(opts.headers || {}),
    ...(extra || {}),
  };
  if (opts.token) h['Authorization'] = `Bearer ${opts.token}`;
  return h;
}

async function parseResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const raw = await res.text();
  let body: any = raw;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json') && raw) {
    try { body = JSON.parse(raw); } catch { /* keep raw */ }
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, ok: res.ok, headers, body: body as T, raw };
}

export class Api {
  private base: string;
  private opts: ApiOptions;

  constructor(opts: ApiOptions = {}) {
    this.opts = opts;
    this.base = (opts.baseURL || DEFAULT_BASE).replace(/\/$/, '');
  }

  withToken(token: string): Api {
    return new Api({ ...this.opts, token });
  }

  async get<T = unknown>(path: string): Promise<ApiResponse<T>> {
    const res = await fetch(this.base + path, {
      method: 'GET',
      headers: buildHeaders(this.opts),
      redirect: 'manual',
    });
    return parseResponse<T>(res);
  }

  async post<T = unknown>(path: string, json?: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: buildHeaders(this.opts, json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    return parseResponse<T>(res);
  }

  async del<T = unknown>(path: string): Promise<ApiResponse<T>> {
    const res = await fetch(this.base + path, {
      method: 'DELETE',
      headers: buildHeaders(this.opts),
    });
    return parseResponse<T>(res);
  }
}

export const api = new Api();
