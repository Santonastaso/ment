import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SessionRequestModal from '../components/SessionRequestModal.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody } from '../components/Surface.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';

export default function Explorer() {
  const { t } = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  // Seed the query from the top-bar search (?q=) so the header search works.
  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [requestingMentor, setRequestingMentor] = useState(null);

  // Keep the local query in sync when the URL ?q= changes (e.g. a second
  // header search while already on Explorer).
  useEffect(() => {
    const urlQ = searchParams.get('q') || '';
    setQuery((prev) => (prev === urlQ ? prev : urlQ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await api.get('/matches?role=mentor&limit=100&includeDirectory=1');
        setMatches(res.data.matches || []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const departments = useMemo(() => {
    const set = new Set();
    for (const m of matches) {
      if (m.user.department) set.add(m.user.department);
    }
    return [...set].sort();
  }, [matches]);

  const locations = useMemo(() => {
    const set = new Set();
    for (const m of matches) {
      if (m.user.location) set.add(m.user.location);
    }
    return [...set].sort();
  }, [matches]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matches.filter(m => {
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
  }, [matches, query, departmentFilter, locationFilter]);

  const activeFilterCount = [departmentFilter, locationFilter].filter(Boolean).length;

  return (
      <PageShell
        title={t('explorer.title')}
        description={t('explorer.description')}
      >

      <Surface>
        <SurfaceBody className="space-y-3">
          <Input
            placeholder={t('explorer.searchPlaceholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <select
              className="input w-full"
              value={departmentFilter}
              onChange={e => setDepartmentFilter(e.target.value)}
            >
              <option value="">{t('explorer.allDepartments')}</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select
              className="input w-full"
              value={locationFilter}
              onChange={e => setLocationFilter(e.target.value)}
            >
              <option value="">{t('explorer.allLocations')}</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => { setDepartmentFilter(''); setLocationFilter(''); }}>
              {t(activeFilterCount === 1 ? 'explorer.clearFilterOne' : 'explorer.clearFilterMany', { count: activeFilterCount })}
            </Button>
          )}
        </SurfaceBody>
      </Surface>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{loading ? t('explorer.loading') : t(matches.length === 1 ? 'explorer.countColleaguesOne' : 'explorer.countColleagues', { filtered: filtered.length, total: matches.length })}</span>
        {!loading && (
          <span>{t('explorer.topSuggestionsPrefix')}<Link to="/" className="font-medium text-primary hover:underline">{t('explorer.homeLink')}</Link></span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Surface>
          <SurfaceBody className="py-12 text-center">
            {matches.length === 0 ? (
              <>
                <p className="font-semibold text-foreground">{t('explorer.emptyTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('explorer.emptyBody')}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('explorer.noFilterMatches')}</p>
            )}
          </SurfaceBody>
        </Surface>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map(m => (
            <ExplorerCard key={m.matchId || m.user.id} match={m} onRequest={() => setRequestingMentor(m.user)} />
          ))}
        </div>
      )}

      {requestingMentor && (
        <SessionRequestModal
          mentor={requestingMentor}
          onClose={() => setRequestingMentor(null)}
          onSuccess={() => {
            setMatches(prev => prev.filter(m => m.user.id !== requestingMentor.id));
            setRequestingMentor(null);
          }}
        />
      )}
    </PageShell>
  );
}

function ExplorerCard({ match, onRequest }) {
  const { t } = useT();
  const { user, score, reasons } = match;
  const pct = Math.min(score, 100);
  const tier = score >= 70 ? t('explorer.tierStrong') : score >= 50 ? t('explorer.tierPromising') : t('explorer.tierWorth');
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
            <span className={`text-xs font-semibold ${tierColor}`}>{t('explorer.tierMatch', { tier })}</span>
            <span className="text-xs text-muted-foreground">{score}/100</span>
          </div>
          <div className="bg-muted rounded-full h-1.5 overflow-hidden">
            <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {reasons?.[0] && <p className="text-xs text-muted-foreground line-clamp-2">{reasons[0]}</p>}
        <Button variant="outline" className="w-full" onClick={onRequest}>{t('explorer.requestSession')}</Button>
      </SurfaceBody>
    </Surface>
  );
}
