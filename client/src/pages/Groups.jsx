import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { groupPath } from '../lib/conversationLinks.mjs';
import { PageShell } from '../components/PageShell.jsx';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog.jsx';
import { supabase } from '../lib/supabase.js';

function requestExpiryLabel(value, t) {
  const days = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
  if (days === 0) return t('conversations.expiresToday');
  if (days === 1) return t('conversations.expiresOneDay');
  return t('conversations.expiresIn', { days });
}

export default function Groups() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { t } = useT();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [joinTarget, setJoinTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [reviewTarget, setReviewTarget] = useState(null);
  const [requests, setRequests] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [manageTarget, setManageTarget] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [roster, setRoster] = useState({ members: [], candidates: [] });
  const [manageLoading, setManageLoading] = useState(false);
  const [manageSaving, setManageSaving] = useState(false);
  const [manageError, setManageError] = useState('');
  const [rosterRevision, setRosterRevision] = useState(0);

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

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('focus', refresh);
    const channel = supabase.channel('groups-membership')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_join_requests' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, refresh)
      .subscribe();
    return () => { window.removeEventListener('focus', refresh); supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const group = groups.find(item => item.id === Number(params.get('manage')));
    if (!group?.is_owner) return;
    setManageTarget(group);
    setMemberSearch('');
    setManageError('');
    setParams(current => {
      const next = new URLSearchParams(current);
      next.delete('manage');
      return next;
    }, { replace: true });
  }, [groups, params, setParams]);

  useEffect(() => {
    if (!manageTarget) return;
    let cancelled = false;
    setManageLoading(true);
    const timer = setTimeout(async () => {
      const { data, error: rosterError } = await supabase.rpc('group_member_directory', {
        p_group_id: manageTarget.id, p_query: memberSearch.trim() || null,
      });
      if (!cancelled) {
        if (rosterError || !Array.isArray(data?.members) || !Array.isArray(data?.candidates)) {
          setManageError(t('groups.membersError'));
        } else { setRoster(data); setManageError(''); }
        setManageLoading(false);
      }
    }, memberSearch ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [manageTarget?.id, memberSearch, rosterRevision]);

  async function createGroup() {
    if (name.trim().length < 2 || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data: created } = await api.post('/groups', { name: name.trim(), description: description.trim() });
      setManageTarget({ id: created.id, name: name.trim() });
      setMemberSearch('');
      setName('');
      setDescription('');
      await load();
      setCreateOpen(false);
    } catch (e) {
      setError(t('groups.error.save'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleMembership(group) {
    if (saving) return;
    if (group.is_owner) return;
    if (group.joined && !window.confirm(t('groups.confirmLeave', { name: group.name }))) return;
    if (!group.joined && group.join_status !== 'pending') {
      setError(''); setReason(''); setJoinTarget(group);
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (group.joined) {
        await api.delete(`/groups/${group.id}/membership`);
      } else await api.delete(`/groups/${group.id}/join`);
      await load();
    } catch (e) {
      setError(t('groups.error.save'));
    } finally {
      setSaving(false);
    }
  }

  async function requestJoin(event) {
    event.preventDefault();
    if (!reason.trim() || saving) return;
    setSaving(true); setError('');
    try {
      await api.post(`/groups/${joinTarget.id}/join`, { reason: reason.trim() });
      await load(); setJoinTarget(null);
    } catch { setError(t('groups.error.save')); }
    finally { setSaving(false); }
  }

  async function openReview(group) {
    setReviewTarget(group); setRequests([]); setReviewLoading(true); setError('');
    try { const { data } = await api.get(`/groups/${group.id}/requests`); setRequests(data || []); }
    catch { setError(t('groups.error.load')); }
    finally { setReviewLoading(false); }
  }

  async function reviewRequest(request, accept) {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await api.post(`/groups/${reviewTarget.id}/requests`, { user_id: request.user_id, accept });
      setRequests(current => current.filter(item => item.user_id !== request.user_id));
      await load();
    } catch { setError(t('groups.error.save')); }
    finally { setSaving(false); }
  }

  async function changeMember(member, add) {
    if (!manageTarget || manageSaving) return;
    if (!add && !window.confirm(t('groups.confirmRemove', { name: member.name }))) return;
    setManageSaving(true); setManageError('');
    try {
      const { error: changeError } = await supabase.rpc('manage_group_member', {
        p_group_id: manageTarget.id, p_user_id: member.id, p_add: add,
      });
      if (changeError) throw changeError;
      setRosterRevision(current => current + 1);
      await load();
    } catch { setManageError(t('groups.error.save')); }
    finally { setManageSaving(false); }
  }

  return (
    <PageShell>
      <h1 className="sr-only">{t('groups.pageTitle')}</h1>
      <header className="flex min-h-[var(--workspace-top-row)] items-center justify-between">
        <h2 className="text-section-large font-semibold tracking-[-0.02em]">{t('groups.list.title')}</h2>
        <Button type="button" size="icon-lg" aria-label={t('groups.create.title')} title={t('groups.create.title')} onClick={() => { setError(''); setCreateOpen(true); }}><Plus aria-hidden="true" /></Button>
      </header>
      <div>
          {error && !createOpen && !joinTarget && !reviewTarget && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {loading ? (
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
                    {group.is_owner && group.pending_count > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => openReview(group)}>{t('groups.requests', { count: group.pending_count })}</Button>}
                    {group.is_owner && <Button type="button" variant="ghost" size="sm" onClick={() => { setManageTarget(group); setMemberSearch(''); setManageError(''); }}>{t('groups.manageMembers')}</Button>}
                    {group.joined && (
                      <Button variant="ghost" size="sm"
                        type="button"
                        onClick={() => navigate(groupPath(group))}
                      >
                        {t('groups.chat')}
                      </Button>
                    )}
                    {!group.is_owner && <Button variant={group.joined ? 'link' : 'ghost'} size="sm"
                      type="button"
                      disabled={saving}
                      onClick={() => toggleMembership(group)}
                    >
                      {group.joined ? t('groups.leave') : group.join_status === 'pending' ? t('groups.withdraw') : t('groups.requestJoin')}
                    </Button>}
                  </span>
                  {!group.joined && group.join_status && <span className="person-row-detail text-sm text-muted-foreground">{t(`groups.joinStatus.${group.join_status}`)}</span>}
                </article>
              ))}
            </div>
          )}
      </div>

      <Dialog open={createOpen} onOpenChange={open => { if (!saving) setCreateOpen(open); }}>
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
              <Button type="submit" disabled={saving || name.trim().length < 2}>{saving ? t('groups.saving') : t('groups.create.submit')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!joinTarget} onOpenChange={open => { if (!open && !saving) setJoinTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('groups.requestJoin')} · {joinTarget?.name}</DialogTitle><DialogDescription>{t('groups.joinDescription')}</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={requestJoin}>
            <label htmlFor="group-reason" className="label">{t('groups.reason')}</label>
            <textarea id="group-reason" autoFocus className="input min-h-24" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} required />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={saving || !reason.trim()}>{saving ? t('groups.saving') : t('groups.sendRequest')}</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!reviewTarget} onOpenChange={open => { if (!open && !saving) setReviewTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{reviewTarget?.name}</DialogTitle><DialogDescription>{t('groups.reviewDescription')}</DialogDescription></DialogHeader>
          {reviewLoading ? <p role="status">{t('common.loading')}</p> : requests.length === 0 ? <p>{t('groups.noRequests')}</p> : requests.map(request => (
            <article key={request.user_id} className="grid gap-2 border-b py-3">
              <strong>{request.name}</strong><p className="whitespace-pre-wrap text-sm">{request.reason}</p>
              <p className="text-xs text-muted-foreground">{requestExpiryLabel(request.expires_at, t)}</p>
              <div className="flex gap-2"><Button disabled={saving} onClick={() => reviewRequest(request, true)}>{t('groups.approve')}</Button><Button variant="outline" disabled={saving} onClick={() => reviewRequest(request, false)}>{t('groups.decline')}</Button></div>
            </article>
          ))}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!manageTarget} onOpenChange={open => { if (!open && !manageSaving) setManageTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('groups.manageMembers')} · {manageTarget?.name}</DialogTitle><DialogDescription>{t('groups.manageDescription')}</DialogDescription></DialogHeader>
          <label className="label" htmlFor="group-member-search">{t('groups.findMember')}</label>
          <input id="group-member-search" className="input text-sm" value={memberSearch} maxLength={80} onChange={event => setMemberSearch(event.target.value)} placeholder={t('groups.findMemberPlaceholder')} />
          {manageLoading ? <p role="status">{t('common.loading')}</p> : <>
            {memberSearch.trim().length >= 2 && <section className="grid max-h-40 gap-2 overflow-y-auto" aria-label={t('groups.searchResults')}>
              {roster.candidates.map(person => <div key={person.id} className="flex items-center justify-between gap-3"><span>{person.name}</span><Button type="button" size="sm" disabled={manageSaving} onClick={() => changeMember(person, true)}>{t('groups.addMember')}</Button></div>)}
              {roster.candidates.length === 0 && <p className="text-sm text-muted-foreground">{t('groups.noCandidates')}</p>}
            </section>}
            <section className="grid max-h-64 gap-2 overflow-y-auto" aria-label={t('groups.members', { count: roster.members.length })}>
              <p className="label-meta">{t('groups.members', { count: roster.members.length })}</p>
              {roster.members.map(member => <div key={member.id} className="flex items-center justify-between gap-3 border-b py-2"><span>{member.name}{member.is_owner && <small className="ml-2 text-muted-foreground">{t('groups.owner')}</small>}</span>{!member.is_owner && <Button type="button" variant="ghost" size="sm" disabled={manageSaving} onClick={() => changeMember(member, false)}>{t('groups.removeMember')}</Button>}</div>)}
            </section>
          </>}
          {manageError && <p role="alert" className="text-sm text-destructive">{manageError}</p>}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
