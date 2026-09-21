import React, { useEffect, useState } from 'react';
import api from '../api/index.js';
import { buildSessionIcs, downloadIcs } from '../lib/ics.js';
import { supabase } from '../lib/supabase.js';
import { useT } from '../i18n/index.jsx';

export default function IcsDownloadButton({ sessionId, session, className = '', label, meetingUrl, onReschedule }) {
  const { t } = useT();
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState('');
  const [created, setCreated] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.functions.invoke('calendar-provider', { body: { action: 'status' } })
      .then(({ data, error: invokeError }) => {
        if (invokeError || data?.error) throw new Error(data?.error || invokeError.message);
        setConnections(data.connections || []);
      })
      .catch(() => setConnections([]));
  }, []);

  async function connect(provider) {
    setLoading(provider); setError('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('calendar-provider', { body: { action: 'authorization_url', provider } });
      if (invokeError || data?.error) throw new Error(data?.error || invokeError.message);
      window.location.assign(data.url);
    } catch (requestError) {
      setError(requestError.message === 'calendar_provider_not_configured' ? 'This calendar provider is not configured yet.' : 'Could not connect the calendar.');
      setLoading('');
    }
  }

  async function createEvent(provider) {
    setLoading(provider); setError('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('calendar-provider', { body: { action: 'create_event', provider, session_id: sessionId } });
      if (invokeError || data?.error) throw new Error(data?.error || invokeError.message);
      setCreated(data);
    } catch (requestError) {
      setError(requestError.message === 'calendar_not_connected' ? 'Reconnect your calendar and try again.' : 'Could not create the calendar event.');
    } finally { setLoading(''); }
  }

  async function download() {
    setLoading('ics'); setError('');
    try {
      const current = session || (await api.get('/sessions/' + sessionId)).data;
      if (!current?.scheduled_at) throw new Error('no_scheduled_at');
      downloadIcs('session-' + sessionId + '.ics', buildSessionIcs(current, current.mentor, current.mentee));
    } catch {
      setError('Could not download the calendar file.');
    } finally { setLoading(''); }
  }

  const connected = new Set(connections.map((item) => item.provider));
  return <div className="calendar-action">
    <details className="calendar-more">
      <summary className={className}>{created ? 'Meeting ready' : (label || t('components.ics.addToCalendar'))}</summary>
      <div className="calendar-more-menu">
        {(created?.join_url || meetingUrl) && <a href={created?.join_url || meetingUrl} target="_blank" rel="noreferrer">Join meeting</a>}
        {onReschedule && <button type="button" onClick={onReschedule}>Change time</button>}
        {connected.has('google') ? <button type="button" disabled={!!loading} onClick={() => createEvent('google')}>{loading === 'google' ? 'Adding…' : 'Add with Google'}</button> : <button type="button" disabled={!!loading} onClick={() => connect('google')}>Connect Google Calendar</button>}
        {connected.has('microsoft') ? <button type="button" disabled={!!loading} onClick={() => createEvent('microsoft')}>{loading === 'microsoft' ? 'Adding…' : 'Add with Outlook'}</button> : <button type="button" disabled={!!loading} onClick={() => connect('microsoft')}>Connect Outlook</button>}
        <button type="button" disabled={!!loading} onClick={download}>{loading === 'ics' ? 'Downloading…' : 'Download .ics'}</button>
        {created?.html_url && <a href={created.html_url} target="_blank" rel="noreferrer">Open calendar event</a>}
      </div>
    </details>
    {error && <p className="w-full text-xs text-destructive" role="status" aria-live="polite">{error}</p>}
  </div>;
}
