import React, { useEffect, useState } from 'react';
import api from '../api/index.js';
import MeetingRow from './MeetingRow.jsx';

// Upcoming = anything that hasn't happened yet:
//   - scheduled meetings with a future date  → confirmed, ready to go
//   - pending invitations (sent or received) → awaiting one side's acceptance
// Both directions are surfaced so the mentee sees their sent request and the
// mentor sees their inbound request without having to check the dashboard.
export default function UpcomingMeetings({ currentUserId }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await api.get('/sessions');
        if (cancelled) return;
        const now = Date.now();
        const upcoming = (res.data || [])
          .filter(s => {
            if (s.status === 'pending') return true;
            if (s.status === 'scheduled') {
              // Treat undated scheduled sessions as upcoming too — they're confirmed
              // but waiting for a time to be set.
              return !s.scheduled_at || new Date(s.scheduled_at).getTime() >= now;
            }
            return false;
          })
          .sort((a, b) => {
            // Confirmed-with-date first (sorted by date), then everything else by created_at desc
            const aDate = a.status === 'scheduled' && a.scheduled_at ? new Date(a.scheduled_at).getTime() : null;
            const bDate = b.status === 'scheduled' && b.scheduled_at ? new Date(b.scheduled_at).getTime() : null;
            if (aDate !== null && bDate !== null) return aDate - bDate;
            if (aDate !== null) return -1;
            if (bDate !== null) return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
        setSessions(upcoming);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-400">Loading upcoming meetings…</p>;
  }
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Nothing scheduled yet. Accept an inbound request or send your own from the Dashboard, and the meeting will show up here once a date is set.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map(s => (
        <MeetingRow key={s.id} session={s} currentUserId={currentUserId} mode="upcoming" />
      ))}
    </div>
  );
}
