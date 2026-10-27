import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Surface, SurfaceBody, SurfaceHeader } from '../Surface.jsx';
import { useT } from '../../i18n/index.jsx';

const emptyForm = { email: '', name: '', program: '', cohort_year: '', role: 'student', linkedin_url: '', external_id: '' };

export default function AdminInvitationPanel() {
  const { t } = useT();
  const [form, setForm] = useState(emptyForm);
  const [invitations, setInvitations] = useState([]);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data, error: loadError } = await supabase.rpc('my_invitations');
    if (!loadError) setInvitations(data || []);
  }
  useEffect(() => { load(); }, []);

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError(''); setGeneratedUrl('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-create-invitation', {
        body: { ...form, cohort_year: form.cohort_year || null },
      });
      if (invokeError) throw new Error(data?.error || invokeError.message);
      setGeneratedUrl(data.invitation_url);
      setForm(emptyForm);
      await load();
    } catch (requestError) {
      setError(requestError.message || t('admin.invitation.createFailed'));
    } finally { setSaving(false); }
  }

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); }

  return <Surface className="mb-5">
    <SurfaceHeader title={t('admin.invitation.title')} description={t('admin.invitation.description')} />
    <SurfaceBody className="pt-3">
    <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={submit}>
      <div><Label htmlFor="invite-email">{t('admin.users.email')}</Label><Input id="invite-email" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} required /></div>
      <div><Label htmlFor="invite-name">{t('admin.invitation.fullName')}</Label><Input id="invite-name" value={form.name} onChange={(event) => update('name', event.target.value)} required /></div>
      <div><Label htmlFor="invite-program">{t('admin.invitation.course')}</Label><Input id="invite-program" value={form.program} onChange={(event) => update('program', event.target.value)} /></div>
      <div><Label htmlFor="invite-year">{t('admin.invitation.graduationYear')}</Label><Input id="invite-year" type="number" min="1950" max="2100" value={form.cohort_year} onChange={(event) => update('cohort_year', event.target.value)} /></div>
      <div className="md:col-span-2"><Label htmlFor="invite-linkedin">{t('admin.invitation.linkedin')}</Label><Input id="invite-linkedin" type="url" value={form.linkedin_url} onChange={(event) => update('linkedin_url', event.target.value)} /></div>
      <div><Label htmlFor="invite-external">{t('admin.invitation.recordId')}</Label><Input id="invite-external" value={form.external_id} onChange={(event) => update('external_id', event.target.value)} /></div>
      <div className="flex items-end"><Button className="w-full" type="submit" disabled={saving}>{saving ? t('admin.invitation.creating') : t('admin.invitation.create')}</Button></div>
    </form>
    {generatedUrl && <div className="mt-4 flex items-center gap-2 rounded-[var(--item-radius)] bg-background p-3"><code className="min-w-0 flex-1 truncate text-xs">{generatedUrl}</code><Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(generatedUrl)}>{t('admin.invitation.copyLink')}</Button></div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {invitations.length > 0 && <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">{invitations.slice(0, 8).map((item) => <Badge key={item.id} variant="secondary">{item.email} · {item.status}</Badge>)}</div>}
    </SurfaceBody>
  </Surface>;
}
