import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SessionRequestModal from '../components/SessionRequestModal.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody } from '../components/Surface.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import api from '../api/index.js';

export default function Explorer() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [requestingMentor, setRequestingMentor] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await api.get('/matches');
        setMatches(res.data.matches || []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const beyondTopThree = useMemo(() => matches.slice(3), [matches]);

  const departments = useMemo(() => {
    const set = new Set();
    for (const m of beyondTopThree) {
      if (m.user.department) set.add(m.user.department);
    }
    return [...set].sort();
  }, [beyondTopThree]);

  const locations = useMemo(() => {
    const set = new Set();
    for (const m of beyondTopThree) {
      if (m.user.location) set.add(m.user.location);
    }
    return [...set].sort();
  }, [beyondTopThree]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return beyondTopThree.filter(m => {
      if (departmentFilter && m.user.department !== departmentFilter) return false;
      if (locationFilter && m.user.location !== locationFilter) return false;
      if (!q) return true;
      const haystack = [
        m.user.name,
        m.user.current_role,
        m.user.department,
        m.user.location,
        ...(m.user.skills || []).map(s => s.skill),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [beyondTopThree, query, departmentFilter, locationFilter]);

  const activeFilterCount = [departmentFilter, locationFilter].filter(Boolean).length;

  return (
    <PageShell
      title="Explorer"
      description="Everyone beyond your top three on Home, sorted by match score."
    >

      <Surface>
        <SurfaceBody className="space-y-3">
          <Input
            placeholder="Search by name, role, location, or skill…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <select
              className="input w-full"
              value={departmentFilter}
              onChange={e => setDepartmentFilter(e.target.value)}
            >
              <option value="">All departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select
              className="input w-full"
              value={locationFilter}
              onChange={e => setLocationFilter(e.target.value)}
            >
              <option value="">All locations</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => { setDepartmentFilter(''); setLocationFilter(''); }}>
              Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
            </Button>
          )}
        </SurfaceBody>
      </Surface>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{loading ? 'Loading…' : `${filtered.length} of ${beyondTopThree.length} colleagues`}</span>
        {!loading && (
          <span>Top 3 on <Link to="/" className="font-medium text-primary hover:underline">Home</Link></span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Surface>
          <SurfaceBody className="py-12 text-center">
            {beyondTopThree.length === 0 ? (
              <>
                <p className="font-semibold text-foreground">Your top matches are on Home</p>
                <p className="mt-1 text-sm text-muted-foreground">More colleagues appear here as they complete onboarding.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No matches fit those filters.</p>
            )}
          </SurfaceBody>
        </Surface>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map(m => (
            <ExplorerCard key={m.matchId} match={m} onRequest={() => setRequestingMentor(m.user)} />
          ))}
        </div>
      )}

      {requestingMentor && (
        <SessionRequestModal
          mentor={requestingMentor}
          onClose={() => setRequestingMentor(null)}
          onSuccess={() => setRequestingMentor(null)}
        />
      )}
    </PageShell>
  );
}

function ExplorerCard({ match, onRequest }) {
  const { user, score, reasons } = match;
  const pct = Math.min(score, 100);
  const tier = score >= 70 ? 'Strong' : score >= 50 ? 'Promising' : 'Worth a look';
  const tierColor = score >= 70 ? 'text-primary' : score >= 50 ? 'text-primary/80' : 'text-muted-foreground';
  const initials = (user?.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <Surface>
      <SurfaceBody className="flex flex-col gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="size-10">
            <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <Link to={`/profile/${user.id}`} className="font-semibold text-foreground hover:text-primary hover:underline block truncate">
              {user.name}
            </Link>
            <p className="text-xs text-muted-foreground truncate">{user.current_role} · {user.department}</p>
            {user.location && <p className="text-xs text-muted-foreground truncate mt-0.5">{user.location}</p>}
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className={`text-xs font-semibold ${tierColor}`}>{tier} match</span>
            <span className="text-xs text-muted-foreground">{score}/100</span>
          </div>
          <div className="bg-muted rounded-full h-1.5 overflow-hidden">
            <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {reasons?.[0] && <p className="text-xs text-muted-foreground line-clamp-2">{reasons[0]}</p>}
        <Button variant="outline" className="w-full" onClick={onRequest}>Request a session</Button>
      </SurfaceBody>
    </Surface>
  );
}
