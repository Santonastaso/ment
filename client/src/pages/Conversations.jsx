import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronsLeft, ChevronsRight, CircleCheck, CircleX, Info, ListFilter, MessageCircle, MessageSquareText, Send, UserRound, UsersRound } from 'lucide-react';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { Field } from '../components/ui/field.jsx';
import { formatChatClock, formatMessageTime } from '../lib/utils.js';
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
import SessionRequestModal from '../components/SessionRequestModal.jsx';
import TimeSlotSelect from '../components/TimeSlotSelect.jsx';
import { groupPath, sessionPath } from '../lib/conversationLinks.mjs';
import { beginPendingMessage, finishPendingMessage, pendingDrafts, pendingMessage } from '../lib/pendingMessage.mjs';

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

function chatDayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function appendMessage(current, row) {
  return current.some((item) => item.id === row.id) ? current : [...current, row].sort((a, b) => a.id - b.id);
}

function mergeLatestMessages(current, latest) {
  const existing = new Set(current.map((item) => item.id));
  const missing = latest.filter((item) => !existing.has(item.id));
  return missing.length ? [...current, ...missing].sort((a, b) => a.id - b.id) : current;
}

function timelineEvent(message, t) {
  if (message.body === 'Request withdrawn.' || message.body === 'Meeting cancelled.') {
    return { title: t('conversations.status.cancelled'), icon: CircleX };
  }
  if (message.body === 'Request declined.') return { title: t('conversations.status.declined'), icon: CircleX };
  if (message.body === 'Request accepted.') return { title: t('conversations.status.scheduled'), icon: CircleCheck };
  if (message.body === 'Session completed.') return { title: t('conversations.status.completed'), icon: CircleCheck };
  return { title: message.body, icon: Info };
}

function sessionPreview(session, t) {
  if (!session.latest_message) return requestText(session.title, t('conversations.requestTitle'));
  if (session.latest_message_kind === 'system') return timelineEvent({ body: session.latest_message }, t).title;
  return session.latest_message;
}

