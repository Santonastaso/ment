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
  { key: 'all', label: 'conversations.filter.all', match: () => true, groups: true },
  { key: 'needs', label: 'conversations.filter.needsYou', match: state => state === 'needs' },
  { key: 'waiting', label: 'conversations.filter.waiting', match: state => state === 'waiting' },
  { key: 'scheduled', label: 'conversations.filter.scheduled', match: state => state === 'scheduled' },
  { key: 'past', label: 'conversations.filter.past', match: state => state === 'past' || state === 'closed' },
  { key: 'groups', label: 'nav.groups', match: () => false, groups: true },
];

function activityTime(item) {
  const value = item.kind === 'group'
    ? item.data.latest_message_at || item.data.created_at
    : item.data.updated_at || item.data.last_activity_at || item.data.created_at;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function conversationListItems(sessions = [], groups = [], filter = 'all') {
  const option = CONVERSATION_FILTERS.find(item => item.key === filter) || CONVERSATION_FILTERS[0];
  const sessionItems = sessions
    .filter(session => option.match(conversationState(session)))
    .map((data, sourceIndex) => ({ kind: 'session', data, sourceIndex }));
  const groupItems = option.groups
    ? groups.map((data, sourceIndex) => ({ kind: 'group', data, sourceIndex: sessions.length + sourceIndex }))
    : [];

  return [...sessionItems, ...groupItems].sort((left, right) =>
    activityTime(right) - activityTime(left) || left.sourceIndex - right.sourceIndex);
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
