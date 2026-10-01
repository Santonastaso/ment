import React, { useEffect, useState } from 'react';
import api, { invokeUserFunction } from '../api/index.js';
import { buildSessionIcs, downloadIcs } from '../lib/ics.js';
import { useT } from '../i18n/index.jsx';


// supabase-js surfaces a non-2xx edge response as a FunctionsHttpError whose
// body hangs off `context`, not `data` — so the specific reason was being
// swallowed and every failure read as "Could not connect the calendar".
async function providerErrorMessage(error, t) {
  let code = error?.message;
  const response = error?.context;
  if (response?.json) {
    try { code = (await response.clone().json())?.error || code; } catch { /* non-JSON body */ }
  }
  if (code === 'calendar_provider_not_configured' || code === 'calendar_not_configured') {
    return t('components.ics.notConfigured');
  }
  if (code === 'calendar_not_connected' || code === 'calendar_reconnect_required') return t('components.ics.reconnect');
  if (code === 'calendar_event_owner_only') return t('components.ics.ownerOnly');
  return t('components.ics.connectFailed');
}

export default function IcsDownloadButton({ sessionId, session, className = '', label, meetingUrl, onReschedule }) {
  const { t } = useT();
  const [connections, setConnections] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState('');
  const [created, setCreated] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setCreated(null); setError('');
    invokeUserFunction('calendar-provider', { action: 'status' })
      .then(({ data, error: invokeError }) => {
        if (invokeError || data?.error) throw invokeError || new Error(data.error);
        if (cancelled) return;
        setConnections(data.connections || []);
        setProviders(data.providers || []);
      })
      .catch(() => { if (!cancelled) { setConnections([]); setProviders([]); } });
    return () => { cancelled = true; };
  }, [sessionId, session?.scheduled_at]);

  async function connect(provider) {
    setLoading(provider); setError('');
    try {
      const { data, error: invokeError } = await invokeUserFunction('calendar-provider', { action: 'authorization_url', provider, session_id: sessionId });
      if (invokeError || data?.error) throw invokeError || new Error(data.error);
      window.location.assign(data.url);
    } catch (requestError) {
      setError(await providerErrorMessage(requestError, t));
      setLoading('');
    }
  }

  async function createEvent(provider) {
    setLoading(provider); setError('');
    try {
      const { data, error: invokeError } = await invokeUserFunction('calendar-provider', { action: 'create_event', provider, session_id: sessionId });
      if (invokeError || data?.error) throw invokeError || new Error(data.error);
      setCreated(data);
    } catch (requestError) {
      setError(await providerErrorMessage(requestError, t));
    } finally { setLoading(''); }
  }

  async function download() {
    setLoading('ics'); setError('');
    try {
      const current = session || (await api.get('/sessions/' + sessionId)).data;
      if (!current?.scheduled_at) throw new Error('no_scheduled_at');
      // The calendar entry is named for whoever the viewer is meeting, not the
      // session's internal title — "Event 61" tells nobody anything.
      const peer = current.isMentor ? current.mentee : current.mentor;
      const summary = t('components.ics.summary', { name: peer?.name || t('components.match.unknown') });
      const slug = (peer?.name || 'ment').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      downloadIcs(`chat-with-${slug}.ics`, buildSessionIcs(current, current.mentor, current.mentee, { summary }));
    } catch {
      setError(t('components.ics.downloadFailed'));
    } finally { setLoading(''); }
  }

  const connected = new Set(connections.map((item) => item.provider));
  return <div className="calendar-action">
    <details className="calendar-more">
      <summary className={className}>{created ? t('components.ics.ready') : (label || t('components.ics.addToCalendar'))}</summary>
      <div className="calendar-more-menu">
        {(created?.join_url || meetingUrl) && <a href={created?.join_url || meetingUrl} target="_blank" rel="noreferrer">{t('components.ics.join')}</a>}
        {onReschedule && <button type="button" onClick={onReschedule}>{t('components.ics.changeTime')}</button>}
        {providers.map(provider => <button key={provider} type="button" disabled={!!loading} onClick={() => connected.has(provider) ? createEvent(provider) : connect(provider)}>{loading === provider ? t('common.loading') : t(`components.ics.${connected.has(provider) ? 'add' : 'connect'}.${provider}`)}</button>)}
        <button type="button" disabled={!!loading} onClick={download}>{loading === 'ics' ? t('components.ics.downloading') : t('components.ics.download')}</button>
        {created?.html_url && <a href={created.html_url} target="_blank" rel="noreferrer">{t('components.ics.openEvent')}</a>}
      </div>
    </details>
    {error && <p className="w-full text-xs text-destructive" role="status" aria-live="polite">{error}</p>}
  </div>;
}
