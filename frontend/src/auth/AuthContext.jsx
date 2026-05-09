import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../config';
import { AuthContext } from './context';

const TOKEN_STORAGE_KEY = 'auraqc_auth_token';
const FALLBACK_ROLE = 'registrar';

function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'developer') return 'admin';
  if (normalized === 'observer') return 'registrar';
  if (normalized === 'viewer') return 'registrar';
  if (normalized === 'qa' || normalized === 'analyst') return 'moderator';
  if (normalized === 'admin' || normalized === 'moderator' || normalized === 'registrar') {
    return normalized;
  }
  return FALLBACK_ROLE;
}

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function storeToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage write failures and keep in-memory auth state.
  }
}

async function fetchMe(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const response = await fetch(apiUrl('/api/me'), { headers });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.detail || payload?.message || '';
    } catch {
      // Ignore JSON parsing issues and fall back to the HTTP status message.
    }
    throw new Error(detail || `Failed to load profile (${response.status})`);
  }
  return response.json();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(FALLBACK_ROLE);
  const [token, setToken] = useState(() => readStoredToken());
  const [loading, setLoading] = useState(true);

  const applyAuthState = useCallback((payload, nextToken) => {
    setUser(payload?.user || null);
    setRole(normalizeRole(payload?.role));
    setToken(nextToken || '');
    storeToken(nextToken || '');
  }, []);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setRole(FALLBACK_ROLE);
    setToken('');
    storeToken('');
  }, []);

  const hydrateFromToken = useCallback(async (nextToken) => {
    if (!nextToken) {
      clearAuthState();
      return null;
    }
    const payload = await fetchMe(nextToken);
    applyAuthState(payload, nextToken);
    return payload;
  }, [applyAuthState, clearAuthState]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoading(true);
      try {
        const nextToken = readStoredToken();

        if (!nextToken) {
          if (active) {
            clearAuthState();
            setLoading(false);
          }
          return;
        }

        await hydrateFromToken(nextToken);
        if (active) {
          setLoading(false);
        }
      } catch {
        if (active) {
          clearAuthState();
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [clearAuthState, hydrateFromToken]);

  const login = useCallback(async (email, password) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();

    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });
      if (!response.ok) {
        let detail = '';
        try {
          const payload = await response.json();
          detail = payload?.detail || payload?.message || '';
        } catch {
          // Ignore JSON parsing issues and fall back to the HTTP status message.
        }
        throw new Error(detail || `Unable to sign in (${response.status})`);
      }
      const loginPayload = await response.json();
      const nextToken = loginPayload?.access_token || '';
      const mePayload = await hydrateFromToken(nextToken);
      return { ok: true, role: mePayload?.role || FALLBACK_ROLE };
    } catch (error) {
      clearAuthState();
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to sign in' };
    } finally {
      setLoading(false);
    }
  }, [clearAuthState, hydrateFromToken]);

  const logout = useCallback(async () => {
    clearAuthState();
  }, [clearAuthState]);

  const value = useMemo(() => ({
    user,
    role,
    token,
    loading,
    login,
    logout,
    isAuthenticated: Boolean(user && token),
  }), [loading, login, logout, role, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
