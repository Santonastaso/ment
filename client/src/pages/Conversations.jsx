import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, ChevronLeft, MessageCircle, Send, Video } from 'lucide-react';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { Button } from '../components/ui/button.jsx';
import { Avatar, AvatarFallback } from '../components/ui/avatar.jsx';
import IcsDownloadButton from '../components/IcsDownloadButton.jsx';
import { cn } from '@/lib/utils';

function initials(name = '') {
  return name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

function otherPerson(session, viewerId) {
  return session.mentor_id === viewerId ? session.mentee : session.mentor;
}

function statusLabel(status, t) {
  return t(`conversations.status.${status}`, status);
}

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
  const [sessions, setSessions] = useState([]);
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
  const person = selected ? otherPerson(selected, user?.id) : null;

  async function loadSessions(selectFirst = false) {
    const response = await api.get('/sessions');
    const next = response.data || [];
    setSessions(next);
    if ((selectFirst || (selectedId && !next.some((item) => item.id === selectedId))) && next[0]) {
      setParams({ session: String(next[0].id) }, { replace: true });
    }
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
    loadSessions(!selectedId)
      .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.error || t('conversations.error')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return undefined; }
    let cancelled = false;
    const refresh = () => loadMessages(selectedId).catch((requestError) => {
      if (!cancelled) setError(requestError.response?.data?.error || t('conversations.error'));
    });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selectedId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, selectedId]);
  useEffect(() => {
    setScheduleOpen(false);
    setScheduledAt(localDateTime(selected?.scheduled_at));
  }, [selectedId, selected?.scheduled_at]);

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
      const response = await api.post(`/sessions/${selected.id}/messages`, { body });
      setMessages((items) => [...items, response.data]);
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
    <section className={cn('conversations-shell', selectedId && 'has-selection')}>
      <aside className="conversation-list" aria-label={t('conversations.title')}>
        <header><h1>{t('conversations.title')}</h1><span>{sessions.length}</span></header>
        {sessions.length === 0 ? (
          <div className="conversation-empty">
            <MessageCircle />
            <strong>{t('conversations.emptyTitle')}</strong>
            <p>{t('conversations.emptyBody')}</p>
            <Link to="/explorer">{t('conversations.findPeople')}</Link>
          </div>
        ) : sessions.map((session) => {
          const peer = otherPerson(session, user?.id);
          return (
            <button key={session.id} type="button" onClick={() => setParams({ session: String(session.id) })} className={cn('conversation-list-item', session.id === selectedId && 'is-active')}>
              <Avatar className="size-9"><AvatarFallback>{initials(peer?.name)}</AvatarFallback></Avatar>
              <span className="min-w-0"><strong>{peer?.name}</strong><small>{session.title}</small></span>
              <em className={`status-${session.status}`}>{statusLabel(session.status, t)}</em>
            </button>
          );
        })}
      </aside>

      <div className="conversation-thread">
        {!selected ? (
          <div className="conversation-placeholder"><MessageCircle /><p>{t('conversations.select')}</p></div>
        ) : (
          <>
            <header className="conversation-header">
              <button className="conversation-back" type="button" onClick={() => setParams({})} aria-label={t('common.close')}><ChevronLeft /></button>
              <Avatar className="size-9"><AvatarFallback>{initials(person?.name)}</AvatarFallback></Avatar>
              <div><strong>{person?.name}</strong><span>{[person?.current_role, person?.department].filter(Boolean).join(' · ')}</span></div>
              <Link to={`/profile/${person?.id}`}>{t('conversations.profile')}</Link>
            </header>

            {selected.status === 'pending' && selected.isMentor && (
              <div className="conversation-request-banner">
                <div><strong>{t('conversations.requestTitle')}</strong><p>{selected.pre_session_question}</p></div>
                <div><Button size="sm" onClick={() => mutateSession({ status: 'scheduled' })}><Check />{t('conversations.accept')}</Button><Button size="sm" variant="outline" onClick={() => mutateSession({ status: 'declined' })}>{t('conversations.decline')}</Button></div>
              </div>
            )}
            {selected.status === 'pending' && selected.isMentee && <div className="conversation-waiting">{t('conversations.waiting', { name: person?.name?.split(' ')[0] })}</div>}

            {selected.status === 'scheduled' && (
              <div className="conversation-meeting">
                <CalendarDays />
                <div><strong>{selected.scheduled_at ? new Date(selected.scheduled_at).toLocaleString() : t('conversations.pickTime')}</strong><span>{t('conversations.meetingSubline')}</span></div>
                <div className="conversation-meeting-actions">
                  <Button size="sm" variant="outline" onClick={() => setScheduleOpen((value) => !value)}>{selected.scheduled_at ? t('conversations.reschedule') : t('conversations.schedule')}</Button>
                  {selected.meeting_url && <a className="conversation-video-link" href={selected.meeting_url} target="_blank" rel="noreferrer"><Video />{t('conversations.join')}</a>}
                  {selected.scheduled_at && <IcsDownloadButton sessionId={selected.id} />}
                </div>
                {scheduleOpen && <div className="conversation-scheduler"><input className="input" type="datetime-local" value={scheduledAt} min={localDateTime(new Date(Date.now() + 3600000))} onChange={(event) => setScheduledAt(event.target.value)} /><Button size="sm" onClick={saveSchedule} disabled={!scheduledAt || savingSchedule}>{t('common.save')}</Button></div>}
              </div>
            )}

            <div className="conversation-messages">
              <div className="conversation-context"><span>{statusLabel(selected.status, t)}</span><h2>{selected.title}</h2>{selected.topics?.length > 0 && <p>{selected.topics.join(' · ')}</p>}</div>
              {messages.map((message) => message.kind === 'system' || message.kind === 'schedule' ? (
                <div className="conversation-system" key={message.id}>{message.body}</div>
              ) : (
                <div className={cn('conversation-message', message.sender_id === user?.id ? 'is-mine' : 'is-theirs')} key={message.id}>
                  <p>{message.body}</p><time>{new Date(message.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
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