export default function Conversations() {
  const { user, unreadCounts, refreshPendingAcceptances, refreshUnreadCounts } = useAuth();
  const { t, lang } = useT();
  const navigate = useNavigate();
  const { sessionToken, groupToken } = useParams();
  const copy = homeCopy(lang);
  const [params, setParams] = useSearchParams();
  const querySessionId = Number(params.get('session')) || null;
  const queryGroupId = Number(params.get('group')) || null;
  const [sessions, setSessions] = useState([]);
  const [groups, setGroups] = useState([]);
  const selectedId = sessionToken ? sessions.find(session => session.route_token === sessionToken)?.id : querySessionId;
  const selectedGroupId = groupToken ? groups.find(group => group.route_token === groupToken)?.id : queryGroupId;
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railMenu, setRailMenu] = useState(null);
  const railRef = useRef(null);
  const filter = FILTERS.some(option => option.key === params.get('filter')) ? params.get('filter') : 'all';
  function selectThread(key, id) {
    const item = key === 'session' ? sessions.find(session => session.id === id) : groups.find(group => group.id === id);
    if (item?.route_token) {
      navigate(key === 'session' ? sessionPath(item) : groupPath(item));
      setRailMenu(null);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete('session'); next.delete('group');
    next.set(key, String(id));
    setParams(next);
    setRailMenu(null);
  }
  useEffect(() => {
    if (!railMenu) return undefined;
    const closeOnOutsideClick = event => { if (!railRef.current?.contains(event.target)) setRailMenu(null); };
    const closeOnEscape = event => { if (event.key === 'Escape') setRailMenu(null); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [railMenu]);
  // Sessions the current filter admits, newest meeting first.
  const visibleSessions = useMemo(() => {
    const match = FILTERS.find(option => option.key === filter)?.match ?? (() => true);
    return sessions.filter(session => match(rowState(session)));
  }, [sessions, filter]);
  const showGroups = FILTERS.find(option => option.key === filter)?.groups === true;

  const [messages, setMessages] = useState([]);
  const [loadedThreadKey, setLoadedThreadKey] = useState('');
  const sessionsFetchRef = useRef(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState(() => pendingDrafts(window.sessionStorage, user?.id));
  const [sendingThreads, setSendingThreads] = useState({});
  const pendingSends = useRef(new Set());
  const threadKey = selectedGroupId ? `group:${selectedGroupId}` : selectedId ? `session:${selectedId}` : '';
  const activeThreadRef = useRef(threadKey);
  activeThreadRef.current = threadKey;
  const pageLoading = loading || (!!threadKey && loadedThreadKey !== threadKey);
  const draft = drafts[threadKey] || '';
  const sending = !!sendingThreads[threadKey];
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [groupOverviewOpen, setGroupOverviewOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [groupMembersError, setGroupMembersError] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const messagesRef = useRef(null);
  const composerRef = useRef(null);
  const preserveScrollRef = useRef(null);
  const scrolledThreadRef = useRef('');
  const senderNamesRef = useRef(new Map());

  const selected = sessions.find((session) => session.id === selectedId) || null;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;
  const person = selected ? otherPerson(selected, user?.id) : null;

  useEffect(() => {
    setGroupOverviewOpen(false);
    setGroupMembers([]);
    setGroupMembersError(false);
  }, [selectedGroupId]);

  async function openGroupOverview() {
    if (!selectedGroup) return;
    const groupId = selectedGroup.id;
    setGroupOverviewOpen(true);
    setGroupMembersLoading(true);
    setGroupMembersError(false);
    try {
      const { data, error: membersError } = await supabase.from('group_members')
        .select('user_id, role').eq('group_id', groupId);
      if (membersError) throw membersError;
      const members = await Promise.all((data || []).map(async (membership) => {
        if (membership.user_id === user?.id) {
          return { ...membership, name: user.name };
        }
        const { data: profile } = await supabase.rpc('peer_profile', { p_user_id: membership.user_id });
        return { ...membership, name: profile?.name || t('groups.memberUnknown') };
      }));
      if (activeThreadRef.current !== `group:${groupId}`) return;
      setGroupMembers(members.sort((a, b) => (b.role === 'owner') - (a.role === 'owner') || a.name.localeCompare(b.name)));
    } catch {
      if (activeThreadRef.current === `group:${groupId}`) setGroupMembersError(true);
    } finally {
      if (activeThreadRef.current === `group:${groupId}`) setGroupMembersLoading(false);
    }
  }

  async function loadSessions() {
    const requestId = ++sessionsFetchRef.current;
    const response = await api.get('/sessions');
    const next = response.data || [];
    if (requestId === sessionsFetchRef.current) setSessions(next);
    return next;
  }

  async function loadGroups() {
    const response = await api.get('/groups');
    const next = (response.data || []).filter((group) => group.joined);
    setGroups(next);
    return next;
  }

  async function loadMessages(id, before = null, updatePagination = true) {
    const query = before ? `?before=${before}` : '';
    const { data } = await api.get(`/sessions/${id}/messages${query}`);
    if (activeThreadRef.current !== `session:${id}`) return;
    const pending = pendingMessage(window.sessionStorage, user?.id, `session:${id}`);
    if (pending && data.messages.some(item => item.client_id === pending.id)) {
      finishPendingMessage(window.sessionStorage, user?.id, `session:${id}`, pending.id);
      setDrafts(items => clearSentDraft(items, `session:${id}`, pending.body));
    }
    if (before) {
      const box = messagesRef.current;
      if (box) preserveScrollRef.current = { mode: 'prepend', height: box.scrollHeight, top: box.scrollTop };
      setMessages((current) => [...data.messages.filter((item) => !current.some((old) => old.id === item.id)), ...current]);
    } else {
      preserveReadingPosition();
      setMessages((current) => mergeLatestMessages(current, data.messages));
    }
    if (updatePagination) setHasOlder(data.hasMore);
  }

  function preserveReadingPosition() {
    const box = messagesRef.current;
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight > 100) {
      preserveScrollRef.current = { mode: 'stay', top: box.scrollTop };
    }
  }

  async function loadGroupMessages(id, before = null, updatePagination = true) {
    const query = before ? `?before=${before}` : '';
    const { data } = await api.get(`/groups/${id}/messages${query}`);
    if (activeThreadRef.current !== `group:${id}`) return;
    const pending = pendingMessage(window.sessionStorage, user?.id, `group:${id}`);
    if (pending && data.messages.some(item => item.client_id === pending.id)) {
      finishPendingMessage(window.sessionStorage, user?.id, `group:${id}`, pending.id);
      setDrafts(items => clearSentDraft(items, `group:${id}`, pending.body));
    }
    data.messages.forEach((item) => senderNamesRef.current.set(item.sender_id, item.sender_name));
    if (before) {
      const box = messagesRef.current;
      if (box) preserveScrollRef.current = { mode: 'prepend', height: box.scrollHeight, top: box.scrollTop };
      setMessages((current) => [...data.messages.filter((item) => !current.some((old) => old.id === item.id)), ...current]);
    } else {
      preserveReadingPosition();
      setMessages((current) => mergeLatestMessages(current, data.messages));
    }
    if (updatePagination) setHasOlder(data.hasMore);
  }

  async function loadOlderMessages() {
    const oldest = messages[0]?.id;
    if ((!selectedId && !selectedGroupId) || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      if (selectedGroupId) await loadGroupMessages(selectedGroupId, oldest);
      else await loadMessages(selectedId, oldest);
    }
    catch (requestError) { setError(requestError.response?.data?.error || t('conversations.error')); }
    finally { setLoadingOlder(false); }
  }

  useEffect(() => {
    let cancelled = false;
    let loadingTimer;
    const loadingStartedAt = Date.now();
    setLoading(true);
    Promise.all([loadSessions(), loadGroups()])
      .then(([nextSessions, nextGroups]) => {
        if (cancelled) return;
        const currentSession = nextSessions.find((item) => item.id === selectedId);
        if (currentSession) {
          if (querySessionId && currentSession.route_token && !params.has('filter')) navigate(sessionPath(currentSession), { replace: true });
          return;
        }
        const currentGroup = nextGroups.find((item) => item.id === selectedGroupId);
        if (currentGroup) {
          if (queryGroupId && currentGroup.route_token && !params.has('filter')) navigate(groupPath(currentGroup), { replace: true });
          return;
        }
        if (params.has('filter') || sessionToken || groupToken) return;
        if (nextSessions[0]) navigate(sessionPath(nextSessions[0]), { replace: true });
        else if (nextGroups[0]) navigate(groupPath(nextGroups[0]), { replace: true });
        else if (selectedId || selectedGroupId) setParams({}, { replace: true });
      })
      .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.error || t('conversations.error')); })
      .finally(() => {
        if (cancelled) return;
        loadingTimer = window.setTimeout(
          () => { if (!cancelled) setLoading(false); },
          Math.max(0, 1000 - (Date.now() - loadingStartedAt)),
        );
      });
    return () => { cancelled = true; window.clearTimeout(loadingTimer); };
  }, []);

  useEffect(() => {
    const refreshGroups = () => loadGroups().catch((requestError) => {
      setError(requestError.response?.data?.error || t('conversations.error'));
    });
    const channel = supabase.channel('conversation-group-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, refreshGroups)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, refreshGroups)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, refreshGroups)
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'session_messages' }, refreshSessions)
      .subscribe();
    window.addEventListener('focus', refreshSessions);
    return () => {
      window.removeEventListener('focus', refreshSessions);
      supabase.removeChannel(channel);
    };
  }, []);

  useLayoutEffect(() => {
    setMessages([]);
    setHasOlder(false);
    setLoadedThreadKey('');
  }, [selectedId, selectedGroupId]);

  useEffect(() => {
    if (selectedGroupId) {
      let cancelled = false;
      const refresh = (initial = false) => loadGroupMessages(selectedGroupId, null, initial)
        .then(() => {
          if (cancelled) return;
          if (initial) setLoadedThreadKey(`group:${selectedGroupId}`);
          return api.post(`/groups/${selectedGroupId}/read`, {}).then(refreshUnreadCounts);
        })
        .catch((requestError) => {
          if (!cancelled) {
            setError(requestError.response?.data?.error || t('conversations.error'));
            if (initial) setLoadedThreadKey(`group:${selectedGroupId}`);
          }
        });
      refresh(true);
      const channel = supabase.channel(`group-${selectedGroupId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${selectedGroupId}` }, async ({ new: row }) => {
          let name = row.sender_id === user?.id ? user.name : senderNamesRef.current.get(row.sender_id);
          if (!cancelled) { preserveReadingPosition(); setMessages((current) => appendMessage(current, { ...row, sender_name: name || t('nav.groups') })); }
          if (!name) {
            const { data } = await supabase.rpc('peer_profile', { p_user_id: row.sender_id });
            name = data?.name || t('nav.groups');
            senderNamesRef.current.set(row.sender_id, name);
            if (!cancelled) setMessages((current) => current.map((item) => item.id === row.id ? { ...item, sender_name: name } : item));
          }
          if (row.sender_id !== user?.id) api.post(`/groups/${selectedGroupId}/read`, {}).then(refreshUnreadCounts).catch(() => {});
        })
        .subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });
      const refreshOnFocus = () => refresh();
      const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh(); };
      const poll = window.setInterval(refreshWhenVisible, 12_000);
      window.addEventListener('focus', refreshOnFocus);
      document.addEventListener('visibilitychange', refreshWhenVisible);
      return () => { cancelled = true; window.clearInterval(poll); window.removeEventListener('focus', refreshOnFocus); document.removeEventListener('visibilitychange', refreshWhenVisible); supabase.removeChannel(channel); };
    }
    if (!selectedId) return undefined;
    let cancelled = false;
    const refresh = async (initial = false) => {
      try {
        await loadMessages(selectedId, null, initial);
        if (cancelled) return;
        if (initial) setLoadedThreadKey(`session:${selectedId}`);
        await api.post(`/sessions/${selectedId}/read`, {});
        await refreshUnreadCounts();
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.response?.data?.error || t('conversations.error'));
          if (initial) setLoadedThreadKey(`session:${selectedId}`);
        }
      }
    };
    refresh(true);
    const channel = supabase.channel(`session-${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'session_messages', filter: `session_id=eq.${selectedId}` }, ({ new: row }) => {
        if (cancelled) return;
        preserveReadingPosition();
        setMessages((current) => appendMessage(current, row));
        if (row.sender_id !== user?.id) api.post(`/sessions/${selectedId}/read`, {}).then(refreshUnreadCounts).catch(() => {});
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${selectedId}` }, () => {
        loadSessions().catch(() => {});
        loadMessages(selectedId, null, false).catch(() => {});
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });
    const refreshOnFocus = () => refresh();
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const poll = window.setInterval(refreshWhenVisible, 12_000);
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => { cancelled = true; window.clearInterval(poll); window.removeEventListener('focus', refreshOnFocus); document.removeEventListener('visibilitychange', refreshWhenVisible); supabase.removeChannel(channel); };
  }, [selectedId, selectedGroupId]);

  useLayoutEffect(() => {
    const box = messagesRef.current;
    if (box && scrolledThreadRef.current !== threadKey) {
      box.scrollTop = box.scrollHeight;
      scrolledThreadRef.current = threadKey;
      preserveScrollRef.current = null;
      return;
    }
    if (box && preserveScrollRef.current) {
      const { mode, height, top } = preserveScrollRef.current;
      box.scrollTop = mode === 'prepend' ? top + box.scrollHeight - height : top;
      preserveScrollRef.current = null;
    } else if (box) box.scrollTop = box.scrollHeight;
  }, [messages, selectedId, selectedGroupId]);
  useLayoutEffect(() => {
    const field = composerRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }, [draft, threadKey]);
  useEffect(() => {
    setOverviewOpen(false);
    setWithdrawOpen(false);
    setNewRequestOpen(false);
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
    const sessionId = selected.id;
    const response = await api.put(`/sessions/${sessionId}`, body);
    setSessions((items) => items.map((item) => item.id === sessionId ? response.data : item));
    preserveScrollRef.current = null;
    loadMessages(sessionId, null, false).catch(() => {});
    loadSessions().catch(() => {});
    if (['cancelled', 'declined'].includes(body.status) && !['all', 'past'].includes(filter)) {
      const next = new URLSearchParams(params);
      next.set('filter', 'past');
      setParams(next, { replace: true });
    }
    if (response.data.calendarSyncWarning) setError(t('conversations.calendarSyncWarning'));
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
    const clientId = beginPendingMessage(window.sessionStorage, user?.id, key, body);
    setSendingThreads(items => ({ ...items, [key]: true }));
    setError('');
    try {
      const response = await api.post(endpoint, { body, client_id: clientId });
      finishPendingMessage(window.sessionStorage, user?.id, key, clientId);
      if (activeThreadRef.current === key) {
        preserveScrollRef.current = null;
        setMessages(items => appendMessage(items, response.data));
      }
      setDrafts(items => clearSentDraft(items, key, sentDraft));
      if (selected) loadSessions().catch(() => {});
      if (selectedGroup) loadGroups().catch(() => {});
    } catch (requestError) {
      if (activeThreadRef.current === key) setError(requestError.response?.data?.error || t('conversations.error'));
    } finally {
      pendingSends.current.delete(key);
      setSendingThreads(items => { const next = { ...items }; delete next[key]; return next; });
    }
  }

  async function saveSchedule() {
    if (!scheduledAt) return;
    if (new Date(scheduledAt).getTime() < Date.now() + 60 * 60 * 1000) { setError(t('components.sessionRequest.step3Invalid')); return; }
    setSavingSchedule(true);
    try {
      await mutateSession({ scheduled_at: new Date(scheduledAt).toISOString() });
      setScheduleOpen(false);
    } catch (requestError) {
      setError(requestError.response?.data?.error || t('conversations.error'));
    } finally { setSavingSchedule(false); }
  }

  const timelineItems = selected
    ? [{ id: `request-${selected.id}`, kind: 'request-card', created_at: selected.created_at }, ...messages.filter(message => message.kind !== 'request')]
    : messages.filter(message => message.kind !== 'request');
  const dayFormatter = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <section className={cn('conversations-shell', (selectedId || selectedGroupId) && 'has-selection', railCollapsed && 'is-list-collapsed')}>
      <aside ref={railRef} className="conversation-list" aria-label={t('conversations.title')}>
        <header><div className="conversation-list-heading"><h1>{t('conversations.title')}</h1>{pageLoading ? <Skeleton className="h-5 w-8 rounded-full" /> : <span className="conversation-list-count">{sessions.length + groups.length}</span>}</div><button type="button" className="conversation-list-toggle" onClick={() => { setRailCollapsed(current => !current); setRailMenu(null); }} aria-label={railCollapsed ? t('conversations.openList') : t('conversations.closeList')} title={railCollapsed ? t('conversations.openList') : t('conversations.closeList')}>{railCollapsed ? <ChevronsRight aria-hidden="true" /> : <ChevronsLeft aria-hidden="true" />}</button></header>
        {railCollapsed && <div className="conversation-rail-controls" role="group" aria-label={t('conversations.title')}>
          <button type="button" aria-label={t('conversations.filter.label')} title={t('conversations.filter.label')} aria-expanded={railMenu === 'filters'} aria-controls="conversation-list-filters" onClick={() => setRailMenu(current => current === 'filters' ? null : 'filters')}><ListFilter aria-hidden="true" /></button>
          <button type="button" aria-label={t('conversations.title')} title={t('conversations.title')} aria-expanded={railMenu === 'chats'} aria-controls="conversation-list-chats" onClick={() => setRailMenu(current => current === 'chats' ? null : 'chats')}><MessageSquareText aria-hidden="true" />{unreadCounts.sessions + unreadCounts.groups > 0 && <span className="conversation-rail-unread">{unreadCounts.sessions + unreadCounts.groups}</span>}</button>
        </div>}
        <div className={cn('conversation-list-content', railMenu && `menu-${railMenu}`)}>
        {pageLoading ? (
          <div className="conversation-filters conversation-filters-skeleton" aria-hidden="true">
            {FILTERS.map(option => <Skeleton key={option.key} className="h-9 rounded-full" />)}
          </div>
        ) : (sessions.length > 0 || groups.length > 0) && (
          <div id="conversation-list-filters" className="conversation-filters" role="group" aria-label={t('conversations.filter.label')}>
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
                  className="filter-control"
                  aria-pressed={filter === option.key}
                  onClick={() => { setParams({ filter: option.key }); if (railCollapsed) setRailMenu('chats'); }}
                >
                  {t(option.label)}<span className="conversation-filter-count">{count}</span>
                </Button>
              );
            })}
          </div>
        )}
        <div id="conversation-list-chats" className="conversation-list-scroll" aria-busy={pageLoading}>
        {pageLoading ? (
          <div className="conversation-list-skeleton" role="status" aria-label={t('common.loading')}>
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="conversation-list-skeleton-row">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <span className="conversation-list-skeleton-copy"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-5/6" /></span>
                <Skeleton className="h-4 w-12 rounded-full" />
              </div>
            ))}
          </div>
        ) : sessions.length === 0 && groups.length === 0 ? (
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
                <small>{sessionPreview(session, t)}</small>
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
            <small>{group.latest_message || group.description || t('nav.groups')}</small>
          </span>
          {(unreadCounts.groupMessages[group.id] || 0) > 0 && <span className="conversation-unread-badge" aria-label={t('conversations.unreadCount', { count: unreadCounts.groupMessages[group.id] })}>{unreadCounts.groupMessages[group.id] > 99 ? '99+' : unreadCounts.groupMessages[group.id]}</span>}
        </button>
        ))}
        {!visibleSessions.length && !(showGroups && groups.length) && filter !== 'all' && (
          <p className="conversation-list-empty">{t('conversations.filter.empty')}</p>
        )}
        </>}
        </div>
        </div>
      </aside>

      <div key={selectedGroup ? `group-${selectedGroup.id}` : selected ? `session-${selected.id}` : 'empty'} className="conversation-thread" aria-busy={pageLoading}>
        {pageLoading ? (
          <div className="conversation-thread-skeleton" role="status" aria-label={t('common.loading')}>
            <Skeleton className="h-16 w-full rounded-2xl" />
            <div className="conversation-thread-skeleton-message"><Skeleton className="h-24 w-2/3 rounded-2xl" /><Skeleton className="h-16 w-1/2 self-end rounded-2xl" /></div>
            <Skeleton className="mt-auto h-12 w-full rounded-xl" />
          </div>
        ) : !selected && !selectedGroup ? (
          <div className="conversation-placeholder"><MessageCircle /><p>{t('conversations.select')}</p></div>
        ) : (
          <>
            {selectedGroup ? <header className="conversation-header">
              <button className="conversation-back" type="button" onClick={() => setParams({})} aria-label={t('common.close')}><ChevronLeft /></button>
              <Avatar className="size-9"><AvatarFallback><UsersRound className="size-4" /></AvatarFallback></Avatar>
              <div className="conversation-header-person"><strong>{selectedGroup.name}</strong><span>{selectedGroup.description || t('nav.groups')}</span></div>
              <div className="conversation-header-actions"><Button type="button" variant="ghost" size="icon" onClick={openGroupOverview} aria-label={t('groups.info')} title={t('groups.info')} aria-haspopup="dialog"><Info aria-hidden="true" /></Button></div>
            </header> : <header className="conversation-header">
              <button className="conversation-back" type="button" onClick={() => setParams({})} aria-label={t('common.close')}><ChevronLeft /></button>
              <Avatar className="size-9"><AvatarFallback>{initials(person?.name)}</AvatarFallback></Avatar>
              <div className="conversation-header-person"><strong>{person?.name}</strong><span>{selected.status === 'pending' && !isExpired(selected) && selected.isMentee ? t('conversations.requestSent') : stateLabel(selected, rowState(selected), t)}</span></div>
              <div className="conversation-header-actions">
                {(selected.status === 'scheduled' || selected.status === 'completed') && <MeetingFeedback key={selected.id} session={selected} onSaved={loadSessions} compact />}
                <Button type="button" variant="ghost" size="icon" onClick={() => setOverviewOpen(true)} aria-label={t('conversations.requestDetails')} title={t('conversations.requestDetails')} aria-haspopup="dialog"><Info aria-hidden="true" /></Button>
              </div>
            </header>}

            <div className="conversation-messages" ref={messagesRef}>
              {hasOlder && <Button type="button" variant="ghost" size="sm" className="mx-auto mb-4 flex" disabled={loadingOlder} onClick={loadOlderMessages}>{t('conversations.loadOlder')}</Button>}
              {timelineItems.map((message, index) => {
                const day = chatDayKey(message.created_at);
                const showDay = day && day !== chatDayKey(timelineItems[index - 1]?.created_at);
                const event = message.kind === 'system' || message.kind === 'schedule' ? timelineEvent(message, t) : null;
                const EventIcon = event?.icon;
                return <React.Fragment key={message.id}>
                  {showDay && <div className="conversation-day"><time dateTime={day}>{dayFormatter.format(new Date(message.created_at))}</time></div>}
                  {message.kind === 'request-card' ? <article className={cn('conversation-request-card', selected.isMentee ? 'is-mine' : 'is-theirs')}>
                <div className="conversation-request-top"><span><MessageSquareText aria-hidden="true" />{t('conversations.requestCard')}</span><time dateTime={selected.created_at}>{formatChatClock(selected.created_at)}</time></div>
                <h2>{requestText(selected.title, t('conversations.requestTitle'))}</h2>
                {selected.pre_session_question && selected.pre_session_question.trim() !== selected.title?.trim() && <p className="conversation-request-focus">{requestText(selected.pre_session_question)}</p>}
                {selected.outbound_message && <p className="conversation-request-body">{requestText(selected.outbound_message)}</p>}
                <div className="conversation-request-meta">
                  {selected.follow_up_intent && <span>{selected.follow_up_intent === 'ongoing' ? copy.ongoing : copy.oneOff}</span>}
                  {(selected.topics || []).map(topic => <span key={topic}>{topic}</span>)}
                </div>
                {(selected.status === 'pending' && !isExpired(selected) || selected.status === 'scheduled') && <div className="conversation-request-actions">
                  {selected.status === 'pending' && selected.isMentee && <Button type="button" variant="danger" size="sm" onClick={() => setWithdrawOpen(true)}>{t('conversations.withdraw')}</Button>}
                  {selected.status === 'pending' && selected.isMentor && <>
                    <Button type="button" variant="danger" size="sm" onClick={() => mutateSession({ status: 'declined' }).catch(() => setError(t('conversations.error')))}>{t('conversations.decline')}</Button>
                    <Button type="button" size="sm" onClick={() => mutateSession({ status: 'scheduled' }).catch(() => setError(t('conversations.error')))}><Check aria-hidden="true" />{t('conversations.accept')}</Button>
                  </>}
                  {selected.status === 'scheduled' && <>
                    {selected.scheduled_at && <IcsDownloadButton sessionId={selected.id} session={selected} meetingUrl={selected.meeting_url} label={t('conversations.sendInvite')} />}
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setOverviewOpen(true); setScheduleOpen(true); }}>{t(selected.scheduled_at ? 'conversations.reschedule' : 'conversations.schedule')}</Button>
                  </>}
                </div>}
                {(['cancelled', 'declined', 'completed'].includes(selected.status) || isExpired(selected)) && selected.isMentee && <div className="conversation-request-actions"><Button type="button" size="sm" onClick={() => setNewRequestOpen(true)}>{t('conversations.newRequest')}</Button></div>}
              </article> : event ? <div className="conversation-event"><EventIcon aria-hidden="true" /><strong>{event.title}</strong><time dateTime={message.created_at}>{formatChatClock(message.created_at)}</time></div>
                    : <div className={cn('conversation-message', message.sender_id === user?.id ? 'is-mine' : 'is-theirs')}>
                      {selectedGroup && message.sender_id !== user?.id && <strong>{message.sender_name}</strong>}<p>{message.body}</p><time dateTime={message.created_at}>{formatChatClock(message.created_at)}</time>
                    </div>}
                </React.Fragment>;
              })}
            </div>

            <form className="conversation-composer" onSubmit={sendMessage}>
              <textarea ref={composerRef} rows={1} value={draft} onChange={(event) => setDrafts(items => ({ ...items, [threadKey]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} placeholder={t('conversations.messagePlaceholder')} maxLength={6000} aria-label={t('conversations.messagePlaceholder')} />
              <Button type="submit" size="icon" disabled={!draft.trim() || sending} aria-label={t('conversations.send')}><Send /></Button>
            </form>
          </>
        )}
        {error && <p className="conversation-error" role="alert">{error}</p>}
      </div>
      {newRequestOpen && person && <SessionRequestModal mentor={person} onClose={() => setNewRequestOpen(false)} onSuccess={async (session) => { setNewRequestOpen(false); await loadSessions(); selectThread('session', session.id); }} />}
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
              <Field label={t('conversations.newTime')} type="date" value={scheduledAt.slice(0, 10)} min={localDateTime(new Date(Date.now() + 3600000)).slice(0, 10)} onChange={event => setScheduledAt(`${event.target.value}T${scheduledAt.slice(11, 16) || '14:00'}`)} />
              <TimeSlotSelect label={t('components.sessionRequest.time')} value={scheduledAt} min={localDateTime(new Date(Date.now() + 3600000))} onChange={setScheduledAt} />
              <Button size="sm" onClick={saveSchedule} disabled={!scheduledAt || savingSchedule}>{t('common.save')}</Button>
              <Button size="sm" variant="ghost" disabled={savingSchedule} onClick={() => setScheduleOpen(false)}>{t('common.cancel')}</Button>
            </div>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="conversation-overview-footer">
            <Button variant="ghost" size="sm" render={<Link to={`/profile/${person?.id}`} />}><UserRound aria-hidden="true" />{t('conversations.profile')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {selectedGroup && <Dialog open={groupOverviewOpen} onOpenChange={setGroupOverviewOpen}>
        <DialogContent className="conversation-overview sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedGroup.name}</DialogTitle>
            <DialogDescription>{selectedGroup.description || t('groups.chatSubtitle')}</DialogDescription>
          </DialogHeader>
          <div className="conversation-overview-body">
            {selectedGroup.is_owner && <p className="text-sm text-muted-foreground">{t('groups.youManage')}</p>}
            <section aria-label={t('groups.members', { count: selectedGroup.member_count || groupMembers.length })}>
              <p className="label-meta">{t('groups.members', { count: selectedGroup.member_count || groupMembers.length })}</p>
              {groupMembersLoading ? <div role="status" className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
                : groupMembersError ? <p className="text-sm text-muted-foreground">{t('groups.membersError')}</p>
                  : <div className="grid max-h-72 gap-2 overflow-y-auto">
                    {groupMembers.map(member => {
                      const isOwner = member.role === 'owner' || (selectedGroup.is_owner && member.user_id === user?.id);
                      return <div key={member.user_id} className="flex items-center gap-3 rounded-[var(--panel-radius)] bg-[var(--control-surface)] p-3">
                      <Avatar className="size-9"><AvatarFallback>{initials(member.name)}</AvatarFallback></Avatar>
                      <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                      {isOwner && <span className="rounded-full bg-background px-2 py-1 text-xs font-medium text-foreground">{t('groups.ownerLabel')}</span>}
                    </div>;
                    })}
                    {groupMembers.length === 0 && <p className="text-sm text-muted-foreground">{t('groups.noMembers')}</p>}
                  </div>}
            </section>
          </div>
          {selectedGroup.is_owner && <DialogFooter className="conversation-overview-footer">
            <Button type="button" size="sm" onClick={() => { setGroupOverviewOpen(false); navigate(`/groups?manage=${selectedGroup.id}`); }}>{t('groups.manageMembers')}</Button>
          </DialogFooter>}
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
