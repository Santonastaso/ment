import React, { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Surface, SurfaceBody, SurfaceHeader } from '../Surface.jsx';
import { useT } from '../../i18n/index.jsx';

export default function AdminProvisionUserPanel() {
  const { t } = useT();
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
      setError(requestError.message || t('admin.provision.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function copyCredentials() {
    await navigator.clipboard.writeText(`${t('admin.users.email')}: ${result.email}\n${t('admin.provision.temporaryPassword')}: ${result.temp_password}`);
  }

  return (
    <Surface className="mb-5">
      <SurfaceHeader title={t('admin.provision.title')} description={t('admin.provision.description')} />
      <SurfaceBody className="pt-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Label htmlFor="provision-email">{t('admin.users.email')}</Label>
          <Input id="provision-email" type="email" autoComplete="off" required value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
        </div>
        <div className="min-w-56 flex-1">
          <Label htmlFor="provision-name">{t('admin.provision.fullName')}</Label>
          <Input id="provision-name" autoComplete="off" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </div>
        <Button type="submit" disabled={saving}>{saving ? t('admin.provision.creating') : t('admin.provision.create')}</Button>
      </form>
      {result && <div role="status" className="mt-4 rounded-[var(--item-radius)] bg-muted p-3 text-sm">
        {result.created ? <>
          <p className="font-medium">{t('admin.provision.created')}</p>
          <p className="mt-1">{result.email} · {t('admin.provision.temporaryPassword')}: <code className="select-all font-mono">{result.temp_password}</code></p>
          <Button className="mt-2" type="button" size="sm" variant="outline" onClick={copyCredentials}>{t('admin.provision.copyCredentials')}</Button>
        </> : <p>{t('admin.provision.existing')}</p>}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </SurfaceBody>
    </Surface>
  );
}
