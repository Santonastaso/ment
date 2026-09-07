import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SessionCard from '../components/SessionCard.jsx';
import ReflectionLog from '../components/ReflectionLog.jsx';
import AcceptanceModal from '../components/AcceptanceModal.jsx';
import SessionRequestModal from '../components/SessionRequestModal.jsx';
import HomeConversation from '../components/demo/HomeConversation.jsx';
import { PageShell, PageSection } from '../components/PageShell.jsx';
import { Surface, SurfaceBody } from '../components/Surface.jsx';
import api from '../api/index.js';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '../i18n/index.jsx';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 30000;

function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function fireDesktopNotification({ adminTriggered, t }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(t('dashboard.notif.checkinTitle'), {
      body: adminTriggered
        ? t('dashboard.notif.checkinBodyAdmin')
        : t('dashboard.notif.checkinBody'),
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
  const { t } = useT();
  const { user, refreshPendingAcceptances } = useAuth();
  const [pendingAcceptances, setPendingAcceptances] = useState([]);
  const [acceptanceModalDismissed, setAcceptanceModalDismissed] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [requestingPerson, setRequestingPerson] = useState(null);
  const [requestContext, setRequestContext] = useState({});
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [checkinDue, setCheckinDue] = useState(false);
  const [pendingFromAdmin, setPendingFromAdmin] = useState(false);
  const [showDashboardCheckin, setShowDashboardCheckin] = useState(false);
  const [checkinOpenToken, setCheckinOpenToken] = useState(0);
  // Track previous state across polls so we only fire desktop notifications on edges
  const prevDueRef = useRef(false);
  const prevAdminRef = useRef(false);
  const checkinSectionRef = useRef(null);
  const upcomingRef = useRef(null);
  const needsActionRef = useRef(null);

  const loadCheckinStatus = useCallback(async ({ notify = false } = {}) => {
    const res = await api.get('/reflections');
    const due = !!res.data.dueForCheckIn;
    const fromAdmin = !!res.data.pendingFromAdmin;
    setCheckinDue(due);
    setPendingFromAdmin(fromAdmin);
    if (notify) {
      const becameAdmin = fromAdmin && !prevAdminRef.current;
      const becameDue = due && !prevDueRef.current;
      if (becameAdmin || becameDue) {
        fireDesktopNotification({ adminTriggered: fromAdmin, t });
      }
    }
    prevDueRef.current = due;
    prevAdminRef.current = fromAdmin;
  }, [t]);

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

  useEffect(() => {
    loadSessions();
    loadPendingAcceptances();
  }, [loadSessions, loadPendingAcceptances]);

  function handleSessionUpdate(updated) {
    setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
  }


  // Snapshot strip taps: jump to the matching section below the fold.
  // "New requests" reopens the acceptance modal if it was dismissed.
  function handleSnapshotJump(key) {
    if (key === 'requests') {
      if (pendingAcceptances.length > 0) setAcceptanceModalDismissed(false);
      return;
    }
    if (key === 'attention') {
      needsActionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (key === 'upcoming') {
      upcomingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Split active sessions into two visual groups:
  //   "Needs your attention" — pending you (the mentor) need to accept, or
  //                             scheduled meetings whose time has already passed
  //                             (the mentee needs to mark them complete).
  //   "Upcoming"             — everything else that isn't completed/cancelled.
  const now = Date.now();
  const needsAction = sessions.filter(s => {
    // Once the viewer has marked their side complete, the session belongs in
    // Past meetings — not in their active queue, even if the counterpart
    // hasn't completed yet (status stays 'scheduled').
    if (s.viewer_completed) return false;
    if (s.status === 'pending' && s.mentor?.id === user?.id) return true;
    if (s.status === 'scheduled' && s.scheduled_at && new Date(s.scheduled_at).getTime() < now) return true;
    return false;
  });
  const needsActionIds = new Set(needsAction.map(s => s.id));
  const upcoming = sessions.filter(s => {
    if (needsActionIds.has(s.id)) return false;
    if (s.viewer_completed) return false;
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

  // Greeting keys off conversation count (PM's option 2 — no new state):
  // newcomers get an open prompt, returning users get a progress line.
  const completedCount = sessions.filter(s => s.status === 'completed').length;

  return (
    <PageShell
      compact
      title={
        completedCount === 0
          ? t('dashboard.greeting.first', { name: user?.name?.split(' ')[0] })
          : t('dashboard.greeting.again', {
              name: user?.name?.split(' ')[0],
              count: completedCount,
            })
      }
      description={t('dashboard.welcomeDescription')}
      className="gap-8"
    >
      <SnapshotStrip
        upcomingCount={upcoming.length}
        attentionCount={needsAction.length}
        requestCount={pendingAcceptances.length}
        onJump={handleSnapshotJump}
      />

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

      {showDashboardCheckin && (
        <div ref={checkinSectionRef} id="checkin" className="scroll-mt-8">
          <Surface>
            <SurfaceBody className="pt-5">
              <div className="mb-4">
                <p className="text-sm font-medium text-foreground">{t('dashboard.checkin.panelTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.checkin.panelSubtitle')}</p>
              </div>
              <ReflectionLog
                initialOpen={showDashboardCheckin}
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

      <HomeConversation
        key={user?.id}
        userId={user?.id}
        sessions={sessions}
        onRequest={(person, context) => { setRequestingPerson(person); setRequestContext(context); }}
      />

      {requestingPerson && <SessionRequestModal
        mentor={requestingPerson}
        initialQuestion={requestContext.question}
        initialIntent={requestContext.intent}
        onClose={() => setRequestingPerson(null)}
        onSuccess={() => { setRequestingPerson(null); loadSessions(); }}
      />}

      {sessions.filter(s => s.status === 'completed' || s.viewer_completed).map(session => <div id={`home-session-${session.id}`} key={session.id} className="scroll-mt-8"><SessionCard session={session} currentUserId={user?.id} onUpdate={handleSessionUpdate} /></div>)}

      <PageSection
        title={t('dashboard.sessions.title')}
        description={
          <>
            {t('dashboard.sessions.descPrefix')}<Link to="/profile" className="text-primary hover:underline">{t('dashboard.sessions.profileLink')}</Link>{t('dashboard.sessions.descSuffix')}
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
              {t('dashboard.sessions.empty')}
            </SurfaceBody>
          </Surface>
        ) : (
          <div className="space-y-6">
            {needsAction.length > 0 && (
              <div ref={needsActionRef} className="scroll-mt-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <h3 className="label-meta mb-0">{t('dashboard.sessions.needsAttention')}</h3>
                  <span className="text-xs text-muted-foreground">{needsAction.length}</span>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {needsAction.map(session => (
                    <div key={session.id} id={`home-session-${session.id}`} className="scroll-mt-8"><SessionCard
                      key={session.id}
                      session={session}
                      currentUserId={user?.id}
                      onUpdate={handleSessionUpdate}
                    /></div>
                  ))}
                </div>
              </div>
            )}

            {upcoming.length > 0 && (
              <div ref={upcomingRef} className="scroll-mt-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <h3 className="label-meta mb-0">{t('dashboard.sessions.upcoming')}</h3>
                  <span className="text-xs text-muted-foreground">{upcoming.length}</span>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {upcoming.map(session => (
                    <div key={session.id} id={`home-session-${session.id}`} className="scroll-mt-8"><SessionCard
                      key={session.id}
                      session={session}
                      currentUserId={user?.id}
                      onUpdate={handleSessionUpdate}
                    /></div>
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

// Tappable counters under the hero — "X upcoming · Y needs attention ·
// Z new requests". Tap scrolls to the matching section below the fold;
// zero-count tiles render as quiet placeholders.
function SnapshotStrip({ upcomingCount, attentionCount, requestCount, onJump }) {
  const { t } = useT();
  const items = [
    { key: 'upcoming', count: upcomingCount, label: t('dashboard.snapshot.upcoming') },
    { key: 'attention', count: attentionCount, label: t('dashboard.snapshot.needsAttention') },
    { key: 'requests', count: requestCount, label: t('dashboard.snapshot.requests') },
  ];
  return (
    <div data-testid="snapshot-strip" className="grid grid-cols-3 gap-3">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          onClick={() => onJump(item.key)}
          disabled={item.count === 0}
          className={cn(
            'rounded-xl border px-4 py-4 text-left transition-colors duration-150',
            item.count > 0
              ? 'border-[var(--border)] bg-card hover:bg-muted'
              : 'cursor-default border-dashed border-[var(--border)] text-muted-foreground'
          )}
        >
          <span className="block text-2xl font-medium tabular-nums">{item.count}</span>
          <span className="block text-xs text-muted-foreground">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
