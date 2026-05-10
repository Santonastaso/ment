import React, { useEffect, useState } from 'react';
import api from '../api/index.js';
import MeetingRow from './MeetingRow.jsx';

// Past = sessions you've explicitly marked complete. Sessions whose time has
// passed but haven't been marked are surfaced on the Dashboard's
// "Needs your attention" panel instead, where the action lives.
export default function PastMeetings({ currentUserId }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/sessions');
      const past = (res.data || [])
        .filter(s => s.status === 'completed')
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
    return <p className="text-sm text-gray-400">Loading past meetings…</p>;
  }
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No completed meetings yet. Once you finish a session and mark it complete, it'll show up here.
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
