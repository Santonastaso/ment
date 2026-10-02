import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, Info, MessageCircle, Send, UserRound, UsersRound } from 'lucide-react';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { Field } from '../components/ui/field.jsx';
import { formatMessageTime } from '../lib/utils.js';
import { Button } from '../components/ui/button.jsx';
import { Avatar, AvatarFallback } from '../components/ui/avatar.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import IcsDownloadButton from '../components/IcsDownloadButton.jsx';
import MeetingFeedback from '../components/MeetingFeedback.jsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog.jsx';
import { cn } from '@/lib/utils';
import { supabase } from '../lib/supabase.js';
import { CONVERSATION_FILTERS as FILTERS, conversationState as rowState, isExpired, requestText, clearSentDraft } from '../lib/conversations.mjs';
import { homeCopy } from '../components/demo/homeCopy.js';

function initials(name = '') {
  return name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

function otherPerson(session, viewerId) {
  return session.mentor_id === viewerId ? session.mentee : session.mentor;
}

function expiryInDays(value) {
  const remaining = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remaining)) return 0;
  return Math.max(0, Math.ceil(remaining / 86_400_000));
}

function expiryLabel(days, t) {
  if (days === 0) return t('conversations.expiresToday');
  if (days === 1) return t('conversations.expiresOneDay');
  return t('conversations.expiresIn', { days });
}

function statusLabel(session, t) {
  return isExpired(session) ? t('conversations.status.expired') : t(`conversations.status.${session.status}`, session.status);
}

// Short enough to sit inline beside the name.
function stateLabel(session, state, t) {
  if (state === 'needs') {
    if (session.status === 'pending') return t('conversations.state.reply');
    if (!session.scheduled_at) return t('conversations.state.confirmTime');
    return t('conversations.state.markComplete');
  }
  if (state === 'waiting') return t('conversations.state.awaitingReply');
  if (state === 'scheduled') return formatMessageTime(session.scheduled_at);
  return statusLabel(session, t);
}

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function appendMessage(current, row) {
  return current.some((item) => item.id === row.id) ? current : [...current, row].sort((a, b) => a.id - b.id);
}

