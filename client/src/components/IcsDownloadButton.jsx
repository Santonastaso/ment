import React, { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { buildSessionIcs, downloadIcs } from '../lib/ics.js';

export default function IcsDownloadButton({ sessionId, className = '' }) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const { data: session, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
      if (error || !session) throw error || new Error('not_found');
      if (!session.scheduled_at) throw new Error('no_scheduled_at');

      const [{ data: mentor }, { data: mentee }] = await Promise.all([
        supabase.from('profiles').select('id, name').eq('id', session.mentor_id).single(),
        supabase.from('profiles').select('id, name').eq('id', session.mentee_id).single(),
      ]);
      const { data: viewer } = await supabase.auth.getUser();
      const myEmail = viewer?.user?.email || '';

      const ics = buildSessionIcs(
        session,
        { ...mentor, email: viewer?.user?.id === session.mentor_id ? myEmail : '' },
        { ...mentee, email: viewer?.user?.id === session.mentee_id ? myEmail : '' }
      );
      downloadIcs(`session-${sessionId}.ics`, ics);
    } catch (e) {
      console.error('ICS download failed', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className={`flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-50 ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      {loading ? 'Downloading…' : 'Add to calendar'}
    </button>
  );
}
