import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function Login() {
  const { signIn } = useAuth();
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
      setError(err?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="mb-8 flex items-center gap-2">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">M</span>
        <span className="text-xl font-semibold">MENT</span>
      </div>
      <Card className="w-full max-w-[400px] rounded-xl border-[var(--border)] shadow-none">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Sign in</CardTitle>
          <CardDescription>Use the email and temporary password from your HR admin.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
      <div className="mt-4 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
        <p>
          New here?{' '}
          <Link to="/sign-up" className="font-medium text-primary underline-offset-4 hover:underline" data-testid="login-signup-link">
            Start your team
          </Link>
        </p>
        <p>
          Or{' '}
          <Link to="/request-access" className="font-medium text-primary underline-offset-4 hover:underline">
            request a pilot
          </Link>{' '}
          if you'd rather we set it up for you.
        </p>
      </div>
    </div>
  );
}
