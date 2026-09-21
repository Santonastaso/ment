import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AcceptInvitation() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (password.length < 12) return setError('Use at least 12 characters.');
    if (password !== confirm) return setError('The passwords do not match.');
    setSubmitting(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('accept-invitation', { body: { token, password } });
      if (invokeError) throw new Error(data?.error || invokeError.message);
      const signIn = await supabase.auth.signInWithPassword({ email: data.email, password });
      if (signIn.error) throw signIn.error;
      navigate('/onboarding', { replace: true });
    } catch (requestError) {
      const code = requestError.message || 'invitation_failed';
      setError(code === 'invitation_invalid_or_expired' ? 'This invitation is invalid or has expired.' : code.replaceAll('_', ' '));
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-shell flex min-h-screen items-center justify-center bg-background p-6">
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Join Ment</CardTitle>
        <CardDescription>Your school has prepared the basics. Set a password, then review your profile.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2"><Label htmlFor="invite-password">Password</Label><Input id="invite-password" type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="invite-confirm">Confirm password</Label><Input id="invite-confirm" type="password" minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Button className="w-full" type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</Button>
          <Link to="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">Already joined? Sign in</Link>
        </form>
      </CardContent>
    </Card>
  </main>;
}
