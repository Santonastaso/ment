// In-browser .ics generator (RFC 5545). Replaces the server-side route.

function toIcsDate(input) {
  return new Date(input).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(str) {
  return (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder('utf-8');
  const parts = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const limit = first ? 75 : 74;
    parts.push(decoder.decode(bytes.slice(offset, offset + limit)));
    offset += limit;
    first = false;
  }
  return parts.join('\r\n ');
}

function uid() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function buildSessionIcs(session, mentor, mentee) {
  if (!session?.scheduled_at) throw new Error('session_has_no_scheduled_at');
  const now = toIcsDate(new Date().toISOString());
  const start = toIcsDate(session.scheduled_at);
  const end = toIcsDate(new Date(new Date(session.scheduled_at).getTime() + (session.duration_minutes || 60) * 60_000));

  const description = escapeIcsText(
    `Mentoring session: ${session.title}\n` +
    `Mentor: ${mentor.name}\n` +
    `Mentee: ${mentee.name}` +
    (session.pre_session_question ? `\n\nFocus question: ${session.pre_session_question}` : '')
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MENT//MicroMentoring//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:session-${session.id}-${uid()}@ment`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(session.title)}`,
    `DESCRIPTION:${description}`,
    `ORGANIZER;CN=${escapeIcsText(mentor.name)}:mailto:${mentor.email || ''}`,
    `ATTENDEE;CN=${escapeIcsText(mentee.name)};ROLE=REQ-PARTICIPANT:mailto:${mentee.email || ''}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function downloadIcs(filename, content) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
