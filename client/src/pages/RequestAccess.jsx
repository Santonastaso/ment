import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/index.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const COMPANY_SIZES = ['1-50', '51-200', '201-1000', '1000+'];

function errorMessage(error) {
  const code = error?.response?.data?.error || error?.message;
  if (code === 'request_already_open') return 'There is already an open request for that email.';
  if (code === 'invalid_email') return 'Use a valid work email address.';
  if (code === 'note_too_long') return 'Keep the note under 2,000 characters.';
  if (code === 'required_fields_missing') return 'Fill out all required fields.';
  return 'Could not submit the request. Please try again.';
}

export default function RequestAccess() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    companySize: '',
    role: '',
    note: '',
    website: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/access-requests', {
        name: form.name,
        email: form.email,
        company: form.company,
        companySize: form.companySize,
        role: form.role,
        note: form.note,
        website: form.website,
      });
      setSubmitted(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="mb-8 flex items-center gap-2">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">M</span>
        <span className="text-xl font-semibold">MENT</span>
      </div>

      <Card className="w-full max-w-[520px] rounded-xl border-[var(--border)] shadow-none">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Request access</CardTitle>
          <CardDescription>Tell us who should own the pilot conversation on your side.</CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>Request received. We will follow up by email.</AlertDescription>
              </Alert>
              <Link to="/login" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                name="website"
                value={form.website}
                onChange={e => update('website', e.target.value)}
                className="hidden"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="request-name">Name</Label>
                  <Input id="request-name" value={form.name} onChange={e => update('name', e.target.value)} autoComplete="name" required autoFocus />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="request-email">Work email</Label>
                  <Input id="request-email" type="email" value={form.email} onChange={e => update('email', e.target.value)} autoComplete="email" required />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="request-company">Company</Label>
                  <Input id="request-company" value={form.company} onChange={e => update('company', e.target.value)} autoComplete="organization" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="request-size">Company size</Label>
                  <select
                    id="request-size"
                    className="input"
                    value={form.companySize}
                    onChange={e => update('companySize', e.target.value)}
                    required
                  >
                    <option value="">Select size</option>
                    {COMPANY_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="request-role">Role</Label>
                <Input id="request-role" value={form.role} onChange={e => update('role', e.target.value)} autoComplete="organization-title" required />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="request-note">Note</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{form.note.length}/2000</span>
                </div>
                <Textarea
                  id="request-note"
                  value={form.note}
                  onChange={e => update('note', e.target.value)}
                  maxLength={2000}
                  className="min-h-28 resize-y"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-3">
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit request'}
                </Button>
                <Link to="/login" className={buttonVariants({ variant: 'link', className: 'w-full' })}>
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
