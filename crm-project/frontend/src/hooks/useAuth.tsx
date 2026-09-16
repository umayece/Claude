import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactElement, type ReactNode,
} from 'react';
import { api, onUnauthorized, setAccessToken } from '../api/client';
import type { AuthUser } from '../types';

interface LoginResult {
  accessToken: string;
  mfaRequired: boolean;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** İlk oturum çözümlemesi sürüyor mu? */
  initializing: boolean;
  mfaPending: boolean;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  verifyMfa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [mfaPending, setMfaPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const loadProfile = useCallback(async () => {
    const profile = await api.get<AuthUser>('/auth/me');
    if (!mounted.current) return;
    setUser(profile);
    setMfaPending(profile.mfaEnabled === true && profile.mfaSatisfied === false);
  }, []);

  // Sayfa yenilendiğinde httpOnly refresh çerezinden oturumu geri kur.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await api.post<{ accessToken: string }>('/auth/refresh');
        if (cancelled) return;
        setAccessToken(data.accessToken);
        await loadProfile();
      } catch {
        // Geçerli oturum yok; giriş ekranı gösterilir.
        if (!cancelled) setAccessToken(null);
      } finally {
        if (!cancelled && mounted.current) setInitializing(false);
      }
    })();

    return () => { cancelled = true; };
  }, [loadProfile]);

  // Yenileme de başarısız olduysa istemci durumu temizlenir.
  useEffect(() =>
    onUnauthorized(() => {
      if (!mounted.current) return;
      setUser(null);
      setMfaPending(false);
    }), []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResult>('/auth/login', { email, password });
    setAccessToken(result.accessToken);
    setUser(result.user);
    setMfaPending(result.mfaRequired);
    return { mfaRequired: result.mfaRequired };
  }, []);

  const verifyMfa = useCallback(async (code: string) => {
    const result = await api.post<LoginResult>('/mfa/verify', { code });
    setAccessToken(result.accessToken);
    setUser(result.user);
    setMfaPending(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
      setMfaPending(false);
    }
  }, []);

  const can = useCallback(
    (permission: string) => user?.permissions.includes(permission) ?? false,
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, initializing, mfaPending, login, verifyMfa, logout, refreshUser: loadProfile, can }),
    [user, initializing, mfaPending, login, verifyMfa, logout, loadProfile, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth yalnızca <AuthProvider> içinde kullanılabilir.');
  return context;
}
