import React, { useEffect, useRef, useState } from 'react';
import api from '../api/index.js';

// Reflection log: weekly two-question check-in. Answers are classified by an AI
// (or heuristic fallback) into skill gaps and strengths, which the user can apply
// to their profile so matching improves over time.

const PROMPTS = [
  { key: 'support_needed', label: 'What did you feel you needed support on this week?' },
  { key: 'managed_well',   label: 'What did you feel you managed well this week?' },
];

export default function ReflectionLog({ onSkillsApplied, onSubmitted, initialOpen = false, autoOpenToken = 0 }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(initialOpen);
  const [supportNeeded, setSupportNeeded] = useState('');
  const [managedWell, setManagedWell] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dueForCheckIn, setDueForCheckIn] = useState(false);
  const [lastEntryDays, setLastEntryDays] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const firstFieldRef = useRef(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!initialOpen && !autoOpenToken) return;
    setShowForm(true);
  }, [initialOpen, autoOpenToken]);

  useEffect(() => {
    if (!showForm) return;
    const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [showForm, autoOpenToken]);
  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/reflections');
      setEntries(res.data.entries || []);
      setDueForCheckIn(!!res.data.dueForCheckIn);
      setLastEntryDays(res.data.lastEntryDays);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setError('');
    if (!supportNeeded.trim() && !managedWell.trim()) {
      setError('Please answer at least one of the two questions.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/reflections', { support_needed: supportNeeded, managed_well: managedWell });
      setSupportNeeded('');
      setManagedWell('');
      setShowForm(false);
      await load();
      onSubmitted?.();
      setToast('Saved. We picked out some skill signals — review them below.');
      setTimeout(() => setToast(''), 4000);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save your reflection. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApply(entry, keptGaps, keptStrengths) {
    try {
      await api.post(`/reflections/${entry.id}/apply`, {
        gaps: keptGaps,
        strengths: keptStrengths,
      });
      const total = (keptGaps?.length || 0) + (keptStrengths?.length || 0);
      setToast(total === 0
        ? 'Nothing to apply — entry kept in the log.'
        : `Added ${total} skill${total === 1 ? '' : 's'} to your landscape.`);
      setTimeout(() => setToast(''), 3000);
      onSkillsApplied?.();
      await load();
    } catch {
      setError('Could not apply suggestions.');
    }
  }

  async function handleDelete(entry) {
    if (!confirm('Delete this reflection? This cannot be undone.')) return;
    await api.delete(`/reflections/${entry.id}`);
    await load();
  }

  function timeAgo(iso) {
    const date = new Date(iso);
    const normalized = Number.isNaN(date.getTime()) && typeof iso === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(iso)
      ? new Date(`${iso}Z`)
      : date;
    if (Number.isNaN(normalized.getTime())) return 'recently';
    const ms = Date.now() - normalized.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days/7) === 1 ? '' : 's'} ago`;
    return normalized.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-3 py-2">
          {toast}
        </div>
      )}

      {/* Check-in prompt */}
      {dueForCheckIn && !showForm && (
        <div className="bg-gradient-to-r from-blue-50 to-amber-50 border border-blue-200 rounded-xl p-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-foreground font-semibold text-sm">Time for your weekly check-in</p>
            <p className="text-xs text-gray-600 mt-0.5">
              {lastEntryDays === null
                ? 'A short reflection helps us refine your matches and surface skills you might want to teach or learn.'
                : `It's been ${lastEntryDays} days. Two short answers, that's it.`}
            </p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm whitespace-nowrap">
            Start check-in
          </button>
        </div>
      )}

      {/* New entry form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Weekly check-in</h3>
            <button onClick={() => { setShowForm(false); setError(''); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>
          {PROMPTS.map(p => (
            <div key={p.key}>
              <label className="label">{p.label}</label>
              <textarea
                ref={p.key === 'support_needed' ? firstFieldRef : undefined}
                rows={3}
                className="input resize-none"
                value={p.key === 'support_needed' ? supportNeeded : managedWell}
                onChange={e => p.key === 'support_needed' ? setSupportNeeded(e.target.value) : setManagedWell(e.target.value)}
                placeholder="A few sentences is plenty. Only you will see this."
              />
            </div>
          ))}
          {error && <p className="text-rose-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setError(''); }} className="btn-ghost text-sm">Cancel</button>
            <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-sm">
              {submitting ? 'Saving…' : 'Save reflection'}
            </button>
          </div>
        </div>
      )}

      {/* Add manually if not due */}
      {!showForm && !dueForCheckIn && (
        <button onClick={() => setShowForm(true)} className="text-sm text-primary hover:text-primary/80 font-medium">
          + Add a reflection now
        </button>
      )}

      {/* Past entries */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading your log…</p>
      ) : entries.length === 0 ? (
        !showForm && !dueForCheckIn && (
          <p className="text-sm text-gray-500">No entries yet. Your check-ins will live here, with the AI-extracted skill signals from each one.</p>
        )
      ) : (
        <div className="space-y-3">
          {entries.map(entry => (
            <Entry key={entry.id} entry={entry} onApply={handleApply} onDelete={handleDelete} timeAgo={timeAgo} />
          ))}
        </div>
      )}
    </div>
  );
}

function classifierLabel(source) {
  if (!source) return 'unclassified';
  if (source === 'claude-haiku-4-5+esco') return 'Claude + ESCO taxonomy';
  if (source === 'claude-haiku-4-5') return 'Claude';
  if (source === 'esco') return 'ESCO taxonomy';
  if (source === 'esco+heuristic') return 'ESCO taxonomy (with keyword fallback)';
  if (source === 'heuristic') return 'keyword match (offline)';
  return source;
}

function ChipWithEsco({ skill, uri, tone, onDismiss }) {
  const colors = tone === 'gap'
    ? 'bg-rose-50 text-rose-700 border-rose-300'
    : 'bg-emerald-50 text-emerald-700 border-emerald-300';
  const dismissColors = tone === 'gap'
    ? 'text-rose-400 hover:text-rose-700 hover:bg-rose-100'
    : 'text-emerald-400 hover:text-emerald-700 hover:bg-emerald-100';
  return (
    <span className={`inline-flex items-center gap-1 border rounded-full pl-2.5 pr-1 py-0.5 text-xs ${colors}`}>
      <span>{skill}</span>
      {uri && (
        <a
          href={uri}
          target="_blank"
          rel="noreferrer"
          className="ml-0.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-white/70 text-[9px] font-semibold tracking-wider text-gray-700 hover:text-foreground"
          title={`Open in ESCO taxonomy: ${uri}`}
          onClick={e => e.stopPropagation()}
        >
          ESCO
        </a>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss ${skill}`}
          title="Dismiss this suggestion"
          className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[12px] leading-none transition-colors ${dismissColors}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function Entry({ entry, onApply, onDelete, timeAgo }) {
  // Track which suggestions the user has dismissed (locally, before applying)
  const [dismissedGaps, setDismissedGaps] = useState(() => new Set());
  const [dismissedStrengths, setDismissedStrengths] = useState(() => new Set());

  const allGaps = entry.extracted_gaps || [];
  const allStrengths = entry.extracted_strengths || [];
  const keptGaps = allGaps.filter(s => !dismissedGaps.has(s));
  const keptStrengths = allStrengths.filter(s => !dismissedStrengths.has(s));
  const totalKept = keptGaps.length + keptStrengths.length;
  const totalAll = allGaps.length + allStrengths.length;
  const totalDismissed = totalAll - totalKept;
  const hasSuggestions = totalAll > 0;
  const uris = entry.esco_uris || {};

  function dismiss(set, setter, skill) {
    const next = new Set(set);
    next.add(skill);
    setter(next);
  }
  function restoreAll() {
    setDismissedGaps(new Set());
    setDismissedStrengths(new Set());
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="font-medium text-foreground">{timeAgo(entry.created_at)}</span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500">
            classified via {classifierLabel(entry.classifier_source)}
          </span>
          {entry.applied && (
            <span className="ml-1 inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 rounded-full px-2 py-0.5 text-[10px] font-medium">
              ✓ Applied to skills
            </span>
          )}
        </div>
        <button onClick={() => onDelete(entry)} className="text-xs text-gray-400 hover:text-rose-500">Delete</button>
      </div>

      <div className="p-4 space-y-3 text-sm">
        {entry.support_needed && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-rose-500 font-medium mb-1">What I needed support on</p>
            <p className="text-gray-700 whitespace-pre-wrap">{entry.support_needed}</p>
          </div>
        )}
        {entry.managed_well && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-emerald-600 font-medium mb-1">What I managed well</p>
            <p className="text-gray-700 whitespace-pre-wrap">{entry.managed_well}</p>
          </div>
        )}

        {hasSuggestions && (
          <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 mt-2">
            <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
              <p className="text-[11px] uppercase tracking-wide text-foreground font-medium">
                Skill signals
                <span className="text-gray-500 normal-case font-normal ml-1">— click × on any chip to drop it before applying</span>
              </p>
              {totalDismissed > 0 && !entry.applied && (
                <button
                  onClick={restoreAll}
                  className="text-[11px] text-primary hover:text-primary/80 underline-offset-2 hover:underline"
                >
                  Restore {totalDismissed} dismissed
                </button>
              )}
            </div>
            <div className="space-y-2">
              {keptGaps.length > 0 && (
                <div>
                  <p className="text-xs text-gray-600 mb-1">Could be added to <strong>skills you're growing</strong>:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {keptGaps.map((s, i) => (
                      <ChipWithEsco
                        key={i}
                        skill={s}
                        uri={uris[s]}
                        tone="gap"
                        onDismiss={!entry.applied ? () => dismiss(dismissedGaps, setDismissedGaps, s) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}
              {keptStrengths.length > 0 && (
                <div>
                  <p className="text-xs text-gray-600 mb-1">Could be added to <strong>skills you share</strong>:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {keptStrengths.map((s, i) => (
                      <ChipWithEsco
                        key={i}
                        skill={s}
                        uri={uris[s]}
                        tone="strength"
                        onDismiss={!entry.applied ? () => dismiss(dismissedStrengths, setDismissedStrengths, s) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}
              {totalKept === 0 && (
                <p className="text-xs text-gray-400 italic">All suggestions dismissed.</p>
              )}
            </div>
            {!entry.applied && (
              <button
                onClick={() => onApply(entry, keptGaps, keptStrengths)}
                disabled={totalKept === 0}
                className="mt-3 btn-secondary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {totalKept === 0
                  ? 'Apply (nothing selected)'
                  : `Apply ${totalKept} to my skill landscape`}
              </button>
            )}
          </div>
        )}

        {!hasSuggestions && (
          <p className="text-xs text-gray-400 italic">
            No clear skill signals were detected in this entry — it was either too short or only contained generic phrases.
          </p>
        )}
      </div>
    </div>
  );
}
