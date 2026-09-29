import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody, SurfaceHeader } from '../components/Surface.jsx';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog.jsx';

export default function Groups() {
  const navigate = useNavigate();
  const { t } = useT();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

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

  async function createGroup() {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/groups', { name: name.trim(), description: description.trim() });
      setName('');
      setDescription('');
      await load();
      setCreateOpen(false);
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
      if (group.joined) {
        await api.delete(`/groups/${group.id}/membership`);
      } else await api.post(`/groups/${group.id}/join`, {});
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || t('groups.error.save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <h1 className="sr-only">{t('groups.pageTitle')}</h1>
      <Surface className="group-list-card overflow-visible rounded-none border-x-0 border-b-0 bg-transparent">
        <SurfaceHeader
          className="items-center px-0 pb-2 pt-0 sm:px-0"
          title={t('groups.list.title')}
          action={<Button type="button" size="icon" className="size-12 rounded-xl" aria-label={t('groups.create.title')} title={t('groups.create.title')} onClick={() => { setError(''); setCreateOpen(true); }}><Plus className="size-6" /></Button>}
        />
        <SurfaceBody className="px-0 pt-2 sm:px-0">
          {loading && groups.length === 0 ? (
            <div role="status" aria-label={t('common.loading')} className="space-y-2">
              {[0, 1, 2].map(index => (
                <div key={index} className="flex items-center gap-3 px-3 py-4">
                  <Skeleton className="size-10 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-52 max-w-full" /></div>
                  <Skeleton className="h-8 w-20 rounded-full" />
                </div>
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('groups.list.empty')}</p>
          ) : (
            <div aria-busy={loading}>
              {groups.map((group) => (
                <article key={group.id} className="person-row">
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
                        className="person-row-action"
                        onClick={() => navigate(`/conversations?group=${group.id}`)}
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('groups.create.title')}</DialogTitle>
            <DialogDescription>{t('groups.create.description')}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createGroup(); }}>
            <div>
              <label className="label" htmlFor="group-name">{t('groups.create.name')}</label>
              <input id="group-name" autoFocus className="input text-sm" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('groups.create.namePlaceholder')} />
            </div>
            <div>
              <label className="label" htmlFor="group-description">{t('groups.create.descriptionLabel')}</label>
              <input id="group-description" className="input text-sm" maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('groups.create.descriptionPlaceholder')} />
            </div>
            {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !name.trim()}>{saving ? t('groups.saving') : t('groups.create.submit')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
