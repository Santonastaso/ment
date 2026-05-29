import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
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

function friendlyError(code) {
  switch (code) {
    case 'company_name_required': return 'Add a company name.';
    case 'admin_name_required': return 'Add your name.';
    case 'admin_email_invalid': return 'Use a valid email address.';
    case 'password_too_short': return 'Password must be at least 8 characters.';
    case 'password_too_long': return 'Password is too long.';
    case 'email_taken': return 'That email already has an account. Sign in instead.';
    default: return code ? `Could not create your team (${code}). Try again.` : 'Could not create your team. Try again.';
  }
}

export default function SignUp() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
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
        setError(friendlyError(code));
        return;
      }
      if (!data?.organization) {
        setError(friendlyError(data?.error));
        return;
      }
      // Sign the new admin in immediately.
      await signIn(form.admin_email, form.admin_password);
      navigate('/');
    } catch (err) {
      setError(friendlyError(err?.response?.data?.error || err?.message));
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
              <CardTitle className="text-lg font-semibold">Start your team</CardTitle>
              <CardDescription>
                Spin up a new MENT organization. You'll be the first admin and
                can invite colleagues right after.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="company_name">Company name</Label>
              <Input
                id="company_name" type="text" required maxLength={80}
                value={form.company_name}
                onChange={e => update('company_name', e.target.value)}
                placeholder="e.g. Atlas Consulting"
                data-testid="signup-company"
              />
            </div>
            <div>
              <Label htmlFor="admin_name">Your name</Label>
              <Input
                id="admin_name" type="text" required maxLength={80}
                value={form.admin_name}
                onChange={e => update('admin_name', e.target.value)}
                placeholder="First and last name"
                data-testid="signup-name"
              />
            </div>
            <div>
              <Label htmlFor="admin_email">Work email</Label>
              <Input
                id="admin_email" type="email" required
                value={form.admin_email}
                onChange={e => update('admin_email', e.target.value)}
                placeholder="you@company.com"
                data-testid="signup-email"
              />
            </div>
            <div>
              <Label htmlFor="admin_password">Password</Label>
              <Input
                id="admin_password" type="password" required minLength={8}
                value={form.admin_password}
                onChange={e => update('admin_password', e.target.value)}
                placeholder="At least 8 characters"
                data-testid="signup-password"
              />
            </div>
            <div>
              <Label>Privacy mode for the team</Label>
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
                  <p className="font-medium">Intra-company</p>
                  <p className="text-xs text-muted-foreground">Single employer. Full peer profiles visible.</p>
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
                  <p className="font-medium">Inter-company (PMI)</p>
                  <p className="text-xs text-muted-foreground">Cross-company. Surnames, job titles and location hidden.</p>
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
              {submitting ? 'Creating your team…' : 'Create my team'}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
