export function messageFor(topic, payload, origin, routeToken) {
  const sessionId = Number(payload.session_id);
  const sessionLink = typeof routeToken === 'string' && /^[A-Za-z0-9_-]{16}$/.test(routeToken)
    ? `${origin}/c/${routeToken}` : `${origin}/conversations`;
  if (topic === 'reflection_reminder') return {
    subject: 'Your MENT reflection is ready',
    text: `Take two minutes to reflect on what went well this week. Open MENT: ${origin}/profile`,
  };
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return null;
  if (topic === 'session_request_received') return {
    subject: 'You have a new MENT request',
    text: `Someone has asked to connect with you. Review the request: ${sessionLink}`,
  };
  if (topic === 'session_request_accepted') return {
    subject: 'Your MENT request was accepted',
    text: `Your request was accepted. Continue the conversation: ${sessionLink}`,
  };
  if (topic === 'meeting_reminder') {
    const time = typeof payload.scheduled_at === 'string' ? new Date(payload.scheduled_at) : null;
    if (!time || Number.isNaN(time.getTime())) return null;
    return {
      subject: 'Your MENT meeting is coming up',
      text: `Your meeting is scheduled for ${time.toUTCString()}. Open the conversation: ${sessionLink}`,
    };
  }
  return null;
}

export function isDeliverable(row, session, now = Date.now()) {
  const payload = row.payload || {};
  const maxAge = row.topic === 'reflection_reminder' ? 7 : 2;
  const createdAt = new Date(row.created_at).getTime();
  if (!Number.isFinite(createdAt) || createdAt > now || now - createdAt > maxAge * 86400000) return false;
  if (row.topic === 'reflection_reminder') return true;
  if (!session) return false;
  if (row.topic === 'session_request_received') {
    return session.status === 'pending' && session.mentor_id === row.user_id;
  }
  if (row.topic === 'session_request_accepted') {
    return session.status === 'scheduled' && session.mentee_id === row.user_id;
  }
  if (row.topic === 'meeting_reminder') {
    return session.status === 'scheduled' &&
      (row.user_id === session.mentor_id || row.user_id === session.mentee_id) &&
      new Date(session.scheduled_at).getTime() === new Date(payload.scheduled_at).getTime() &&
      new Date(session.scheduled_at).getTime() > now;
  }
  return false;
}
