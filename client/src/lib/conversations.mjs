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
