import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';
import { setFacilityTimezone } from '../utils/localDate';
import { clearAllDrafts } from '../hooks/useRecoverableDraft';
import { clearLiveCache } from '../data/liveQuery';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('lab_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Tokens from before the cookie switch are useless now; drop them.
    localStorage.removeItem('lab_token');
    const verifyToken = async () => {
      if (localStorage.getItem('lab_user')) {
        try {
          const { data } = await api.get('/auth/me');
          if (data.success && data.user) {
            const userData = {
              ...data.user,
              first_login: data.first_login || 'N',
            };
            setUser(userData);
            setFacilityTimezone(userData.facilityTimezone || 'Asia/Kolkata');
            localStorage.setItem('lab_user', JSON.stringify(userData));
          } else {
            throw new Error('Invalid session');
          }
        } catch (err) {
          // Only a real "not authenticated" answer ends the session; keep it through
          // network errors, rate limits or a server restart.
          if (err.response?.status === 401 || err.message === 'Invalid session') {
            localStorage.removeItem('lab_user');
            setUser(null);
          }
        }
      }
      setIsInitialized(true);
    };

    verifyToken();
  }, []);

  const login = async (username, password) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      // Another person's unsaved drafts and cached lists never carry over (C2).
      let previous = null;
      try { previous = JSON.parse(localStorage.getItem('lab_user') || 'null'); } catch { /* none */ }
      if (String(previous?.id ?? '') !== String(data.user?.id ?? '')) clearAllDrafts();
      clearLiveCache();
      const userData = {
        ...data.user,
        first_login: data.first_login || 'N',
      };
      localStorage.setItem('lab_user', JSON.stringify(userData));
      setUser(userData);
      setFacilityTimezone(userData.facilityTimezone || 'Asia/Kolkata');
      return { success: true, user: userData, first_login: data.first_login };
    } catch (err) {
      const resp = err.response;
      return {
        success: false,
        message: resp?.data?.message || 'Login failed.',
        status: resp?.status,
        lockedUntil: resp?.data?.lockedUntil,
      };
    } finally {
      setLoading(false);
    }
  };

  // Ends the session on the server (and its live connection), then locally.
  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Already signed out or offline: the local sign-out below still happens.
    }
    localStorage.removeItem('lab_user');
    clearAllDrafts();
    clearLiveCache();
    setUser(null);
  };

  if (!isInitialized) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
