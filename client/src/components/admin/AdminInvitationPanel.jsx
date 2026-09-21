import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const emptyForm = { email: '', name: '', program: '', cohort_year: '', role: 'student', linkedin_url: '', external_id: '' };

export default function AdminInvitationPanel() {
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
        body: { ...form, cohort_year: form.cohort_year || null, app_origin: window.location.origin },
      });
      if (invokeError) throw new Error(data?.error || invokeError.message);
      setGeneratedUrl(data.invitation_url);
      setForm(emptyForm);
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Could not create invitation.');
    } finally { setSaving(false); }
  }

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); }

  return <section className="mb-6 rounded-2xl bg-muted/60 p-4">
    <div className="mb-4"><h3 className="font-semibold">Invite a member</h3><p className="text-sm text-muted-foreground">Create a single-use link with profile fields prefilled from ESSEC data.</p></div>
    <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={submit}>
      <div><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} required /></div>
      <div><Label htmlFor="invite-name">Name and surname</Label><Input id="invite-name" value={form.name} onChange={(event) => update('name', event.target.value)} required /></div>
      <div><Label htmlFor="invite-program">Course</Label><Input id="invite-program" value={form.program} onChange={(event) => update('program', event.target.value)} /></div>
      <div><Label htmlFor="invite-year">Graduation year</Label><Input id="invite-year" type="number" min="1950" max="2100" value={form.cohort_year} onChange={(event) => update('cohort_year', event.target.value)} /></div>
      <div className="md:col-span-2"><Label htmlFor="invite-linkedin">LinkedIn profile</Label><Input id="invite-linkedin" type="url" value={form.linkedin_url} onChange={(event) => update('linkedin_url', event.target.value)} /></div>
      <div><Label htmlFor="invite-external">ESSEC record ID</Label><Input id="invite-external" value={form.external_id} onChange={(event) => update('external_id', event.target.value)} /></div>
      <div className="flex items-end"><Button className="w-full" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create invitation'}</Button></div>
    </form>
    {generatedUrl && <div className="mt-4 flex items-center gap-2 rounded-xl bg-background p-3"><code className="min-w-0 flex-1 truncate text-xs">{generatedUrl}</code><Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(generatedUrl)}>Copy link</Button></div>}
    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    {invitations.length > 0 && <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">{invitations.slice(0, 8).map((item) => <span className="rounded-full bg-background px-3 py-1.5" key={item.id}>{item.email} · {item.status}</span>)}</div>}
  </section>;
}
