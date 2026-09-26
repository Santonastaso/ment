import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, ChevronLeft, MessageCircle, Send, UsersRound } from 'lucide-react';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { Field } from '../components/ui/field.jsx';
import { formatMessageTime } from '../lib/utils.js';
import { Button } from '../components/ui/button.jsx';
import { Avatar, AvatarFallback } from '../components/ui/avatar.jsx';
import IcsDownloadButton from '../components/IcsDownloadButton.jsx';
import { cn } from '@/lib/utils';
import { supabase } from '../lib/supabase.js';

function initials(name = '') {
  return name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

function otherPerson(session, viewerId) {
  return session.mentor_id === viewerId ? session.mentee : session.mentor;
}

function statusLabel(status, t) {
  return t(`conversations.status.${status}`, status);
}

// A meeting is a state of a conversation, not a separate object, so the list
// carries it. `needs` is what the viewer can act on right now — that is the
// whole of an alumnus's job here, and the sidebar badge counts it.
function rowState(session) {
  if (session.status === 'pending') return session.isMentor ? 'needs' : 'waiting';
  if (session.status === 'scheduled') {
    if (!session.scheduled_at) return 'needs';
    if (new Date(session.scheduled_at) < new Date() && !session.viewer_completed) return 'needs';
    return 'scheduled';
  }
  if (session.status === 'completed') return 'past';
  return 'closed';
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
  return statusLabel(session.status, t);
}

// `match` selects sessions; `groups` says whether group threads belong in the
// view. Groups reuses the nav label rather than inventing a second word for
// the same thing.
const FILTERS = [
  { key: 'all', label: 'conversations.filter.all', match: () => true, groups: true },
  { key: 'needs', label: 'conversations.filter.needsYou', match: s => s === 'needs' },
  { key: 'scheduled', label: 'conversations.filter.scheduled', match: s => s === 'scheduled' },
  { key: 'past', label: 'conversations.filter.past', match: s => s === 'past' || s === 'closed' },
  { key: 'groups', label: 'nav.groups', match: () => false, groups: true },
];

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function Conversations() {
  const { user, refreshPendingAcceptances } = useAuth();
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const selectedId = Number(params.get('session')) || null;
  const selectedGroupId = Number(params.get('group')) || null;
  const [sessions, setSessions] = useState([]);
  const [filter, setFilter] = useState('all');
  // Sessions the current filter admits, newest meeting first.
  const visibleSessions = useMemo(() => {
    const match = FILTERS.find(option => option.key === filter)?.match ?? (() => true);
    return sessions.filter(session => match(rowState(session)));
  }, [sessions, filter]);
  const showGroups = FILTERS.find(option => option.key === filter)?.groups === true;

  const [groups, setGroups] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const endRef = useRef(null);

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

  async function loadMessages(id) {
    if (!id) return;
    const response = await api.get(`/sessions/${id}/messages`);
    setMessages(response.data || []);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadSessions(), loadGroups()])
      .then(([nextSessions, nextGroups]) => {
        if (cancelled) return;
        if (selectedId && nextSessions.some((item) => item.id === selectedId)) return;
        if (selectedGroupId && nextGroups.some((item) => item.id === selectedGroupId)) return;
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
    if (selectedGroupId) {
      let cancelled = false;
      setMessages([]);
      const refresh = () => api.get(`/groups/${selectedGroupId}/messages`)
        .then(({ data }) => { if (!cancelled) setMessages(data || []); })
        .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.error || t('conversations.error')); });
      refresh();
      const channel = supabase.channel(`group-${selectedGroupId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${selectedGroupId}` }, refresh)
        .subscribe();
      return () => { cancelled = true; supabase.removeChannel(channel); };
    }
    if (!selectedId) { setMessages([]); return undefined; }
    let cancelled = false;
    const refresh = () => Promise.all([loadMessages(selectedId), api.post(`/sessions/${selectedId}/read`, {})]).catch((requestError) => {
      if (!cancelled) setError(requestError.response?.data?.error || t('conversations.error'));
    });
    refresh();
    const channel = supabase.channel(`session-${selectedId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_messages', filter: `session_id=eq.${selectedId}` }, () => refresh())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${selectedId}` }, () => loadSessions())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [selectedId, selectedGroupId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, selectedId, selectedGroupId]);
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
    await Promise.all([loadSessions(), loadMessages(selected.id)]);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setError('');
    try {
      if (selectedGroup) {
        const response = await api.post(`/groups/${selectedGroup.id}/messages`, { body });
        setMessages((items) => items.some((item) => item.id === response.data.id) ? items : [...items, response.data]);
        setDraft('');
        return;
      }
      if (!selected) return;
      const response = await api.post(`/sessions/${selected.id}/messages`, { body });
      setMessages((items) => items.some((item) => item.id === response.data.id) ? items : [...items, response.data]);
      setDraft('');
      await loadSessions();
    } catch (requestError) {
      setError(requestError.response?.data?.error || t('conversations.error'));
    } finally { setSending(false); }
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

  if (loading) return <div className="conversation-loading">{t('common.loading')}</div>;

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
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={filter === option.key}
                  onClick={() => setFilter(option.key)}
                >
                  {t(option.label)}<span className="conversation-filter-count">{count}</span>
                </button>
              );
            })}
          </div>
        )}
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
          return (
            <button key={session.id} type="button" onClick={() => setParams({ session: String(session.id) })} className={cn('conversation-list-item', session.id === selectedId && 'is-active')}>
              <Avatar className="size-9"><AvatarFallback>{initials(peer?.name)}</AvatarFallback></Avatar>
              <span className="min-w-0">
                {/* Who, what state, when — the scannable line. */}
                <span className="conversation-list-top">
                  <strong>{peer?.name}</strong>
                  <em className={`conversation-state is-${state}`}>{stateLabel(session, state, t)}</em>
                </span>
                {/* What they actually asked about. */}
                <small>{session.title}</small>
              </span>
            </button>
          );
        })}
        {showGroups && groups.map((group) => (
          <button key={`group-${group.id}`} type="button" onClick={() => setParams({ group: String(group.id) })} className={cn('conversation-list-item', group.id === selectedGroupId && 'is-active')}>
            <Avatar className="size-9"><AvatarFallback><UsersRound className="size-4" /></AvatarFallback></Avatar>
            <span className="min-w-0">
              <span className="conversation-list-top">
                <strong>{group.name}</strong>
                <em className="conversation-state is-group">{t('nav.groups')}</em>
              </span>
              <small>{group.description || t('nav.groups')}</small>
            </span>
          </button>
        ))}
        {!visibleSessions.length && !(showGroups && groups.length) && filter !== 'all' && (
          <p className="conversation-list-empty">{t('conversations.filter.empty')}</p>
        )}
        </>}
      </aside>

      <div className="conversation-thread">
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
              <div><strong>{person?.name}</strong><span>{[person?.current_role, person?.department].filter(Boolean).join(' · ')}</span></div>
              <Link to={`/profile/${person?.id}`}>{t('conversations.profile')}</Link>
            </header>}

            {selected?.status === 'pending' && selected.isMentor && (
              <div className="conversation-request-banner">
                <div><strong>{t('conversations.requestTitle')}</strong><p>{selected.pre_session_question}</p></div>
                <div><Button size="sm" onClick={() => mutateSession({ status: 'scheduled' })}><Check />{t('conversations.accept')}</Button><Button size="sm" variant="outline" onClick={() => mutateSession({ status: 'declined' })}>{t('conversations.decline')}</Button></div>
              </div>
            )}
            {selected?.status === 'pending' && selected.isMentee && <div className="conversation-waiting">{t('conversations.waiting', { name: person?.name?.split(' ')[0] })}</div>}

            {selected?.status === 'scheduled' && (
              <div className="conversation-meeting">
                <CalendarDays />
                <div><strong>{selected.scheduled_at ? formatMessageTime(selected.scheduled_at) : t('conversations.pickTime')}</strong><span>{t('conversations.meetingSubline')}</span></div>
                <div className="conversation-meeting-actions">
                  {!selected.scheduled_at && <Button size="sm" variant="outline" onClick={() => setScheduleOpen(true)}>{t('conversations.schedule')}</Button>}
                  {selected.scheduled_at && <IcsDownloadButton sessionId={selected.id} session={selected} label="Meeting" meetingUrl={selected.meeting_url} onReschedule={() => setScheduleOpen(true)} />}
                </div>
                {scheduleOpen && (
                  <div className="conversation-scheduler">
                    <Field
                      label={t('conversations.newTime')}
                      type="datetime-local"
                      value={scheduledAt}
                      min={localDateTime(new Date(Date.now() + 3600000))}
                      onChange={(event) => setScheduledAt(event.target.value)}
                    />
                    <Button size="sm" onClick={saveSchedule} disabled={!scheduledAt || savingSchedule}>{t('common.save')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setScheduleOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
                  </div>
                )}
              </div>
            )}

            <div className="conversation-messages">
              <div className="conversation-context">{selected ? <><span>{statusLabel(selected.status, t)}</span><h2>{selected.title}</h2>{selected.topics?.length > 0 && <p>{selected.topics.join(' · ')}</p>}</> : <><span>{t('nav.groups')}</span><h2>{selectedGroup.name}</h2></>}</div>
              {messages.map((message) => message.kind === 'system' || message.kind === 'schedule' ? (
                <div className="conversation-system" key={message.id}>{message.body}</div>
              ) : (
                <div className={cn('conversation-message', (message.sender_id === user?.id || (message.kind === 'request' && selected.isMentee)) ? 'is-mine' : 'is-theirs')} key={message.id}>
                  {selectedGroup && message.sender_id !== user?.id && <strong>{message.sender_name}</strong>}<p>{message.body}</p><time>{formatMessageTime(message.created_at)}</time>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <form className="conversation-composer" onSubmit={sendMessage}>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('conversations.messagePlaceholder')} maxLength={6000} aria-label={t('conversations.messagePlaceholder')} />
              <button type="submit" disabled={!draft.trim() || sending} aria-label={t('conversations.send')}><Send /></button>
            </form>
          </>
        )}
        {error && <p className="conversation-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
