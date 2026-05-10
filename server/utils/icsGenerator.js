const { v4: uuidv4 } = require('uuid');

function toIcsDate(isoString) {
  return new Date(isoString).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(str) {
  return (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function foldLine(line) {
  // RFC 5545: fold lines longer than 75 octets
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const limit = first ? 75 : 74;
    parts.push(bytes.slice(offset, offset + limit).toString('utf8'));
    offset += limit;
    first = false;
  }
  return parts.join('\r\n ');
}

function generateIcs(session, mentor, mentee) {
  const now = toIcsDate(new Date().toISOString());
  const start = toIcsDate(session.scheduled_at);
  const endDate = new Date(session.scheduled_at);
  endDate.setMinutes(endDate.getMinutes() + (session.duration_minutes || 60));
  const end = toIcsDate(endDate.toISOString());

  const uid = `session-${session.id}-${uuidv4()}@ment`;
  const description = escapeIcsText(
    `Mentoring session: ${session.title}\nMentor: ${mentor.name}\nMentee: ${mentee.name}` +
    (session.pre_session_question ? `\n\nFocus question: ${session.pre_session_question}` : '')
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MENT//MicroMentoring//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(session.title)}`,
    `DESCRIPTION:${description}`,
    `ORGANIZER;CN=${escapeIcsText(mentor.name)}:mailto:${mentor.email}`,
    `ATTENDEE;CN=${escapeIcsText(mentee.name)};ROLE=REQ-PARTICIPANT:mailto:${mentee.email}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  return lines.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = { generateIcs };
