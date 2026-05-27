import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import MatchCard from '../components/MatchCard.jsx';
import SessionCard from '../components/SessionCard.jsx';
import ReflectionLog from '../components/ReflectionLog.jsx';
import AcceptanceModal from '../components/AcceptanceModal.jsx';
import { PageShell, PageSection } from '../components/PageShell.jsx';
import { Surface, SurfaceBody } from '../components/Surface.jsx';
import api from '../api/index.js';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

const POLL_INTERVAL_MS = 30000;

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
function numberWord(n) {
  if (n >= 0 && n < NUMBER_WORDS.length) return NUMBER_WORDS[n];
  return String(n);
}

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
      window.location.assign('/?checkin=1');
      n.close();
    };
  } catch { /* notification API can throw on some browsers; ignore */ }
}

export default function Dashboard() {
  const { user, refreshPendingAcceptances } = useAuth();
  const [pendingAcceptances, setPendingAcceptances] = useState([]);
  const [acceptanceModalDismissed, setAcceptanceModalDismissed] = useState(false);
  const [monthlyCompleted, setMonthlyCompleted] = useState(null);
  const [matches, setMatches] = useState([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [checkinDue, setCheckinDue] = useState(false);
  const [pendingFromAdmin, setPendingFromAdmin] = useState(false);
  const [lastEntryDays, setLastEntryDays] = useState(null);
  const [showDashboardCheckin, setShowDashboardCheckin] = useState(false);
  const [checkinOpenToken, setCheckinOpenToken] = useState(0);
  const [notifPermission, setNotifPermission] = useState(
    notificationsSupported() ? Notification.permission : 'unsupported'
  );
  // Track previous state across polls so we only fire desktop notifications on edges
  const prevDueRef = useRef(false);
  const prevAdminRef = useRef(false);
  const checkinSectionRef = useRef(null);

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

  const loadCheckinStatus = useCallback(async ({ notify = false } = {}) => {
    const res = await api.get('/reflections');
    const due = !!res.data.dueForCheckIn;
    const fromAdmin = !!res.data.pendingFromAdmin;
    setCheckinDue(due);
    setPendingFromAdmin(fromAdmin);
    setLastEntryDays(res.data.lastEntryDays);
    if (notify) {
      const becameAdmin = fromAdmin && !prevAdminRef.current;
      const becameDue = due && !prevDueRef.current;
      if (becameAdmin || becameDue) {
        fireDesktopNotification({ adminTriggered: fromAdmin });
      }
    }
    prevDueRef.current = due;
    prevAdminRef.current = fromAdmin;
  }, []);

  const openCheckin = useCallback(() => {
    setShowDashboardCheckin(true);
    setCheckinOpenToken(t => t + 1);
    requestAnimationFrame(() => {
      checkinSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // Poll the reflections endpoint so an admin broadcast lands within ~30s
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        await loadCheckinStatus({ notify: true });
      } catch {
        if (cancelled) return;
      }
    }
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [loadCheckinStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('checkin') === '1' || window.location.hash === '#checkin') {
      openCheckin();
      window.history.replaceState(null, '', '/');
    }
  }, [openCheckin]);

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

  // Fetch the full list of pending acceptances (each enriched with mentor
  // info) so the modal can render names + topics. Also refreshes the
  // AuthContext badge so it always matches what the modal shows.
  const loadPendingAcceptances = useCallback(async () => {
    try {
      const res = await api.get('/sessions/pending-acceptances');
      setPendingAcceptances(Array.isArray(res.data) ? res.data : []);
    } catch {
      setPendingAcceptances([]);
    }
    try {
      await refreshPendingAcceptances?.();
    } catch { /* noop */ }
  }, [refreshPendingAcceptances]);

  const loadMonthlyCount = useCallback(async () => {
    try {
      const res = await api.get('/users/me/monthly-count');
      setMonthlyCompleted(res?.data?.completed ?? 0);
    } catch {
      setMonthlyCompleted(null);
    }
  }, []);

  useEffect(() => {
    loadMatches();
    loadSessions();
    loadPendingAcceptances();
    loadMonthlyCount();
  }, [loadMatches, loadSessions, loadPendingAcceptances, loadMonthlyCount]);

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
    <PageShell
      title={`Welcome back, ${user?.name?.split(' ')[0]}`}
      description="Mentor suggestions and sessions that need your attention."
      className="gap-8"
    >

      {pendingAcceptances.length > 0 && !acceptanceModalDismissed && (
        <AcceptanceModal
          sessions={pendingAcceptances}
          onAcknowledged={async () => {
            await loadPendingAcceptances();
            await loadSessions();
            await refreshPendingAcceptances();
          }}
          onClose={() => setAcceptanceModalDismissed(true)}
        />
      )}

      {(user?.monthly_session_goal ?? 0) > 0 && monthlyCompleted !== null && (
        <GoalNudge
          goal={user.monthly_session_goal}
          completed={monthlyCompleted}
        />
      )}

      {checkinDue && (
        <Alert className="relative border-primary/20 bg-primary/5">
          <AlertTitle>{pendingFromAdmin ? 'New weekly check-in from your admin' : 'Time for your weekly check-in'}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {pendingFromAdmin
                ? 'Two short questions about your week. Helps refine your matches and surface skills you can mentor on.'
                : lastEntryDays === null
                  ? 'Two short questions. Your answers feed your skill landscape over time.'
                  : `It's been ${lastEntryDays} days. Two short questions, that's it.`}
            </p>
            {notifPermission === 'default' && (
              <button type="button" onClick={handleEnableNotifications} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                Enable desktop notifications
              </button>
            )}
          </AlertDescription>
          <Button type="button" onClick={openCheckin} className="mt-3 inline-flex sm:absolute sm:right-4 sm:top-4 sm:mt-0">
            Open check-in
          </Button>
        </Alert>
      )}

      {(showDashboardCheckin || checkinDue) && (
        <div ref={checkinSectionRef} id="checkin" className="scroll-mt-8">
          <Surface className="border-primary/30 bg-primary/5">
            <SurfaceBody className="pt-5">
              <div className="mb-4">
                <p className="text-sm font-semibold text-foreground">Weekly check-in</p>
                <p className="mt-1 text-sm text-muted-foreground">Two short answers help keep your mentoring matches current.</p>
              </div>
              <ReflectionLog
                initialOpen={showDashboardCheckin || checkinDue}
                autoOpenToken={checkinOpenToken}
                onSubmitted={() => {
                  // Keep the dashboard panel mounted after submit even if
                  // checkinDue flips to false (the user just acknowledged it).
                  // Otherwise the just-submitted entry would vanish along
                  // with its skill-signal chips and apply CTA.
                  setShowDashboardCheckin(true);
                  loadCheckinStatus();
                }}
                hideHistory
              />
            </SurfaceBody>
          </Surface>
        </div>
      )}

      {!checkinDue && notifPermission === 'default' && (
        <p className="-mt-6 text-xs text-muted-foreground">
          <button type="button" onClick={handleEnableNotifications} className="font-medium text-primary hover:underline">
            Enable desktop notifications
          </button>{' '}
          for OS-level toasts when your weekly check-in is ready.
        </p>
      )}

      <PageSection
        title="Mentors for you"
        description={
          loadingMatches
            ? 'Looking for colleagues who could help you grow…'
            : matches.length === 0
              ? 'No mentor suggestions yet — complete your skills so we can match you.'
              : matches.length === 1
                ? 'One colleague who could mentor you on what you\'re trying to grow.'
                : `${numberWord(matches.length)} colleagues who could mentor you on what you're trying to grow.`
        }
        action={
          totalMatches > matches.length ? (
            <Link to="/explorer" className="text-sm font-medium text-primary hover:underline">
              Browse {totalMatches - matches.length} more in Explorer →
            </Link>
          ) : null
        }
      >
        {loadingMatches ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
          </div>
        ) : matches.length === 0 ? (
          <Surface>
            <SurfaceBody className="py-10 text-center">
              <p className="font-medium mb-1">No matches yet</p>
              <p className="text-sm text-muted-foreground mb-4">Complete your profile skills so we can find mentors for you.</p>
              <Link to="/profile" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>Complete profile</Link>
            </SurfaceBody>
          </Surface>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {matches.map(match => (
              <MatchCard
                key={match.matchId || match.user.id}
                match={match}
                onDismiss={handleDismissMatch}
              />
            ))}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Your sessions"
        description={
          <>
            Past meetings live on your <Link to="/profile" className="text-primary hover:underline">profile</Link>.
          </>
        }
      >
        {loadingSessions ? (
          <div className="space-y-3">
            {[1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : (needsAction.length === 0 && upcoming.length === 0) ? (
          <Surface>
            <SurfaceBody className="py-8 text-center text-sm text-muted-foreground">
              No active sessions yet. Request one from your mentor suggestions above.
            </SurfaceBody>
          </Surface>
        ) : (
          <div className="space-y-6">
            {needsAction.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                  <h3 className="label-meta mb-0">Needs your attention</h3>
                  <span className="text-xs text-muted-foreground">{needsAction.length}</span>
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
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <h3 className="label-meta mb-0">Upcoming</h3>
                  <span className="text-xs text-muted-foreground">{upcoming.length}</span>
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
      </PageSection>
    </PageShell>
  );
}

// Soft goal nudge — non-blocking, no rigid targets. Uses copy that scales
// with how close the user is to their monthly_session_goal.
function GoalNudge({ goal, completed }) {
  const ratio = goal > 0 ? completed / goal : 0;
  let tone = 'border-primary/20 bg-primary/5 text-primary';
  let msg;
  if (completed >= goal) {
    tone = 'border-emerald-200 bg-emerald-50 text-emerald-800';
    msg = `Goal hit — ${completed}/${goal} sessions this month. Nice rhythm.`;
  } else if (goal - completed === 1) {
    tone = 'border-amber-200 bg-amber-50 text-amber-800';
    msg = `You're one session away from your monthly goal of ${goal}.`;
  } else if (ratio >= 0.5) {
    tone = 'border-amber-200 bg-amber-50 text-amber-800';
    msg = `${completed}/${goal} sessions done this month — over halfway there.`;
  } else {
    msg = `${completed}/${goal} sessions this month. Keep the conversations going.`;
  }
  return (
    <div data-testid="goal-nudge" className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
      {msg}
    </div>
  );
}
