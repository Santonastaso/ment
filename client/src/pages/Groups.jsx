import React, { useEffect, useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody, SurfaceHeader } from '../components/Surface.jsx';
import { Button } from '@/components/ui/button';
import { Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';

export default function Groups() {
  const { user } = useAuth();
  const { t } = useT();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/groups');
      setGroups(res.data || []);
      setError('');
    } catch {
      setError(t('groups.error.load'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedGroup?.joined) { setMessages([]); return undefined; }
    let active = true;
    const refresh = () => api.get(`/groups/${selectedGroup.id}/messages`)
      .then(({ data }) => { if (active) setMessages(data || []); })
      .catch(() => { if (active) setError(t('groups.error.load')); });
    refresh();
    const channel = supabase.channel(`group-${selectedGroup.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${selectedGroup.id}` }, refresh)
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [selectedGroup?.id, selectedGroup?.joined]);

  async function sendMessage(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !selectedGroup) return;
    setSaving(true); setError('');
    try {
      const { data } = await api.post(`/groups/${selectedGroup.id}/messages`, { body });
      setMessages((items) => items.some((item) => item.id === data.id) ? items : [...items, data]);
      setDraft('');
    } catch (requestError) {
      setError(requestError?.response?.data?.error || t('groups.error.save'));
    } finally { setSaving(false); }
  }

  async function createGroup() {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/groups', { name: name.trim(), description: description.trim() });
      setName('');
      setDescription('');
      await load();
      if (group.joined && selectedGroup?.id === group.id) setSelectedGroup(null);
    } catch (e) {
      setError(e?.response?.data?.error || t('groups.error.save'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleMembership(group) {
    setSaving(true);
    setError('');
    try {
      if (group.joined) await api.delete(`/groups/${group.id}/membership`);
      else await api.post(`/groups/${group.id}/join`, {});
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || t('groups.error.save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell title={t('groups.pageTitle')} description={t('groups.pageDescription')}>
      <Surface className="group-create-card rounded-none border-x-0 border-t-0 bg-transparent">
        <SurfaceHeader className="px-0 pt-0 sm:px-0" title={t('groups.create.title')} description={t('groups.create.description')} />
        <SurfaceBody className="grid gap-3 px-0 pt-4 sm:grid-cols-[minmax(180px,260px)_1fr_auto] sm:items-end sm:px-0">
          {error && <p className="sm:col-span-3 text-sm text-rose-600" role="alert">{error}</p>}
          <div>
            <label className="label" htmlFor="group-name">{t('groups.create.name')}</label>
            <input
              id="group-name"
              className="input text-sm"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('groups.create.namePlaceholder')}
            />
          </div>
          <div>
            <label className="label" htmlFor="group-description">{t('groups.create.descriptionLabel')}</label>
            <input
              id="group-description"
              className="input text-sm"
              maxLength={160}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('groups.create.descriptionPlaceholder')}
            />
          </div>
          <Button type="button" onClick={createGroup} disabled={saving || !name.trim()}>
            {saving ? t('groups.saving') : t('groups.create.submit')}
          </Button>
        </SurfaceBody>
      </Surface>

      <Surface className="group-list-card rounded-none border-x-0 border-b-0 bg-transparent">
        <SurfaceHeader className="px-0 sm:px-0" title={t('groups.list.title')} />
        <SurfaceBody className="px-0 pt-4 sm:px-0">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('groups.list.empty')}</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {groups.map((group) => (
                <div key={group.id} className="group-row flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{group.name}</p>
                    {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('groups.members', { count: group.member_count || 0 })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={group.joined ? 'outline' : 'default'}
                    size="sm"
                    disabled={saving}
                    onClick={() => toggleMembership(group)}
                  >
                    {group.joined ? t('groups.leave') : t('groups.join')}
                  </Button>
                  {group.joined && <Button type="button" size="sm" variant={selectedGroup?.id === group.id ? 'default' : 'outline'} onClick={() => setSelectedGroup(group)}>Chat</Button>}
                </div>
              ))}
            </div>
          )}
        </SurfaceBody>
      </Surface>

      {selectedGroup?.joined && <Surface>
        <SurfaceHeader title={selectedGroup.name} description={selectedGroup.description || 'Group conversation'} />
        <SurfaceBody className="pt-4">
          <div className="flex min-h-80 flex-col gap-2 rounded-2xl bg-muted/40 p-4">
            {messages.length === 0 && <p className="m-auto text-sm text-muted-foreground">No messages yet. Start the conversation.</p>}
            {messages.map((message) => <div key={message.id} className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${message.sender_id === user?.id ? 'ml-auto bg-primary text-primary-foreground' : 'mr-auto bg-background'}`}>
              {message.sender_id !== user?.id && <strong className="mb-1 block text-xs">{message.sender_name}</strong>}
              <p className="whitespace-pre-wrap">{message.body}</p>
              <time className="mt-1 block text-[10px] opacity-60">{new Date(message.created_at).toLocaleString()}</time>
            </div>)}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={sendMessage}>
            <input className="input flex-1" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={6000} placeholder="Message the group" aria-label="Message the group" />
            <Button type="submit" disabled={!draft.trim() || saving} aria-label="Send message"><Send className="size-4" /></Button>
          </form>
        </SurfaceBody>
      </Surface>}
    </PageShell>
  );
}
