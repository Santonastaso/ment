import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { invokeUserFunction } from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { sessionPath } from '../lib/conversationLinks.mjs';

export default function CalendarCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useT();
  const [error, setError] = useState('');

  useEffect(() => {
    const state = params.get('state') || '';
    const code = params.get('code') || '';
    let provider = '';
    let sessionId = null;
    try {
      const payload = state.split('.')[0].replaceAll('-', '+').replaceAll('_', '/');
      const parsed = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
      provider = parsed.provider;
      sessionId = Number.isSafeInteger(parsed.sessionId) && parsed.sessionId > 0 ? parsed.sessionId : null;
    } catch { setError(t('components.calendarCallback.invalidResponse')); return; }
    invokeUserFunction('calendar-provider', { action: 'exchange', provider, code, state })
      .then(async ({ data, error: invokeError }) => {
        if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message);
        const sessions = sessionId ? (await api.get('/sessions')).data : [];
        const session = sessions.find(item => item.id === sessionId);
        navigate(session?.route_token ? sessionPath(session) : '/conversations', { replace: true });
      })
      .catch(() => setError(t('components.calendarCallback.error')));
  }, [navigate, params, t]);

  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><div className="max-w-md rounded-2xl bg-card p-6 text-center"><h1 className="text-xl font-semibold">{t('components.calendarCallback.title')}</h1>{error ? <><p className="mt-3 text-sm text-destructive">{error}</p><Link className="mt-4 inline-block underline" to="/conversations">{t('components.calendarCallback.return')}</Link></> : <p className="mt-2 text-sm text-muted-foreground">{t('components.calendarCallback.progress')}</p>}</div></main>;
}
