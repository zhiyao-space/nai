/** Meoo-managed Alipay runtime. Business code must import ./client instead. */
import Taro from '@tarojs/taro';
import { createClient as createOfficialClient } from '@meoo/supabase-alipay';
import { Headers as CloudHeaders } from 'headers-polyfill';

// The SDK uses Headers internally even when supplied with a custom fetch.
if (typeof globalThis.Headers === 'undefined') {
  globalThis.Headers = CloudHeaders as unknown as typeof Headers;
}

function abortError(): Error {
  const error = new Error('The request was aborted');
  error.name = 'AbortError';
  return error;
}

// Native miniapp transports can surface malformed response header names.
// Keep valid HTTP fields while preserving the status and body for SDK error handling.
const HTTP_FIELD_NAME = /^[-!#$%&'*+.^_\u0060|~0-9A-Za-z]+$/;
function validResponseHeaders(headers: Record<string, string>): CloudHeaders {
  return new CloudHeaders(Object.entries(headers).filter(([name]) => HTTP_FIELD_NAME.test(name)));
}

/** Auth/PostgREST JSON plus ArrayBuffer uploads; responses are text/JSON only. */
export function createAlipayFetch(baseUrl: string): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (typeof input !== 'string' && !(input instanceof URL)) {
      throw new TypeError('Meoo Alipay fetch does not support Request objects');
    }
    // Alipay request supports ArrayBuffer. Client upload still needs device validation.
    // https://opendocs.alipay.com/mini/api/owycmh
    if (init.body != null && typeof init.body !== 'string' && !(init.body instanceof ArrayBuffer)) {
      throw new TypeError('Meoo Alipay fetch supports text/JSON or ArrayBuffer request bodies only');
    }
    if (init.signal?.aborted) throw abortError();
    const url = new URL(String(input), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('Unsupported request protocol');
    const header: Record<string, string> = {};
    new CloudHeaders(init.headers as HeadersInit).forEach((value, name) => { header[name] = value; });
    // my.request only supports GET/POST. The Meoo mp-api gateway restores
    // REST writes and Storage batch deletion, preserving the SDK JSON body/JWT.
    // https://supabase.com/docs/reference/javascript/storage-from-remove
    const method = (init.method || 'GET').toUpperCase();
    const alipayGateway = ['pre-mp-api.meoo.host', 'mp-api.meoo.host'].includes(url.hostname);
    const alipayRest = alipayGateway && new RegExp('^/mp-api/[^/]+/rest/v1/').test(url.pathname);
    const alipayStorageDelete = alipayGateway && method === 'DELETE'
      && new RegExp('^/mp-api/[^/]+/storage/v1/object/[A-Za-z0-9_-]+$').test(url.pathname);
    delete header['x-meoo-alipay-method'];
    if (!['GET', 'POST'].includes(method)) {
      if (!(alipayRest && ['PATCH', 'DELETE'].includes(method)) && !alipayStorageDelete) {
        throw new TypeError(`Meoo Alipay fetch does not support ${method} for this URL`);
      }
      header['x-meoo-alipay-method'] = method;
    }
    const task = Taro.request<string>({
      url: url.href,
      method: (method === 'PATCH' || method === 'DELETE' ? 'POST' : method) as keyof Taro.request.Method,
      header,
      data: init.body ?? undefined,
      dataType: 'text',
    });
    let removeAbortListener = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => { try { task.abort(); } finally { reject(abortError()); } };
      init.signal?.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => init.signal?.removeEventListener('abort', onAbort);
      if (init.signal?.aborted) onAbort();
    });
    let status: number;
    let responseHeaders: Record<string, string>;
    let body: unknown;
    try {
      const response = await Promise.race([task, aborted]);
      status = response.statusCode;
      responseHeaders = response.header;
      body = response.data;
    } catch (error: unknown) {
      if (init.signal?.aborted) throw abortError();
      // Taro 4.2.0 maps success status/headers to statusCode/header, but leaves
      // Alipay failures untouched. https://github.com/NervJS/taro/blob/v4.2.0/packages/taro-platform-alipay/src/apis.ts#L350
      const failure = error as { status?: unknown; headers?: unknown; data?: unknown } | null;
      if (!failure || typeof failure.status !== 'number' || failure.status < 400 || failure.status > 599
        || !Object.prototype.hasOwnProperty.call(failure, 'data')) {
        throw new TypeError('Meoo Alipay network request failed');
      }
      status = failure.status;
      responseHeaders = failure.headers as Record<string, string>;
      body = failure.data;
    } finally {
      removeAbortListener();
    }
    const noBody = status === 204 || status === 205 || init.method?.toUpperCase() === 'HEAD';
    if (!Number.isInteger(status) || status < 100 || status > 599 || (!noBody && body === undefined)
      || !responseHeaders || typeof responseHeaders !== 'object') {
      throw new TypeError('Invalid Alipay HTTP response');
    }
    const text = noBody ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    let consumed = false;
    const consume = () => {
      if (consumed) throw new TypeError('Response body already consumed');
      consumed = true;
      return text;
    };
    const unsupported = async () => { throw new TypeError('Meoo Alipay fetch supports text/JSON responses only'); };
    return {
      ok: status >= 200 && status < 300, status, statusText: '', url: url.href,
      headers: validResponseHeaders(responseHeaders),
      get bodyUsed() { return consumed; },
      text: async () => consume(), json: async () => JSON.parse(consume()),
      arrayBuffer: unsupported, blob: unsupported, formData: unsupported,
      clone: () => { throw new TypeError('Response cloning is not supported'); },
      body: null, redirected: false, type: 'basic',
    } as unknown as Response;
  }) as typeof fetch;
}

