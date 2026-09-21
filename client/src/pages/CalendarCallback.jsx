import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';

export default function CalendarCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const state = params.get('state') || '';
    const code = params.get('code') || '';
    let provider = '';
    try {
      const payload = state.split('.')[0].replaceAll('-', '+').replaceAll('_', '/');
      provider = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).provider;
    } catch { setError('The calendar authorization response is invalid.'); return; }
    supabase.functions.invoke('calendar-provider', { body: { action: 'exchange', provider, code, state } })
      .then(({ data, error: invokeError }) => {
        if (invokeError || data?.error) throw new Error(data?.error || invokeError.message);
        navigate('/conversations', { replace: true });
      })
      .catch((requestError) => setError(requestError.message || 'Could not connect the calendar.'));
  }, []);

  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><div className="max-w-md rounded-2xl bg-card p-6 text-center"><h1 className="text-xl font-semibold">Connecting calendar</h1>{error ? <><p className="mt-3 text-sm text-destructive">{error}</p><Link className="mt-4 inline-block underline" to="/conversations">Return to messages</Link></> : <p className="mt-2 text-sm text-muted-foreground">Finishing the secure connection…</p>}</div></main>;
}
