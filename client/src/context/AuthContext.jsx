import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

const PROFILE_FIELDS =
  'id, name, department, seniority, job_title, tenure_years, location, bio, ' +
  'shadow_role_response, pending_checkin, manager_id, must_change_password, ' +
  'deactivated_at, onboarding_complete, is_admin';

async function loadProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .eq('id', userId)
      .single();
    if (error || !data) return null;

    // direct_reports drives Team-Skills nav visibility. Best-effort: a
    // failure here must not block the whole AuthContext from finishing.
    let directReports = 0;
    try {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('manager_id', userId)
        .eq('is_admin', false);
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
