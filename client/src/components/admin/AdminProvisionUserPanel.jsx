import React, { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AdminProvisionUserPanel() {
  const [form, setForm] = useState({ email: '', name: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setResult(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-create-user', {
        body: { action: 'create_single', ...form },
      });
      if (invokeError) {
        const details = await invokeError.context?.json?.().catch(() => null);
        throw new Error(details?.error || invokeError.message);
      }
      if (data?.error) throw new Error(data.error);
      setResult(data);
      setForm({ email: '', name: '' });
    } catch (requestError) {
      setError(requestError.message || 'Could not create the account.');
    } finally {
      setSaving(false);
    }
  }

  async function copyCredentials() {
    await navigator.clipboard.writeText(`Email: ${result.email}\nTemporary password: ${result.temp_password}`);
  }

  return (
    <section className="mb-5 rounded-lg border border-border p-4">
      <div className="mb-3">
        <h3 className="font-semibold">Create an account</h3>
        <p className="text-sm text-muted-foreground">No email is sent. New accounts receive a temporary password and must change it at first sign-in.</p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Label htmlFor="provision-email">Email</Label>
          <Input id="provision-email" type="email" autoComplete="off" required value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
        </div>
        <div className="min-w-56 flex-1">
          <Label htmlFor="provision-name">Full name</Label>
          <Input id="provision-name" autoComplete="off" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </div>
        <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create account'}</Button>
      </form>
      {result && <div role="status" className="mt-4 rounded-md bg-muted p-3 text-sm">
        {result.created ? <>
          <p className="font-medium">Account created. No email was sent.</p>
          <p className="mt-1">{result.email} · Temporary password: <code className="select-all font-mono">{result.temp_password}</code></p>
          <Button className="mt-2" type="button" size="sm" variant="outline" onClick={copyCredentials}>Copy credentials</Button>
        </> : <p>Existing Auth account attached to this organization. No email was sent and the password was not changed.</p>}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  );
}
