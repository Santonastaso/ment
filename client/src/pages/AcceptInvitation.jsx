import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '../i18n/index.jsx';

export default function AcceptInvitation() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { t } = useT();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (password.length < 12) return setError(t('auth.invitation.error.passwordTooShort'));
    if (password !== confirm) return setError(t('auth.invitation.error.passwordMismatch'));
    setSubmitting(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('accept-invitation', { body: { token, password } });
      if (invokeError) throw new Error(data?.error || invokeError.message);
      const signIn = await supabase.auth.signInWithPassword({ email: data.email, password });
      if (signIn.error) throw signIn.error;
      navigate('/onboarding', { replace: true });
    } catch (requestError) {
      setError(requestError.message === 'invitation_invalid_or_expired'
        ? t('auth.invitation.error.invalidOrExpired')
        : t('auth.invitation.error.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-shell flex min-h-screen items-center justify-center bg-background p-6">
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('auth.invitation.title')}</CardTitle>
        <CardDescription>{t('auth.invitation.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2"><Label htmlFor="invite-password">{t('auth.invitation.passwordLabel')}</Label><Input id="invite-password" type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="invite-confirm">{t('auth.invitation.confirmLabel')}</Label><Input id="invite-confirm" type="password" minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Button className="w-full" type="submit" disabled={submitting}>{submitting ? t('auth.invitation.submitting') : t('auth.invitation.submit')}</Button>
          <Link to="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">{t('auth.invitation.signIn')}</Link>
        </form>
      </CardContent>
    </Card>
  </main>;
}
