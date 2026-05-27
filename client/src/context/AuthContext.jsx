import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

const PROFILE_FIELDS =
  'id, name, department, seniority, job_title, tenure_years, location, bio, ' +
  'shadow_role_response, pending_checkin, manager_id, must_change_password, ' +
  'deactivated_at, onboarding_complete, is_admin, admin_scope, organization_id, ' +
  'mentorship_paused, mentorship_unavailable_until, mentorship_note, ' +
  'monthly_session_goal';

async function loadProfile(userId) {
  try {
    // After migration 0012 the `profiles` table-level SELECT is restricted
    // to a column allowlist (it excludes `shadow_role_response`). Use the
    // security-definer `my_profile()` RPC so we still get every column on
    // our own row.
    const { data, error } = await supabase.rpc('my_profile');
    if (error || !data) return null;
    if (data.id !== userId) return null;

    // direct_reports drives Team-Skills nav visibility. Best-effort: a
    // failure here must not block the whole AuthContext from finishing.
    let directReports = 0;
    try {
      const { data: count } = await supabase.rpc('direct_report_count', { p_manager_id: userId });
      directReports = count ?? 0;
    } catch {
      /* swallow */
    }

    // Alias job_title -> current_role for legacy components.
    return { ...data, current_role: data.job_title, direct_reports: directReports };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Number of scheduled-but-not-yet-acknowledged sessions where the viewer is
  // the mentee. Surfaced as a badge in the sidebar and used by the dashboard
  // to decide whether to render the AcceptanceModal.
  const [pendingAcceptanceCount, setPendingAcceptanceCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    let lastUserId = null;
    let initialized = false;

    async function hydrate(s) {
      if (!mounted) return;
      setSession(s);
      const uid = s?.user?.id ?? null;
      // Same user as last call: nothing to refetch. The original call still
      // owns the loading flag — never clear it from a dedupe path.
      if (uid === lastUserId && initialized) return;
      lastUserId = uid;
      try {
        const next = uid ? await loadProfile(uid) : null;
        if (mounted) setProfile(next);
      } finally {
        if (mounted && !initialized) {
          initialized = true;
          setLoading(false);
        }
      }
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => hydrate(s));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => hydrate(s));

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Realtime: keep `profile` fresh when must_change_password / pending_checkin
  // change (e.g. weekly cron flips the flag).
  useEffect(() => {
    if (!session?.user?.id) return;
    const ch = supabase
      .channel(`profile:${session.user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` },
        (payload) => setProfile((p) => (p ? { ...p, ...payload.new } : p))
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session?.user?.id]);

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (!session?.user?.id) return;
    setProfile(await loadProfile(session.user.id));
  }

  function updateProfileLocal(partial) {
    setProfile((p) => (p ? { ...p, ...partial } : p));
  }

  async function refreshPendingAcceptances() {
    if (!session?.user?.id) {
      setPendingAcceptanceCount(0);
      return [];
    }
    try {
      const { data, error } = await supabase.rpc('pending_acceptances');
      if (error) throw error;
      const rows = data || [];
      setPendingAcceptanceCount(rows.length);
      return rows;
    } catch {
      return [];
    }
  }

  // Refresh on login + every time the active session id changes
  useEffect(() => {
    if (session?.user?.id) refreshPendingAcceptances();
    else setPendingAcceptanceCount(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: profile, // app-level "user" = our profile row, mirrors legacy shape
        loading,
        signIn,
        signOut,
        // Keep legacy names so existing components don't all need renaming.
        logout: signOut,
        updateUser: updateProfileLocal,
        refreshProfile,
        pendingAcceptanceCount,
        refreshPendingAcceptances,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
