import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import MatchCard from '../components/MatchCard.jsx';
import SessionCard from '../components/SessionCard.jsx';
import api from '../api/index.js';

const POLL_INTERVAL_MS = 30000;

function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function fireDesktopNotification({ adminTriggered }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('MENT — weekly check-in', {
      body: adminTriggered
        ? 'Your team admin just opened this week\'s reflection. Two short questions about your week.'
        : 'It\'s time for your weekly check-in. Two short questions, helps refine your matches.',
      tag: 'ment-checkin',          // collapses repeat notifications
      renotify: false,
      requireInteraction: false,
    });
    n.onclick = () => {
      window.focus();
      window.location.assign('/profile#reflection-log');
      n.close();
    };
  } catch { /* notification API can throw on some browsers; ignore */ }
}

export default function Dashboard() {
  const { user } = useAuth();
  const [matches, setMatches] = useState([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [checkinDue, setCheckinDue] = useState(false);
  const [pendingFromAdmin, setPendingFromAdmin] = useState(false);
  const [lastEntryDays, setLastEntryDays] = useState(null);
  const [notifPermission, setNotifPermission] = useState(
    notificationsSupported() ? Notification.permission : 'unsupported'
  );
  // Track previous state across polls so we only fire desktop notifications on edges
  const prevDueRef = useRef(false);
  const prevAdminRef = useRef(false);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    try {
      // Dashboard suggestions are mentor-leaning only — the viewer should
      // always be the one reaching out to a potential mentor.
      const res = await api.get('/matches?limit=3&role=mentor');
      setMatches(res.data.matches || []);
      setTotalMatches(res.data.total || 0);
    } finally {
      setLoadingMatches(false);
    }
  }, []);

  // Poll the reflections endpoint so an admin broadcast lands within ~30s
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await api.get('/reflections');
        if (cancelled) return;
        const due = !!res.data.dueForCheckIn;
        const fromAdmin = !!res.data.pendingFromAdmin;
        setCheckinDue(due);
        setPendingFromAdmin(fromAdmin);
        setLastEntryDays(res.data.lastEntryDays);
        // Fire a desktop notification on the edge: admin just triggered, or it just became due
        const becameAdmin = fromAdmin && !prevAdminRef.current;
        const becameDue = due && !prevDueRef.current;
        if (becameAdmin || becameDue) {
          fireDesktopNotification({ adminTriggered: fromAdmin });
        }
        prevDueRef.current = due;
        prevAdminRef.current = fromAdmin;
      } catch { /* network blip — keep polling */ }
    }
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  async function handleEnableNotifications() {
    if (!notificationsSupported()) return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      if (result === 'granted') {
        // Fire a confirmation toast so the user sees what to expect
        new Notification('MENT desktop notifications enabled', {
          body: 'You\'ll see a toast when your weekly check-in is ready.',
          tag: 'ment-checkin-confirm',
        });
      }
    } catch { /* ignore */ }
  }

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await api.get('/sessions');
      setSessions(res.data);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadMatches();
    loadSessions();
  }, [loadMatches, loadSessions]);

  function handleSessionUpdate(updated) {
    setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
  }

  function handleDismissMatch(userId) {
    setMatches(prev => prev.filter(m => m.user.id !== userId));
  }

  // Split active sessions into two visual groups:
  //   "Needs your attention" — pending you (the mentor) need to accept, or
  //                             scheduled meetings whose time has already passed
  //                             (the mentee needs to mark them complete).
  //   "Upcoming"             — everything else that isn't completed/cancelled.
  const now = Date.now();
  const needsAction = sessions.filter(s => {
    if (s.status === 'pending' && s.mentor?.id === user?.id) return true;
    if (s.status === 'scheduled' && s.scheduled_at && new Date(s.scheduled_at).getTime() < now) return true;
    return false;
  });
  const needsActionIds = new Set(needsAction.map(s => s.id));
  const upcoming = sessions.filter(s => {
    if (needsActionIds.has(s.id)) return false;
    return s.status !== 'completed' && s.status !== 'cancelled';
  }).sort((a, b) => {
    // Confirmed-with-date first, then by date; pending without a date sorted by created_at desc
    const aD = a.status === 'scheduled' && a.scheduled_at ? new Date(a.scheduled_at).getTime() : null;
    const bD = b.status === 'scheduled' && b.scheduled_at ? new Date(b.scheduled_at).getTime() : null;
    if (aD !== null && bD !== null) return aD - bD;
    if (aD !== null) return -1;
    if (bD !== null) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-ink tracking-tight">Welcome back, {user?.name?.split(' ')[0]}</h1>
        <p className="text-ink-secondary mt-1.5">Here's who you should connect with today.</p>
      </div>

      {/* Weekly check-in nudge */}
      {checkinDue && (
        <div className="bg-gradient-to-r from-blue-50 to-amber-50 border border-blue-200 rounded-xl p-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-white border border-blue-200 flex items-center justify-center text-xl flex-shrink-0">✦</div>
            <div>
              <p className="text-navy font-semibold text-sm">
                {pendingFromAdmin ? 'New weekly check-in from your admin' : 'Time for your weekly check-in'}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {pendingFromAdmin
                  ? 'Two short questions about your week. Helps refine your matches and surface skills you can mentor on.'
                  : lastEntryDays === null
                    ? 'Two short questions. Your answers feed your skill landscape over time.'
                    : `It's been ${lastEntryDays} days. Two short questions, that's it.`}
              </p>
              {notifPermission === 'default' && (
                <button
                  onClick={handleEnableNotifications}
                  className="text-xs text-navy-light hover:text-navy font-medium mt-1.5 underline-offset-2 hover:underline"
                >
                  Enable desktop notifications
                </button>
              )}
              {notifPermission === 'denied' && (
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Desktop notifications were blocked — re-enable in your browser settings to get OS-level toasts.
                </p>
              )}
            </div>
          </div>
          <Link to="/profile#reflection-log" className="btn-primary text-sm whitespace-nowrap">
            Open check-in
          </Link>
        </div>
      )}

      {/* Out-of-banner enable nudge — only shown if we're not currently due AND permission still default */}
      {!checkinDue && notifPermission === 'default' && (
        <div className="text-xs text-gray-500 -mt-6">
          <button onClick={handleEnableNotifications} className="text-navy-light hover:text-navy font-medium hover:underline">
            Enable desktop notifications
          </button> to get OS-level toasts when your weekly check-in is ready.
        </div>
      )}

      {/* Section 1: Matches */}
      <section>
        <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="section-title mb-0">Mentors for you</h2>
            <p className="text-sm text-ink-secondary mt-1">Three colleagues who could mentor you on what you're trying to grow.</p>
          </div>
          {totalMatches > matches.length && (
            <Link to="/explorer" className="text-sm text-navy-light hover:text-navy font-medium">
              Browse {totalMatches - matches.length} more in Explorer →
            </Link>
          )}
        </div>
        {loadingMatches ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
            {[1,2,3].map(i => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="flex gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full bg-gray-200" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 rounded w-1/2" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-gray-200 rounded" />
                  <div className="h-3 bg-gray-200 rounded w-5/6" />
                </div>
              </div>
            ))}
          </div>
        ) : matches.length === 0 ? (
          <div className="card p-8 text-center mt-3">
            <div className="text-4xl mb-3">✦</div>
            <p className="text-navy font-semibold mb-1">Your matches are being calculated</p>
            <p className="text-gray-500 text-sm">Check back shortly — we're finding the right people for you based on your skills and goals.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
            {matches.map(match => (
              <MatchCard
                key={match.matchId || match.user.id}
                match={match}
                onDismiss={handleDismissMatch}
              />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Your sessions — split into "needs action" and "upcoming" */}
      <section>
        <div className="mb-4">
          <h2 className="section-title mb-0">Your sessions</h2>
          <p className="text-sm text-ink-secondary mt-1">Past meetings live on your <Link to="/profile" className="text-navy-light hover:underline">profile</Link>.</p>
        </div>

        {loadingSessions ? (
          <div className="space-y-3">
            {[1,2].map(i => <div key={i} className="card p-5 h-24 animate-pulse bg-gray-100" />)}
          </div>
        ) : (needsAction.length === 0 && upcoming.length === 0) ? (
          <div className="card p-6 text-center">
            <p className="text-gray-500 text-sm">No active sessions yet. Request one from your mentor suggestions above.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {needsAction.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-gold" />
                  <h3 className="label-meta mb-0 text-ink-secondary">Needs your attention</h3>
                  <span className="text-xs text-ink-tertiary">{needsAction.length}</span>
                </div>
                <div className="space-y-3">
                  {needsAction.map(session => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      currentUserId={user?.id}
                      onUpdate={handleSessionUpdate}
                    />
                  ))}
                </div>
              </div>
            )}

            {upcoming.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-navy-light" />
                  <h3 className="label-meta mb-0 text-ink-secondary">Upcoming</h3>
                  <span className="text-xs text-ink-tertiary">{upcoming.length}</span>
                </div>
                <div className="space-y-3">
                  {upcoming.map(session => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      currentUserId={user?.id}
                      onUpdate={handleSessionUpdate}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
