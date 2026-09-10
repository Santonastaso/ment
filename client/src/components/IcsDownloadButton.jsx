import React, { useState } from 'react';
import api from '../api/index.js';
import { buildSessionIcs, downloadIcs } from '../lib/ics.js';
import { useT } from '../i18n/index.jsx';

function calendarUrl(provider, session) {
  if (!session?.scheduled_at) return '';
  const start = new Date(session.scheduled_at);
  const end = new Date(start.getTime() + (session.duration_minutes || 60) * 60_000);
  const format = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const details = [session.pre_session_question, session.meeting_url].filter(Boolean).join('\n\n');
  const title = encodeURIComponent(session.title || 'Mentoring session');
  const startValue = format(start);
  const endValue = format(end);
  if (provider === 'google') {
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + title + '&dates=' + startValue + '/' + endValue + '&details=' + encodeURIComponent(details) + '&location=' + encodeURIComponent(session.meeting_url || '');
  }
  return 'https://outlook.live.com/calendar/0/deeplink/compose?subject=' + title + '&startdt=' + encodeURIComponent(start.toISOString()) + '&enddt=' + encodeURIComponent(end.toISOString()) + '&body=' + encodeURIComponent(details) + '&location=' + encodeURIComponent(session.meeting_url || '');
}

export default function IcsDownloadButton({ sessionId, session, className = '' }) {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleDownload() {
    setLoading(true);
    setError('');
    try {
      const current = session || (await api.get('/sessions/' + sessionId)).data;
      if (!current) throw new Error('not_found');
      if (!current.scheduled_at) throw new Error('no_scheduled_at');
      downloadIcs('session-' + sessionId + '.ics', buildSessionIcs(current, current.mentor, current.mentee));
    } catch (e) {
      setError('Could not add the session to your calendar. Please try again.');
      console.error('ICS download failed', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={handleDownload} disabled={loading} className={'flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-50 ' + className}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2V7H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        {loading ? t('components.ics.downloading') : t('components.ics.addToCalendar')}
      </button>
      {session?.scheduled_at && (
        <details className="calendar-more">
          <summary>More</summary>
          <div className="calendar-more-menu">
            <a href={calendarUrl('google', session)} target="_blank" rel="noreferrer">Google Calendar</a>
            <a href={calendarUrl('outlook', session)} target="_blank" rel="noreferrer">Outlook</a>
            <a href="https://meet.google.com/new" target="_blank" rel="noreferrer">Google Meet</a>
          </div>
        </details>
      )}
      {error && <p className="w-full text-xs text-destructive" role="status" aria-live="polite">{error}</p>}
    </div>
  );
}
