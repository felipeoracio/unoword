/** UnoWord backend client for the extension service worker. */
(function attach(scope) {
  const API_BASE = 'https://unoword.vercel.app/api';

  class ApiError extends Error {
    constructor(status, body) {
      super(`request failed with ${status}`);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }

  function headers(json = false) {
    const result = json ? { 'Content-Type': 'application/json' } : {};
    const id = scope.chrome?.runtime?.id;
    if (typeof id === 'string' && /^[a-p]{32}$/.test(id)) result['X-Uno-Extension-Id'] = id;
    return Object.keys(result).length ? result : undefined;
  }

  let refreshRequest=null;
  async function tryRefresh() {
    if(refreshRequest)return refreshRequest;
    refreshRequest=refreshSession().finally(()=>{refreshRequest=null;});return refreshRequest;
  }
  async function refreshSession() {
    try {
      const r = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: headers() });
      return r.ok;
    } catch (_e) {
      return false;
    }
  }

  const NO_REFRESH = new Set(['/auth/refresh', '/auth/login', '/auth/signup', '/auth/logout', '/auth/password/change', '/auth/email/change', '/auth/email/resend', '/auth/recovery', '/auth/recovery/complete', '/auth/email/verify']);

  async function request(path, options = {}, _retried = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 8000);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: options.method || 'GET',
        credentials: 'include',
        headers: headers(options.body !== undefined),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      // A 401 usually means the short-lived access token expired. Transparently
      // refresh once using the persistent refresh cookie, then retry the call,
      // so the user stays signed in across popup reopenings and Chrome restarts.
      if (response.status === 401 && !_retried && !NO_REFRESH.has(path)) {
        clearTimeout(timeout);
        if (await tryRefresh()) return request(path, options, true);
      }
      const body = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(response.status, body);
      return body;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new ApiError(0, { detail: 'offline' });
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, { detail: 'offline' });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function upload(path, formData) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: formData,
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(response.status, body);
      return body;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new ApiError(0, { detail: 'offline' });
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, { detail: 'offline' });
    } finally {
      clearTimeout(timeout);
    }
  }

  const api = {
    API_BASE,
    ApiError,
    get: (path, options = {}) => request(path, options),
    post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body }),
    put: (path, body) => request(path, { method: 'PUT', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    delete: (path) => request(path, { method: 'DELETE' }),
    upload,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  scope.WCApi = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
