// Meetings are shown in Paris time (CET, or CEST in summer), the programme's home time zone.
export function formatMeetingTime(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year} at ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

// Every email is plain text: a greeting, a short paragraph, one link and the
// same footer. None names the other member or quotes anything they wrote.
function email(subject, paragraphs, action, link, origin) {
  const footer = `You're receiving this because you have a MENT account. You can change your email settings in your profile: ${origin}/profile\nMENT · Mentoring platform · Privacy notice: ${origin}/privacy`;
  return {
    subject,
    text: ['Hello,', ...paragraphs, `${action}: ${link}`, 'The MENT team', '—', footer].join('\n\n'),
  };
}

export function messageFor(topic, payload, origin, routeToken) {
  const sessionId = Number(payload.session_id);
  const sessionLink = typeof routeToken === 'string' && /^[A-Za-z0-9_-]{16}$/.test(routeToken)
    ? `${origin}/c/${routeToken}` : `${origin}/conversations`;
  if (topic === 'reflection_reminder') return email(
    'Two minutes to look back on your week',
    ["Take two minutes to note what went well this week and what you'd like to learn next. Your reflections are private to you."],
    'Write a reflection', `${origin}/profile`, origin,
  );
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return null;
  if (topic === 'session_request_received') return email(
    'Someone would like your advice on MENT',
    [
      "A member of your community has sent you a request on MENT. They'd value your experience, and a short conversation can make a real difference.",
      'Take a look and reply when you can. Requests stay open for 7 days.',
    ],
    'View the request', sessionLink, origin,
  );
  if (topic === 'session_request_accepted') return email(
    'Good news: your request was accepted',
    ["Your request was accepted. The conversation is open on MENT, so you can share what you'd like to discuss and agree on a time."],
    'Open the conversation', sessionLink, origin,
  );
  if (topic === 'session_message_received') return email(
    'You have a new message on MENT',
    ['You have a new message waiting in one of your MENT conversations.'],
    'Read the message', sessionLink, origin,
  );
  if (topic === 'meeting_reminder') {
    const time = typeof payload.scheduled_at === 'string' ? new Date(payload.scheduled_at) : null;
    if (!time || Number.isNaN(time.getTime())) return null;
    return email(
      'Reminder: your MENT meeting is coming up',
      [
        `A quick reminder that your meeting is scheduled for ${formatMeetingTime(time)}.`,
        'A tip: note down one or two questions beforehand. It helps make the most of the time.',
      ],
      'Open the conversation', sessionLink, origin,
    );
  }
  return null;
}

export function isDeliverableEmail(value, blockedDomains = []) {
  if (typeof value !== 'string') return false;
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1);
  const blocked = new Set(blockedDomains.map(item => String(item).trim().toLowerCase()).filter(Boolean));
  return !blocked.has(domain) &&
    !domain.endsWith('.invalid') &&
    !domain.endsWith('.test') &&
    !domain.endsWith('.example');
}

export function isDeliverable(
  row,
  session,
  now = Date.now(),
  message = /** @type {Record<string, any> | null} */ (null),
) {
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
  if (row.topic === 'session_message_received') {
    const messageId = Number(payload.message_id);
    return Number.isSafeInteger(messageId) && messageId > 0 &&
      session && message && message.id === messageId &&
      message.session_id === Number(payload.session_id) &&
      message.kind === 'message' && message.sender_id !== row.user_id &&
      (row.user_id === session.mentor_id || row.user_id === session.mentee_id) &&
      (!message.last_read_at || new Date(message.last_read_at).getTime() < new Date(message.created_at).getTime());
  }
  if (row.topic === 'meeting_reminder') {
    return session.status === 'scheduled' &&
      (row.user_id === session.mentor_id || row.user_id === session.mentee_id) &&
      new Date(session.scheduled_at).getTime() === new Date(payload.scheduled_at).getTime() &&
      new Date(session.scheduled_at).getTime() > now;
  }
  return false;
}
