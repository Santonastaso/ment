import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ForcePasswordChange() {
  const { user, session, signOut, refreshProfile } = useAuth();
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
      const { error: updErr } = await supabase.auth.updateUser({ password: next });
      if (updErr) throw updErr;
      const { error: rpcErr } = await supabase.rpc('complete_password_change');
      if (rpcErr) throw rpcErr;
      await refreshProfile();
      // ChangePasswordRoute will navigate away once must_change_password = false.
    } catch (err) {
      setError(err?.message || 'Could not update password.');
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
            {session?.user?.email && <>Account: {session.user.email}. </>}
            Replace your temporary password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="next">New password</Label>
              <Input id="next" type="password" value={next} onChange={e => setNext(e.target.value)} minLength={8} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Saving…' : 'Update password'}</Button>
          </form>
          <Button type="button" variant="ghost" className="mt-3 w-full" onClick={signOut}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}
