import React, { useState } from 'react';
import api from '../api/index.js';
import { buildSessionIcs, downloadIcs } from '../lib/ics.js';
import { useT } from '../i18n/index.jsx';

export default function IcsDownloadButton({ sessionId, className = '' }) {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleDownload() {
    setLoading(true);
    setError('');
    try {
      const { data: session } = await api.get(`/sessions/${sessionId}`);
      if (!session) throw new Error('not_found');
      if (!session.scheduled_at) throw new Error('no_scheduled_at');

      const ics = buildSessionIcs(
        session,
        session.mentor,
        session.mentee
      );
      downloadIcs(`session-${sessionId}.ics`, ics);
    } catch (e) {
      setError('Could not add the session to your calendar. Please try again.');
      console.error('ICS download failed', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        className={`flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-50 ${className}`}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {loading ? t('components.ics.downloading') : t('components.ics.addToCalendar')}
      </button>
      {error && (
        <p className="text-xs text-destructive" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
