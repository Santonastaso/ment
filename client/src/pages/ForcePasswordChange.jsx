import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/index.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
    if (next.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (next !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const res = await api.post('/auth/change-password', { current_password: current, new_password: next });
      login(localStorage.getItem('ment_token'), res.data.user);
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
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-[400px] rounded-xl border-[var(--border)] shadow-none">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Set a new password</CardTitle>
          <CardDescription>
            {user?.email && <>Account: {user.email}. </>}
            Replace your temporary password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current">Current password</Label>
              <Input id="current" type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="next">New password</Label>
              <Input id="next" type="password" value={next} onChange={e => setNext(e.target.value)} minLength={8} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Saving…' : 'Update password'}</Button>
          </form>
          <Button type="button" variant="ghost" className="mt-3 w-full" onClick={logout}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}
