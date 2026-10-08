import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('lab_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const verifyToken = async () => {
      const token = localStorage.getItem('lab_token');
      if (token) {
        try {
          const { data } = await api.get('/auth/me');
          if (data.success && data.user) {
            const userData = {
              ...data.user,
              first_login: data.first_login || 'N',
            };
            setUser(userData);
            localStorage.setItem('lab_user', JSON.stringify(userData));
          } else {
            throw new Error('Invalid session');
          }
        } catch (err) {
          localStorage.removeItem('lab_token');
          localStorage.removeItem('lab_user');
          setUser(null);
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
      localStorage.setItem('lab_token', data.token);
      const userData = {
        ...data.user,
        first_login: data.first_login || 'N',
      };
      localStorage.setItem('lab_user', JSON.stringify(userData));
      setUser(userData);
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

  const logout = () => {
    localStorage.removeItem('lab_token');
    localStorage.removeItem('lab_user');
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
