import React, { useEffect, useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody, SurfaceHeader } from '../components/Surface.jsx';
import { Button } from '@/components/ui/button';

export default function Groups() {
  const { t } = useT();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      <Surface className="group-create-card">
        <SurfaceHeader title={t('groups.create.title')} description={t('groups.create.description')} />
        <SurfaceBody className="grid gap-3 pt-5 sm:grid-cols-[minmax(180px,260px)_1fr_auto] sm:items-end">
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

      <Surface className="group-list-card">
        <SurfaceHeader title={t('groups.list.title')} />
        <SurfaceBody className="pt-5">
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
                </div>
              ))}
            </div>
          )}
        </SurfaceBody>
      </Surface>
    </PageShell>
  );
}
