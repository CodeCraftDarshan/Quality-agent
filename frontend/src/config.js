const TOKEN_STORAGE_KEY = 'auraqc_auth_token';

const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").trim();
const browserOrigin = typeof window !== "undefined" ? window.location.origin : "";
const isLocalBrowserHost = typeof window !== "undefined"
  ? ["localhost", "127.0.0.1"].includes(window.location.hostname)
  : false;
const isConfiguredLocalApi = configuredBaseUrl === "http://localhost:8000";
const localhostFallbackUrls = isConfiguredLocalApi
  ? ["http://127.0.0.1:8011"]
  : [];

export const API_BASE_URL = configuredBaseUrl
  ? (
    // When frontend is accessed through a remote origin (for example a Cloudflare tunnel),
    // forcing localhost would create a browser CORS boundary. Use same-origin instead.
    isConfiguredLocalApi && !isLocalBrowserHost
      ? browserOrigin
      : configuredBaseUrl.replace(/\/+$/, "")
  )
  : (isLocalBrowserHost ? "http://localhost:8000" : browserOrigin);

export const ACTIVE_COPILOT_VERSION = import.meta.env.VITE_COPILOT_VERSION || 'v2';
export const DEFAULT_CLUSTER_ID = import.meta.env.VITE_DEFAULT_CLUSTER_ID || null;
export const DEFAULT_QUERY = import.meta.env.VITE_DEFAULT_QUERY || null;

export function apiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function apiUrlForBase(baseUrl, path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl.replace(/\/+$/, "")}${normalizedPath}`;
}

export async function apiFetch(path, options = {}) {
  let token = '';
  try {
    token = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    // Ignore storage read failures and continue without an auth token.
  }
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (!headers.has('X-Request-ID')) {
    const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    headers.set('X-Request-ID', requestId);
  }

  const requestOptions = {
    ...options,
    headers,
  };

  try {
    const response = await fetch(apiUrl(path), requestOptions);
    if (response.status < 500 || !localhostFallbackUrls.length) {
      return response;
    }
  } catch (primaryError) {
    if (!localhostFallbackUrls.length) {
      throw primaryError;
    }
  }

  for (const fallbackBaseUrl of localhostFallbackUrls) {
    try {
      const fallbackResponse = await fetch(apiUrlForBase(fallbackBaseUrl, path), requestOptions);
      if (fallbackResponse.ok || fallbackResponse.status < 500) {
        return fallbackResponse;
      }
    } catch {
      // Ignore fallback network failures and continue trying the next base URL.
    }
  }

  return fetch(apiUrl(path), requestOptions);
}
