import React, { useEffect, useState } from 'react';
import api from '../api/index.js';
import MeetingRow from './MeetingRow.jsx';
import { useT } from '../i18n/index.jsx';

// Past = sessions the viewer has marked complete from their side (or that are
// fully completed). A session moves here as soon as the viewer completes,
// even if the counterpart hasn't yet. Sessions whose time has passed but the
// viewer hasn't marked are surfaced on the Dashboard's "Needs your attention"
// panel instead, where the action lives.
export default function PastMeetings({ currentUserId }) {
  const { t } = useT();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/sessions');
      const past = (res.data || [])
        .filter(s => s.status === 'completed' || s.viewer_completed)
        .sort((a, b) => {
          const ta = new Date(a.scheduled_at || a.created_at).getTime();
          const tb = new Date(b.scheduled_at || b.created_at).getTime();
          return tb - ta;
        });
      setSessions(past);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-400">{t('components.pastMeetings.loading')}</p>;
  }
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {t('components.pastMeetings.empty')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map(s => (
        <MeetingRow key={s.id} session={s} currentUserId={currentUserId} mode="past" onUpdate={load} />
      ))}
    </div>
  );
}
