import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/index.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('ment_token');
    if (token) {
      api.get('/users/me')
        .then(res => setUser({
          ...res.data,
          must_change_password: res.data.must_change_password || 0,
        }))
        .catch(() => {
          localStorage.removeItem('ment_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  function login(token, userData) {
    localStorage.setItem('ment_token', token);
    setUser(userData);
  }

  function logout() {
    localStorage.removeItem('ment_token');
    setUser(null);
  }

  function updateUser(partial) {
    setUser(prev => ({ ...prev, ...partial }));
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
