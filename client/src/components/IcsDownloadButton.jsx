import React, { useEffect, useState } from 'react';
import { CalendarDays, Download, ExternalLink } from 'lucide-react';
import api, { invokeUserFunction } from '../api/index.js';
import { buildSessionIcs, downloadIcs } from '../lib/ics.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.jsx';


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

export default function IcsDownloadButton({ sessionId, session, className = '', label, meetingUrl }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
    } catch {
      setError(t('components.ics.downloadFailed'));
    } finally { setLoading(''); }
  }

  const connected = new Set(connections.map((item) => item.provider));
  const actionLabel = label || t('components.ics.addToCalendar');

  return <>
    <Button type="button" size="sm" className={className} onClick={() => setOpen(true)}><CalendarDays aria-hidden="true" />{actionLabel}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.ics.addToCalendar')}</DialogTitle>
          <DialogDescription>{t('components.ics.chooseMethod')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {providers.length === 0 && <p className="text-sm text-muted-foreground">{t('components.ics.noProvider')}</p>}
          {providers.map(provider => <Button key={provider} type="button" variant="outline" className="w-full justify-start" disabled={!!loading} onClick={() => connected.has(provider) ? createEvent(provider) : connect(provider)}><CalendarDays aria-hidden="true" />{loading === provider ? t('common.loading') : t(`components.ics.${connected.has(provider) ? 'add' : 'connect'}.${provider}`)}</Button>)}
          <Button type="button" variant="outline" className="w-full justify-start" disabled={!!loading} onClick={download}><Download aria-hidden="true" />{loading === 'ics' ? t('components.ics.downloading') : t('components.ics.download')}</Button>
          {(created?.html_url || created?.join_url || meetingUrl) && <a className="inline-flex items-center gap-2 rounded-[var(--control-radius)] px-4 py-2 text-sm font-medium hover:bg-[var(--control-surface)]" href={created?.html_url || created?.join_url || meetingUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden="true" />{created?.html_url ? t('components.ics.openEvent') : t('components.ics.join')}</a>}
        </div>
        {created && <p role="status" className="text-sm text-muted-foreground">{t('components.ics.ready')}</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
