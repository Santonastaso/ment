import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/index.js';

export default function ForcePasswordChange() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/change-password', {
        current_password: current,
        new_password: next,
      });
      const token = localStorage.getItem('ment_token');
      login(token, res.data.user);
      if (res.data.user.is_admin) navigate('/admin');
      else if (!res.data.user.onboarding_complete) navigate('/onboarding');
      else navigate('/');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not update password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy to-navy-light flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">MENT</h1>
          <p className="text-blue-200">Set a new password to continue</p>
        </div>

        <div className="card p-8">
          <h2 className="text-xl font-semibold text-navy mb-2">Password change required</h2>
          <p className="text-sm text-gray-500 mb-6">
            {user?.email ? <>Signed in as <strong>{user.email}</strong>. </> : null}
            Your account uses a temporary password. Choose a new one before using MENT.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Current (temporary) password</label>
              <input type="password" className="input" value={current} onChange={e => setCurrent(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label">New password</label>
              <input type="password" className="input" value={next} onChange={e => setNext(e.target.value)} minLength={8} required />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
              {loading ? 'Saving…' : 'Update password'}
            </button>
          </form>

          <button type="button" onClick={logout} className="mt-4 text-sm text-gray-400 hover:text-navy w-full text-center">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}