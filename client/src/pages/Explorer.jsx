import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SessionRequestModal from '../components/SessionRequestModal.jsx';
import api from '../api/index.js';

export default function Explorer() {
  const [matches, setMatches] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [requestingMentor, setRequestingMentor] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await api.get('/matches'); // no limit → returns all
        setMatches(res.data.matches || []);
        setTotal(res.data.total || 0);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Skip the top 3 — those are already on the dashboard.
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
        ...(m.user.skills || []).map(s => s.skill)
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [beyondTopThree, query, departmentFilter, locationFilter]);

  const activeFilterCount = [departmentFilter, locationFilter].filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">MENT Explorer</h1>
        <p className="text-gray-500 mt-1">
          Browse everyone you match with, beyond your top suggestions. Strong matches near the top, sorted by score.
        </p>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <input
          type="text"
          className="input"
          placeholder="Search by name, role, location, or skill…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select className="input" value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)}>
            <option value="">All departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="input" value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
            <option value="">All locations</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() => { setDepartmentFilter(''); setLocationFilter(''); }}
            className="text-xs text-navy-light hover:text-navy font-medium"
          >
            Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {/* Summary line */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          {loading ? 'Loading matches…' : `${filtered.length} of ${beyondTopThree.length} colleagues shown`}
        </span>
        {!loading && (
          <span>Top 3 matches live on your <Link to="/" className="text-navy-light hover:underline">dashboard</Link></span>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="card p-5 h-32 animate-pulse bg-gray-100" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          {beyondTopThree.length === 0 ? (
            <>
              <div className="text-3xl mb-2">✦</div>
              <p className="text-navy font-semibold mb-1">Your top 3 matches are already on your dashboard</p>
              <p className="text-gray-500 text-sm">As more colleagues complete onboarding, they'll show up here.</p>
            </>
          ) : (
            <p className="text-gray-500 text-sm">No matches fit those filters. Try clearing them.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(m => (
            <ExplorerCard
              key={m.matchId}
              match={m}
              onRequest={() => setRequestingMentor(m.user)}
            />
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
    </div>
  );
}

function ExplorerCard({ match, onRequest }) {
  const { user, score, reasons } = match;
  const pct = Math.min(score, 100);
  const tier = score >= 70 ? 'Strong' : score >= 50 ? 'Promising' : 'Worth a look';
  const tierColor = score >= 70 ? 'text-navy' : score >= 50 ? 'text-navy-light' : 'text-gray-500';

  return (
    <div className="card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-full bg-navy-light flex items-center justify-center text-white font-semibold flex-shrink-0">
          {user.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <Link to={`/profile/${user.id}`} className="font-semibold text-navy hover:underline block truncate">
            {user.name}
          </Link>
          <p className="text-xs text-gray-500 truncate">{user.current_role} · {user.department}</p>
          {user.location && (
            <p className="text-xs text-gray-400 truncate flex items-center gap-1 mt-0.5">
              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              {user.location}
            </p>
          )}
        </div>
      </div>

      {/* Score visualization */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className={`text-xs font-semibold ${tierColor}`}>{tier} match</span>
          <span className="text-xs text-gray-500">{score}/100</span>
        </div>
        <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div className="bg-navy-light h-full rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {reasons?.[0] && (
        <p className="text-xs text-gray-600 line-clamp-2">{reasons[0]}</p>
      )}

      <button onClick={onRequest} className="btn-secondary text-sm w-full">
        Request a session
      </button>
    </div>
  );
}
