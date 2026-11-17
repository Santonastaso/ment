export function isExpired(session, now = Date.now()) {
  return !!session.expired_at || (session.status === 'pending' && !!session.request_expires_at && new Date(session.request_expires_at).getTime() <= now);
}

export function conversationState(session, now = Date.now()) {
  if (isExpired(session, now)) return 'closed';
  if (session.status === 'pending') return session.isMentor ? 'needs' : 'waiting';
  if (session.status === 'scheduled') {
    if (session.viewer_completed) return 'past';
    if (!session.scheduled_at || new Date(session.scheduled_at).getTime() < now) return 'needs';
    return 'scheduled';
  }
  return session.status === 'completed' ? 'past' : 'closed';
}

export const CONVERSATION_FILTERS = [
  { key: 'all', label: 'conversations.filter.all', match: (_state, session) => !session?.conversation_archived, groups: true },
  { key: 'needs', label: 'conversations.filter.needsYou', match: (state, session) => !session?.conversation_archived && state === 'needs' },
  { key: 'waiting', label: 'conversations.filter.waiting', match: (state, session) => !session?.conversation_archived && state === 'waiting' },
  { key: 'scheduled', label: 'conversations.filter.scheduled', match: (state, session) => !session?.conversation_archived && state === 'scheduled' },
  { key: 'past', label: 'conversations.filter.past', match: (state, session) => !session?.conversation_archived && (state === 'past' || state === 'closed') },
  { key: 'groups', label: 'nav.groups', match: () => false, groups: true },
  { key: 'archived', label: 'conversations.filter.archived', match: (_state, session) => !!session?.conversation_archived },
];

export function conversationPeerId(session, viewerId) {
  if (!session || !viewerId) return null;
  return session.mentor_id === viewerId ? session.mentee_id : session.mentor_id;
}

function newestSessionsFirst(sessions) {
  return sessions.map((session, index) => ({ session, index, time: new Date(session.last_activity_at || session.created_at).getTime() }))
    .sort((a, b) => Number.isFinite(a.time) && Number.isFinite(b.time) && a.time !== b.time ? b.time - a.time : a.index - b.index)
    .map(item => item.session);
}

export function peerConversationSessions(sessions, session, viewerId) {
  const peerId = conversationPeerId(session, viewerId);
  if (!peerId) return [];
  return newestSessionsFirst(sessions.filter(item => conversationPeerId(item, viewerId) === peerId));
}

export function conversationThreads(sessions, viewerId) {
  const seen = new Set();
  const threads = [];
  for (const session of newestSessionsFirst(sessions)) {
    const peerId = conversationPeerId(session, viewerId);
    if (!peerId || seen.has(peerId)) continue;
    seen.add(peerId);
    threads.push(session);
  }
  return threads;
}

export function conversationUnreadCount(sessions, counts = {}) {
  return sessions.reduce((total, session) => total + (counts[session.id] || 0), 0);
}

export function requestText(value, fallback = '') {
  const text = String(value || '').trim();
  // Search criteria belong to the matcher, never to the conversation UI.
  if (/^[{[]/.test(text)) return fallback;
  return text || fallback;
}

export function resumableSearch(thread) {
  if (!thread?.id || thread.archived) return false;
  const turn = [...(thread.turns || [])].reverse().find(item => item?.role === 'assistant');
  return ['clarification', 'matches', 'draft'].includes(turn?.kind);
}

export function clearSentDraft(drafts, key, sentDraft) {
  if (drafts[key] !== sentDraft) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}

export function canCompleteMeeting(session, now = Date.now()) {
  return session?.status === 'scheduled' && !session.viewer_completed
    && !!session.scheduled_at && new Date(session.scheduled_at).getTime() <= now;
}

export function meetingFeedback(session, reflection, rating) {
  return {
    ...(!session.viewer_completed && session.status !== 'completed' ? { status: 'completed' } : {}),
    [session.isMentor ? 'mentor_reflection' : 'reflection']: reflection.trim() || null,
    [session.isMentor ? 'mentor_rating' : 'mentee_rating']: rating,
  };
}
