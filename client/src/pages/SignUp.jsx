import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { supabase } from '../lib/supabase.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Public org self-signup.
// Creates a brand new organization + admin user via the `public-signup`
// edge function, then signs the user in and ships them straight to the
// dashboard. Used by the "Start your team" CTA on /login and /request-access.

function friendlyError(t, code) {
  switch (code) {
    case 'company_name_required': return t('auth.signup.error.companyNameRequired');
    case 'admin_name_required': return t('auth.signup.error.adminNameRequired');
    case 'admin_email_invalid': return t('auth.signup.error.adminEmailInvalid');
    case 'password_too_short': return t('auth.signup.error.passwordTooShort');
    case 'password_too_long': return t('auth.signup.error.passwordTooLong');
    case 'email_taken': return t('auth.signup.error.emailTaken');
    default: return code ? t('auth.signup.error.genericWithCode', { code }) : t('auth.signup.error.generic');
  }
}

export default function SignUp() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const { t } = useT();
  const [form, setForm] = useState({
    company_name: '',
    admin_name: '',
    admin_email: '',
    admin_password: '',
    org_type: 'inter',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Synchronous guard: setSubmitting is async, so a fast double-click could
  // fire two requests before the disabled state lands. This ref blocks the
  // second call immediately.
  const inFlight = useRef(false);

  function update(k, v) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setError('');
    setSubmitting(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('public-signup', {
        body: form,
      });
      if (invokeError) {
        // Try to parse a JSON error body from the function response.
        let code = invokeError.message || 'unknown_error';
        try {
          const txt = await invokeError.context?.text?.();
          if (txt) {
            const j = JSON.parse(txt);
            code = j?.error || code;
          }
        } catch { /* ignore */ }
        setError(friendlyError(t, code));
        return;
      }
      if (!data?.organization) {
        setError(friendlyError(t, data?.error));
        return;
      }
      // Sign the new admin in immediately.
      await signIn(form.admin_email, form.admin_password);
      navigate('/');
    } catch (err) {
      setError(friendlyError(t, err?.response?.data?.error || err?.message));
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-semibold">{t('auth.signup.title')}</CardTitle>
              <CardDescription>
                {t('auth.signup.description')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="company_name">{t('auth.signup.companyLabel')}</Label>
              <Input
                id="company_name" type="text" required maxLength={80}
                value={form.company_name}
                onChange={e => update('company_name', e.target.value)}
                placeholder={t('auth.signup.companyPlaceholder')}
                data-testid="signup-company"
              />
            </div>
            <div>
              <Label htmlFor="admin_name">{t('auth.signup.nameLabel')}</Label>
              <Input
                id="admin_name" type="text" required maxLength={80}
                value={form.admin_name}
                onChange={e => update('admin_name', e.target.value)}
                placeholder={t('auth.signup.namePlaceholder')}
                data-testid="signup-name"
              />
            </div>
            <div>
              <Label htmlFor="admin_email">{t('auth.signup.emailLabel')}</Label>
              <Input
                id="admin_email" type="email" required
                value={form.admin_email}
                onChange={e => update('admin_email', e.target.value)}
                placeholder={t('auth.signup.emailPlaceholder')}
                data-testid="signup-email"
              />
            </div>
            <div>
              <Label htmlFor="admin_password">{t('auth.signup.passwordLabel')}</Label>
              <Input
                id="admin_password" type="password" required minLength={8}
                value={form.admin_password}
                onChange={e => update('admin_password', e.target.value)}
                placeholder={t('auth.signup.passwordPlaceholder')}
                data-testid="signup-password"
              />
            </div>
            <div>
              <Label>{t('auth.signup.privacyModeLabel')}</Label>
              <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => update('org_type', 'intra')}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    form.org_type === 'intra'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 bg-white hover:bg-muted/40'
                  }`}
                >
                  <p className="font-medium">{t('auth.signup.intraTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('auth.signup.intraDescription')}</p>
                </button>
                <button
                  type="button"
                  onClick={() => update('org_type', 'inter')}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    form.org_type === 'inter'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 bg-white hover:bg-muted/40'
                  }`}
                >
                  <p className="font-medium">{t('auth.signup.interTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('auth.signup.interDescription')}</p>
                </button>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={submitting}
              data-testid="signup-submit"
              className="w-full"
            >
              {submitting ? t('auth.signup.submitting') : t('auth.signup.submit')}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              {t('auth.signup.haveAccount')} <Link to="/login" className="text-primary hover:underline">{t('auth.signup.signInLink')}</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
