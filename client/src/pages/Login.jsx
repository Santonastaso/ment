import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import LegalLinks from '../components/LegalLinks.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      // AuthProvider's onAuthStateChange + ProtectedRoute handle the redirect.
    } catch (err) {
      setError(err?.message || t('auth.login.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="mb-8 flex items-center gap-2">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">M</span>
        <span className="text-xl font-semibold">MENT</span>
      </div>
      <div className="w-full max-w-[360px]">
        <h1 className="text-xl font-semibold tracking-[-0.025em]">{t('auth.login.title')}</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{t('auth.login.description')}</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.login.emailLabel')}</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('auth.login.emailPlaceholder')} autoComplete="email" required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.login.passwordLabel')}</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.login.submitting') : t('auth.login.submit')}
            </Button>
        </form>
      </div>
      <div className="mt-5 text-center text-sm text-muted-foreground">
        <p>
          {t('auth.login.newHerePrefix')}{' '}
          <Link to="/request-access" className="font-medium text-primary underline-offset-4 hover:underline">
            {t('auth.login.requestPilotLink')}
          </Link>.
        </p>
      </div>
      <LegalLinks className="mt-6" />
    </div>
  );
}
