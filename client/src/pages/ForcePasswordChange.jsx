import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { supabase } from '../lib/supabase.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import LegalLinks from '../components/LegalLinks.jsx';

export default function ForcePasswordChange({ recovery = false }) {
  const { session, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(!recovery);
  const [recoveryValid, setRecoveryValid] = useState(false);
  const recoveryAttempt = useRef(null);

  useEffect(() => {
    if (!recovery) return;
    let active = true;
    if (!recoveryAttempt.current) {
      recoveryAttempt.current = (async () => {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (params.get('type') !== 'recovery' || !accessToken || !refreshToken) return false;
        const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (sessionError) return false;
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        return true;
      })();
    }
    recoveryAttempt.current.then(valid => {
      if (!active) return;
      setRecoveryValid(valid);
      if (!valid) setError(t('auth.recovery.invalidLink'));
      setRecoveryReady(true);
    }).catch(() => {
      if (!active) return;
      setError(t('auth.recovery.invalidLink'));
      setRecoveryReady(true);
    });
    return () => { active = false; };
  }, [recovery, t]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 8) { setError(t('auth.forcePassword.error.tooShort')); return; }
    if (next !== confirm) { setError(t('auth.forcePassword.error.mismatch')); return; }
    setLoading(true);
    let passwordSaved = false;
    try {
      if (recovery) {
        const { error: changeError } = await supabase.auth.updateUser({ password: next });
        if (changeError) throw changeError;
        await signOut();
        navigate('/login', { replace: true });
      } else {
        const { error: changeError } = await supabase.functions.invoke('complete-password-change', {
          body: { password: next },
        });
        if (changeError) throw changeError;
        passwordSaved = true;
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: session.user.email,
          password: next,
        });
        if (signInError) throw signInError;
        await refreshProfile();
      }
    } catch {
      setError(t(recovery ? 'auth.recovery.updateError' : passwordSaved ? 'auth.forcePassword.error.signInAgain' : 'auth.forcePassword.error.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <Card className="w-full max-w-[400px]">
        <CardHeader>
      <CardTitle className="text-lg font-medium">{t(recovery ? 'auth.recovery.title' : 'auth.forcePassword.title')}</CardTitle>
          <CardDescription>
            {recovery ? t('auth.recovery.description') : <>{session?.user?.email && <>{t('auth.forcePassword.account', { email: session.user.email })}</>}{t('auth.forcePassword.description')}</>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recovery && !recoveryReady && <p className="mb-4 text-sm text-muted-foreground">{t('auth.recovery.restoring')}</p>}
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
            <Button type="submit" className="w-full" disabled={loading || (recovery && (!recoveryReady || !recoveryValid || !session?.user))}>
              {loading ? t('auth.forcePassword.submitting') : t(recovery ? 'auth.recovery.submit' : 'auth.forcePassword.submit')}
            </Button>
          </form>
          <Button type="button" variant="ghost" className="mt-3 w-full" onClick={async () => { await signOut(); navigate('/login', { replace: true }); }}>
            {t(recovery ? 'auth.recovery.backToSignIn' : 'auth.forcePassword.signOut')}
          </Button>
        </CardContent>
      </Card>
      <LegalLinks className="mt-6" />
    </div>
  );
}
