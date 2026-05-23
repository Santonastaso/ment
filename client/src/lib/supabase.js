import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in client/.env.local');
}

// In-process lock — bypasses navigator.locks. The default Web Locks API
// implementation can wedge on GitHub Pages reloads when a previous tab held
// the auth lock and didn't release cleanly, leaving every subsequent fetch
// queued forever behind a never-resolving acquireLock.
function inProcessLock(name, acquireTimeout, fn) {
  return fn();
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    lock: inProcessLock,
  },
});