// Explicitly unavailable transport through the SDK's supported transport option.
// It never pretends to be a working WebSocket. Realtime is outside this release.
class RealtimeUnavailable {
  constructor() { throw new Error('Meoo Alipay Realtime is not supported'); }
}

type RefreshClient = { auth: { initialize(): Promise<unknown>; startAutoRefresh(): Promise<void>; stopAutoRefresh(): Promise<void> } };
const refreshBindings = new WeakMap<RefreshClient, () => void>();

/** Uses the SDK scheduler; no custom refresh timer/retry/recovery mechanism. */
export function bindAlipayAuthLifecycle(client: RefreshClient): () => void {
  const existing = refreshBindings.get(client);
  if (existing) return existing;
  let disposed = false;
  let foreground = true;
  let pending = Promise.resolve();
  const schedule = () => {
    pending = pending.then(async () => {
      // SDK initialization itself installs visibility handling and may start its
      // ticker. Apply the latest app state only after that work has finished.
      await client.auth.initialize();
      if (foreground && !disposed) await client.auth.startAutoRefresh();
      else await client.auth.stopAutoRefresh();
    }).catch(() => { console.warn('[Meoo Cloud] Auth lifecycle update failed'); });
  };
  const show = () => { foreground = true; schedule(); };
  const hide = () => { foreground = false; schedule(); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    Taro.offAppShow(show);
    Taro.offAppHide(hide);
    refreshBindings.delete(client);
    foreground = false;
    schedule();
  };
  refreshBindings.set(client, dispose);
  Taro.onAppShow(show);
  Taro.onAppHide(hide);
  show();
  return dispose;
}

export const createClient: typeof createOfficialClient = (url, key, options) => {
  const client = createOfficialClient(url, key, {
    ...options,
    auth: {
      ...options?.auth,
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
      storage: {
        getItem: (name: string) => {
          const value = Taro.getStorageSync(name);
          return typeof value === 'string' && value !== '' ? value : null;
        },
        setItem: (name: string, value: string) => { Taro.setStorageSync(name, value); },
        removeItem: (name: string) => { Taro.removeStorageSync(name); },
      },
    },
    global: { ...options?.global, fetch: createAlipayFetch(url) },
    realtime: { ...options?.realtime, transport: RealtimeUnavailable as unknown as typeof WebSocket },
  });
  const dispose = bindAlipayAuthLifecycle(client);
  const hot = (import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } }).hot;
  hot?.dispose(dispose);
  return client;
};
