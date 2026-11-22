import { createContext, useContext, useEffect, useState } from 'react';
import { api, json } from './api';
import { logoutSession } from './authSession';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  useEffect(() => {
    let mounted = true;
    const check = () => api('/health').then(() => mounted && setApiConnected(true)).catch(() => mounted && setApiConnected(false));
    check();
    const timer = window.setInterval(check, 30000);
    api('/auth/me').then((result) => { if (mounted) setUser(result.user); }).catch(() => { if (mounted) setUser(null); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  async function login(email, password) {
    const result = await api('/auth/login', json('POST', { email, password }));
    setUser(result.user);
  }
  async function logout() {
    await logoutSession(api, setUser);
  }
  return <AuthContext.Provider value={{ user, loading, login, logout, apiConnected }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