export default function Conversations() {
  const { user, unreadCounts, refreshPendingAcceptances, refreshUnreadCounts } = useAuth();
  const { t, lang } = useT();
  const copy = homeCopy(lang);
  const [params, setParams] = useSearchParams();
  const selectedId = Number(params.get('session')) || null;
  const selectedGroupId = Number(params.get('group')) || null;
  const [sessions, setSessions] = useState([]);
  const filter = FILTERS.some(option => option.key === params.get('filter')) ? params.get('filter') : 'all';
  function selectThread(key, id) {
    const next = new URLSearchParams(params);
    next.delete('session'); next.delete('group');
    next.set(key, String(id));
    setParams(next);
  }
  // Sessions the current filter admits, newest meeting first.
  const visibleSessions = useMemo(() => {
    const match = FILTERS.find(option => option.key === filter)?.match ?? (() => true);
    return sessions.filter(session => match(rowState(session)));
  }, [sessions, filter]);
  const showGroups = FILTERS.find(option => option.key === filter)?.groups === true;

  const [groups, setGroups] = useState([]);
  const [messages, setMessages] = useState([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [sendingThreads, setSendingThreads] = useState({});
  const pendingSends = useRef(new Set());
  const threadKey = selectedGroupId ? `group:${selectedGroupId}` : selectedId ? `session:${selectedId}` : '';
  const activeThreadRef = useRef(threadKey);
  activeThreadRef.current = threadKey;
  const draft = drafts[threadKey] || '';
  const sending = !!sendingThreads[threadKey];
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const endRef = useRef(null);
  const messagesRef = useRef(null);
  const preserveScrollRef = useRef(null);
  const senderNamesRef = useRef(new Map());

  const selected = sessions.find((session) => session.id === selectedId) || null;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;
  const person = selected ? otherPerson(selected, user?.id) : null;

  async function loadSessions() {
    const response = await api.get('/sessions');
    const next = response.data || [];
    setSessions(next);
    return next;
  }

  async function loadGroups() {
    const response = await api.get('/groups');
    const next = (response.data || []).filter((group) => group.joined);
    setGroups(next);
    return next;
  }

  async function loadMessages(id, before = null) {
    const query = before ? `?before=${before}` : '';
    const { data } = await api.get(`/sessions/${id}/messages${query}`);
    if (activeThreadRef.current !== `session:${id}`) return;
    if (before) {
      const box = messagesRef.current;
      if (box) preserveScrollRef.current = { height: box.scrollHeight, top: box.scrollTop };
      setMessages((current) => [...data.messages.filter((item) => !current.some((old) => old.id === item.id)), ...current]);
    } else {
      setMessages((current) => [...data.messages, ...current.filter((item) => !data.messages.some((loaded) => loaded.id === item.id))].sort((a, b) => a.id - b.id));
    }
    setHasOlder(data.hasMore);
  }

  async function loadOlderMessages() {
    const oldest = messages[0]?.id;
    if (!selectedId || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    try { await loadMessages(selectedId, oldest); }
    catch (requestError) { setError(requestError.response?.data?.error || t('conversations.error')); }
    finally { setLoadingOlder(false); }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadSessions(), loadGroups()])
      .then(([nextSessions, nextGroups]) => {
        if (cancelled) return;
        if (selectedId && nextSessions.some((item) => item.id === selectedId)) return;
        if (selectedGroupId && nextGroups.some((item) => item.id === selectedGroupId)) return;
        if (params.has('filter')) return;
        if (nextSessions[0]) setParams({ session: String(nextSessions[0].id) }, { replace: true });
        else if (nextGroups[0]) setParams({ group: String(nextGroups[0].id) }, { replace: true });
        else if (selectedId || selectedGroupId) setParams({}, { replace: true });
      })
      .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.error || t('conversations.error')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const refreshGroups = () => loadGroups().catch((requestError) => {
      setError(requestError.response?.data?.error || t('conversations.error'));
    });
    const channel = supabase.channel('conversation-group-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, refreshGroups)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, refreshGroups)
      .subscribe();
    window.addEventListener('focus', refreshGroups);
    return () => {
      window.removeEventListener('focus', refreshGroups);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const refreshSessions = () => loadSessions().catch((requestError) => {
      setError(requestError.response?.data?.error || t('conversations.error'));
    });
    const channel = supabase.channel('conversation-session-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, refreshSessions)
      .subscribe();
    window.addEventListener('focus', refreshSessions);
    return () => {
      window.removeEventListener('focus', refreshSessions);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (selectedGroupId) {
      let cancelled = false;
      setMessages([]);
      setHasOlder(false);
      const refresh = () => api.get(`/groups/${selectedGroupId}/messages`)
        .then(({ data }) => {
          if (cancelled) return;
          (data || []).forEach((item) => senderNamesRef.current.set(item.sender_id, item.sender_name));
          setMessages((current) => [...(data || []), ...current.filter((item) => !(data || []).some((loaded) => loaded.id === item.id))].sort((a, b) => a.id - b.id));
          return api.post(`/groups/${selectedGroupId}/read`, {}).then(refreshUnreadCounts);
        })
        .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.error || t('conversations.error')); });
      refresh();
      const channel = supabase.channel(`group-${selectedGroupId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${selectedGroupId}` }, async ({ new: row }) => {
          let name = row.sender_id === user?.id ? user.name : senderNamesRef.current.get(row.sender_id);
          if (!cancelled) setMessages((current) => appendMessage(current, { ...row, sender_name: name || t('nav.groups') }));
          if (!name) {
            const { data } = await supabase.rpc('peer_profile', { p_user_id: row.sender_id });
            name = data?.name || t('nav.groups');
            senderNamesRef.current.set(row.sender_id, name);
            if (!cancelled) setMessages((current) => current.map((item) => item.id === row.id ? { ...item, sender_name: name } : item));
          }
          if (row.sender_id !== user?.id) api.post(`/groups/${selectedGroupId}/read`, {}).then(refreshUnreadCounts).catch(() => {});
        })
        .subscribe();
      return () => { cancelled = true; supabase.removeChannel(channel); };
    }
    if (!selectedId) { setMessages([]); setHasOlder(false); return undefined; }
    let cancelled = false;
    setMessages([]);
    setHasOlder(false);
    Promise.all([loadMessages(selectedId), api.post(`/sessions/${selectedId}/read`, {})]).then(refreshUnreadCounts).catch((requestError) => {
      if (!cancelled) setError(requestError.response?.data?.error || t('conversations.error'));
    });
    const channel = supabase.channel(`session-${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'session_messages', filter: `session_id=eq.${selectedId}` }, ({ new: row }) => {
        if (cancelled) return;
        setMessages((current) => appendMessage(current, row));
        if (row.sender_id !== user?.id) api.post(`/sessions/${selectedId}/read`, {}).then(refreshUnreadCounts).catch(() => {});
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${selectedId}` }, () => loadSessions())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [selectedId, selectedGroupId]);

  useLayoutEffect(() => {
    const box = messagesRef.current;
    if (box && preserveScrollRef.current) {
      const { height, top } = preserveScrollRef.current;
      box.scrollTop = top + box.scrollHeight - height;
      preserveScrollRef.current = null;
    } else endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, selectedId, selectedGroupId]);
  useEffect(() => {
    setOverviewOpen(false);
    setWithdrawOpen(false);
  }, [threadKey]);
  useEffect(() => {
    if (selectedGroupId) return;
    setScheduleOpen(false);
    setScheduledAt(localDateTime(selected?.scheduled_at));
  }, [selectedId, selectedGroupId, selected?.scheduled_at]);

  useEffect(() => {
    if (!selected?.isMentee || selected.status !== 'scheduled' || selected.mentee_acknowledged_at) return;
    api.post(`/sessions/${selected.id}/acknowledge`, {})
      .then(() => refreshPendingAcceptances())
      .then(() => loadSessions())
      .catch(() => {});
  }, [selected?.id, selected?.status, selected?.mentee_acknowledged_at]);

  async function mutateSession(body) {
    setError('');
    const response = await api.put(`/sessions/${selected.id}`, body);
    setSessions((items) => items.map((item) => item.id === selected.id ? response.data : item));
    await loadSessions();
  }

  async function withdrawRequest() {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      await mutateSession({ status: 'cancelled' });
      setWithdrawOpen(false);
    }
    catch (requestError) { setError(requestError.response?.data?.error || t('conversations.error')); }
    finally { setWithdrawing(false); }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const body = draft.trim();
    const key = threadKey;
    const sentDraft = draft;
    const endpoint = selectedGroup ? `/groups/${selectedGroup.id}/messages` : selected ? `/sessions/${selected.id}/messages` : null;
    if (!body || !endpoint || pendingSends.current.has(key)) return;
    pendingSends.current.add(key);
    setSendingThreads(items => ({ ...items, [key]: true }));
    setError('');
    try {
      const response = await api.post(endpoint, { body });
      if (activeThreadRef.current === key) setMessages(items => appendMessage(items, response.data));
      setDrafts(items => clearSentDraft(items, key, sentDraft));
      if (selected) await loadSessions();
    } catch (requestError) {
      if (activeThreadRef.current === key) setError(requestError.response?.data?.error || t('conversations.error'));
    } finally {
      pendingSends.current.delete(key);
      setSendingThreads(items => { const next = { ...items }; delete next[key]; return next; });
    }
  }

  async function saveSchedule() {
    if (!scheduledAt) return;
    setSavingSchedule(true);
    try {
      await mutateSession({ scheduled_at: new Date(scheduledAt).toISOString() });
      setScheduleOpen(false);
    } catch (requestError) {
      setError(requestError.response?.data?.error || t('conversations.error'));
    } finally { setSavingSchedule(false); }
  }

  if (loading) return (
    <div className="conversations-shell" role="status" aria-label={t('common.loading')}>
      <aside className="conversation-list space-y-3 p-4">
        <Skeleton className="mb-6 h-6 w-28" />
        {[0, 1, 2, 3].map(index => (
          <div key={index} className="flex items-center gap-3 py-2">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
          </div>
        ))}
      </aside>
      <div className="conversation-loading">
        <div className="space-y-3"><Skeleton className="h-5 w-44" /><Skeleton className="h-4 w-64" /></div>
      </div>
    </div>
  );

  return (
    <section className={cn('conversations-shell', (selectedId || selectedGroupId) && 'has-selection')}>
      <aside className="conversation-list" aria-label={t('conversations.title')}>
        <header><h1>{t('conversations.title')}</h1><span>{sessions.length + groups.length}</span></header>
        {(sessions.length > 0 || groups.length > 0) && (
          <div className="conversation-filters" role="group" aria-label={t('conversations.filter.label')}>
            {FILTERS.map(option => {
              const count = option.key === 'all'
                ? sessions.length + groups.length
                : option.key === 'groups'
                  ? groups.length
                  : sessions.filter(s => option.match(rowState(s))).length;
              return (
                <Button
                  key={option.key}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={filter === option.key}
                  onClick={() => setParams({ filter: option.key })}
                >
                  {t(option.label)}<span className="conversation-filter-count">{count}</span>
                </Button>
              );
            })}
          </div>
        )}
        <div className="conversation-list-scroll">
        {sessions.length === 0 && groups.length === 0 ? (
          <div className="conversation-empty">
            <MessageCircle />
            <strong>{t('conversations.emptyTitle')}</strong>
            <p>{t('conversations.emptyBody')}</p>
            <Link to="/explorer">{t('conversations.findPeople')}</Link>
          </div>
        ) : <>
          {visibleSessions.map((session) => {
            const peer = otherPerson(session, user?.id);
            const state = rowState(session);
            const unreadCount = unreadCounts.sessionMessages[session.id] || 0;
            return (
            <button key={session.id} type="button" onClick={() => selectThread('session', session.id)} className={cn('conversation-list-item', session.id === selectedId && 'is-active')}>
              <Avatar className="size-9"><AvatarFallback>{initials(peer?.name)}</AvatarFallback></Avatar>
              <span className="min-w-0">
                {/* Who, what state, when — the scannable line. */}
                <span className="conversation-list-top">
                  <strong>{peer?.name}</strong>
                  <em className={`conversation-state is-${state}`}>{stateLabel(session, state, t)}</em>
                </span>
                {/* What they actually asked about. */}
                <small>{requestText(session.title, t('conversations.requestTitle'))}</small>
              </span>
              {unreadCount > 0 && <span className="conversation-unread-badge" aria-label={t('conversations.unreadCount', { count: unreadCount })}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
          );
        })}
        {showGroups && groups.map((group) => (
          <button key={`group-${group.id}`} type="button" onClick={() => selectThread('group', group.id)} className={cn('conversation-list-item', group.id === selectedGroupId && 'is-active')}>
            <Avatar className="size-9"><AvatarFallback><UsersRound className="size-4" /></AvatarFallback></Avatar>
            <span className="min-w-0">
              <span className="conversation-list-top">
                <strong>{group.name}</strong>
              </span>
            <small>{group.description || t('nav.groups')}</small>
          </span>
          {(unreadCounts.groupMessages[group.id] || 0) > 0 && <span className="conversation-unread-badge" aria-label={t('conversations.unreadCount', { count: unreadCounts.groupMessages[group.id] })}>{unreadCounts.groupMessages[group.id] > 99 ? '99+' : unreadCounts.groupMessages[group.id]}</span>}
        </button>
        ))}
        {!visibleSessions.length && !(showGroups && groups.length) && filter !== 'all' && (
          <p className="conversation-list-empty">{t('conversations.filter.empty')}</p>
        )}
        </>}
        </div>
      </aside>

      <div key={selectedGroup ? `group-${selectedGroup.id}` : selected ? `session-${selected.id}` : 'empty'} className="conversation-thread">
        {!selected && !selectedGroup ? (
          <div className="conversation-placeholder"><MessageCircle /><p>{t('conversations.select')}</p></div>
        ) : (
          <>
            {selectedGroup ? <header className="conversation-header">
              <button className="conversation-back" type="button" onClick={() => setParams({})} aria-label={t('common.close')}><ChevronLeft /></button>
              <Avatar className="size-9"><AvatarFallback><UsersRound className="size-4" /></AvatarFallback></Avatar>
              <div><strong>{selectedGroup.name}</strong><span>{selectedGroup.description || t('nav.groups')}</span></div>
            </header> : <header className="conversation-header">
              <button className="conversation-back" type="button" onClick={() => setParams({})} aria-label={t('common.close')}><ChevronLeft /></button>
              <Avatar className="size-9"><AvatarFallback>{initials(person?.name)}</AvatarFallback></Avatar>
              <div className="conversation-header-person"><strong>{person?.name}</strong><span>{selected.status === 'pending' && !isExpired(selected) && selected.isMentee ? t('conversations.requestSent') : stateLabel(selected, rowState(selected), t)}</span></div>
              <div className="conversation-header-actions">
                {selected.status === 'scheduled' && selected.scheduled_at && <IcsDownloadButton sessionId={selected.id} session={selected} meetingUrl={selected.meeting_url} onReschedule={() => { setOverviewOpen(true); setScheduleOpen(true); }} compact />}
                {(selected.status === 'scheduled' || selected.status === 'completed') && <MeetingFeedback key={selected.id} session={selected} onSaved={loadSessions} compact />}
                <Button type="button" variant="ghost" size="icon" onClick={() => setOverviewOpen(true)} aria-label={t('conversations.requestDetails')} title={t('conversations.requestDetails')} aria-haspopup="dialog"><Info aria-hidden="true" /></Button>
              </div>
            </header>}

            <div className="conversation-messages" ref={messagesRef}>
              {hasOlder && <Button type="button" variant="ghost" size="sm" className="mx-auto mb-4 flex" disabled={loadingOlder} onClick={loadOlderMessages}>{t('conversations.loadOlder')}</Button>}
              {messages.map((message) => message.kind === 'system' || message.kind === 'schedule' ? (
                <div className="conversation-system" key={message.id}>{message.body}</div>
              ) : (
                <div className={cn('conversation-message', (message.sender_id === user?.id || (message.kind === 'request' && selected.isMentee)) ? 'is-mine' : 'is-theirs')} key={message.id}>
                  {selectedGroup && message.sender_id !== user?.id && <strong>{message.sender_name}</strong>}<p>{message.kind === 'request' ? requestText(message.body, t('conversations.requestTitle')) : message.body}</p><time>{formatMessageTime(message.created_at)}</time>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <form className="conversation-composer" onSubmit={sendMessage}>
              <input value={draft} onChange={(event) => setDrafts(items => ({ ...items, [threadKey]: event.target.value }))} placeholder={t('conversations.messagePlaceholder')} maxLength={6000} aria-label={t('conversations.messagePlaceholder')} />
              <Button type="submit" size="icon" disabled={!draft.trim() || sending} aria-label={t('conversations.send')}><Send /></Button>
            </form>
          </>
        )}
        {error && <p className="conversation-error" role="alert">{error}</p>}
      </div>
      {selected && <Dialog open={overviewOpen} onOpenChange={value => { setOverviewOpen(value); if (!value) setScheduleOpen(false); }}>
        <DialogContent className="conversation-overview sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('conversations.requestDetails')}</DialogTitle>
            <DialogDescription>{person?.name}</DialogDescription>
          </DialogHeader>
          <div className="conversation-overview-body">
            <h2>{requestText(selected.title, t('conversations.requestTitle'))}</h2>
            <div className="conversation-overview-pills">
              <span>{statusLabel(selected, t)}</span>
              {selected.follow_up_intent && <span>{selected.follow_up_intent === 'ongoing' ? copy.ongoing : copy.oneOff}</span>}
            </div>
            {selected.pre_session_question && selected.pre_session_question.trim() !== selected.title?.trim() && <p className="conversation-overview-question">{requestText(selected.pre_session_question)}</p>}
            {selected.topics?.length > 0 && <div>
              <p className="label-meta">{t('components.sessionRequest.reviewTopics')}</p>
              <div className="conversation-overview-pills">{selected.topics.map(topic => <span key={topic}>{topic}</span>)}</div>
            </div>}
            {selected.status === 'pending' && !isExpired(selected) && selected.request_expires_at && <p className="text-sm text-muted-foreground">{expiryLabel(expiryInDays(selected.request_expires_at), t)}</p>}
            <div>
              <p className="label-meta">{t('components.sessionRequest.reviewWhen')}</p>
              <p className="text-sm">{selected.scheduled_at ? formatMessageTime(selected.scheduled_at) : t('components.sessionRequest.reviewNoTime')}</p>
              {selected.status === 'scheduled' && !scheduleOpen && <Button size="sm" variant="ghost" className="mt-3" onClick={() => setScheduleOpen(true)}>{t(selected.scheduled_at ? 'conversations.reschedule' : 'conversations.schedule')}</Button>}
            </div>
            {selected.status === 'scheduled' && scheduleOpen && <div className="conversation-scheduler">
              <Field label={t('conversations.newTime')} type="datetime-local" value={scheduledAt} min={localDateTime(new Date(Date.now() + 3600000))} onChange={event => setScheduledAt(event.target.value)} />
              <Button size="sm" onClick={saveSchedule} disabled={!scheduledAt || savingSchedule}>{t('common.save')}</Button>
              <Button size="sm" variant="ghost" disabled={savingSchedule} onClick={() => setScheduleOpen(false)}>{t('common.cancel')}</Button>
            </div>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="conversation-overview-footer">
            <Button variant="ghost" size="sm" render={<Link to={`/profile/${person?.id}`} />}><UserRound aria-hidden="true" />{t('conversations.profile')}</Button>
            {selected.status === 'pending' && !isExpired(selected) && selected.isMentee && <Button type="button" variant="danger" size="sm"  onClick={() => { setOverviewOpen(false); setWithdrawOpen(true); }}>{t('conversations.withdraw')}</Button>}
            {selected.status === 'pending' && !isExpired(selected) && selected.isMentor && <>
              <Button size="sm" variant="danger"  onClick={() => mutateSession({ status: 'declined' }).catch(() => setError(t('conversations.error')))}>{t('conversations.decline')}</Button>
              <Button size="sm" onClick={() => mutateSession({ status: 'scheduled' }).catch(() => setError(t('conversations.error')))}><Check aria-hidden="true" />{t('conversations.accept')}</Button>
            </>}
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      <Dialog open={withdrawOpen} onOpenChange={value => { if (!withdrawing) setWithdrawOpen(value); }}>
        <DialogContent className="conversation-overview" showCloseButton={!withdrawing}>
          <DialogHeader>
            <DialogTitle>{t('conversations.withdrawConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('conversations.withdrawConfirmBody')}</DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="conversation-overview-footer">
            <Button type="button" size="sm" variant="ghost" disabled={withdrawing} onClick={() => setWithdrawOpen(false)}>{t('conversations.keepRequest')}</Button>
            <Button type="button" size="sm" variant="danger"  disabled={withdrawing} onClick={withdrawRequest}>{t('conversations.withdraw')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
