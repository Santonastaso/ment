import React, { useEffect, useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { formatMessageTime } from '../lib/utils.js';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody, SurfaceHeader } from '../components/Surface.jsx';
import { Button } from '@/components/ui/button';
import { Send, Users } from 'lucide-react';
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
            <div>
              {groups.map((group) => (
                <article key={group.id} className={`person-row ${selectedGroup?.id === group.id ? 'is-selected' : ''}`}>
                  <span className="person-row-avatar group-row-mark" aria-hidden="true">
                    <Users className="size-4" />
                  </span>

                  <span className="person-row-identity">
                    <span className="person-row-name">{group.name}</span>
                    <span className="person-row-role">
                      {[group.description, t('groups.members', { count: group.member_count || 0 })]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>

                  <span className="person-row-actions">
                    {group.joined && (
                      <button
                        type="button"
                        className={`person-row-action ${selectedGroup?.id === group.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedGroup(group)}
                      >
                        {t('groups.chat')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={group.joined ? 'person-row-link' : 'person-row-action'}
                      disabled={saving}
                      onClick={() => toggleMembership(group)}
                    >
                      {group.joined ? t('groups.leave') : t('groups.join')}
                    </button>
                  </span>
                </article>
              ))}
            </div>
          )}
        </SurfaceBody>
      </Surface>

      {selectedGroup?.joined && <Surface>
        <SurfaceHeader title={selectedGroup.name} description={selectedGroup.description || t('groups.chatSubtitle')} />
        <SurfaceBody className="pt-4">
          <div className="flex min-h-80 flex-col gap-2 rounded-2xl bg-muted/40 p-4">
            {messages.length === 0 && <p className="m-auto text-sm text-muted-foreground">{t('groups.chatEmpty')}</p>}
            {/* Same bubbles as the Messages tab and the discovery transcript. */}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`conversation-message ${message.sender_id === user?.id ? 'is-mine' : 'is-theirs'}`}
              >
                {message.sender_id !== user?.id && <strong>{message.sender_name}</strong>}
                <p>{message.body}</p>
                <time>{formatMessageTime(message.created_at)}</time>
              </div>
            ))}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={sendMessage}>
            <input className="input flex-1" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={6000} placeholder={t('groups.chatPlaceholder')} aria-label={t('groups.chatPlaceholder')} />
            <Button type="submit" disabled={!draft.trim() || saving} aria-label={t('groups.chatSend')}><Send className="size-4" /></Button>
          </form>
        </SurfaceBody>
      </Surface>}
    </PageShell>
  );
}
