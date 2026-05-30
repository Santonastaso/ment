import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { supabase } from '../lib/supabase.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ForcePasswordChange() {
  const { user, session, signOut, refreshProfile } = useAuth();
  const { t } = useT();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 8) { setError(t('auth.forcePassword.error.tooShort')); return; }
    if (next !== confirm) { setError(t('auth.forcePassword.error.mismatch')); return; }
    setLoading(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password: next });
      if (updErr) throw updErr;
      const { error: rpcErr } = await supabase.rpc('complete_password_change');
      if (rpcErr) throw rpcErr;
      await refreshProfile();
      // ChangePasswordRoute will navigate away once must_change_password = false.
    } catch (err) {
      setError(err?.message || t('auth.forcePassword.error.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-[400px] rounded-xl border-[var(--border)] shadow-none">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t('auth.forcePassword.title')}</CardTitle>
          <CardDescription>
            {session?.user?.email && <>{t('auth.forcePassword.account', { email: session.user.email })}</>}
            {t('auth.forcePassword.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="next">{t('auth.forcePassword.newPasswordLabel')}</Label>
              <Input id="next" type="password" value={next} onChange={e => setNext(e.target.value)} minLength={8} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">{t('auth.forcePassword.confirmLabel')}</Label>
              <Input id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? t('auth.forcePassword.submitting') : t('auth.forcePassword.submit')}</Button>
          </form>
          <Button type="button" variant="ghost" className="mt-3 w-full" onClick={signOut}>{t('auth.forcePassword.signOut')}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
