import React, { useEffect, useRef, useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';

// Reflection log: weekly two-question check-in. Answers are classified by an AI
// (or heuristic fallback) into skill gaps and strengths, which the user can apply
// to their profile so matching improves over time.

const PROMPTS = [
  { key: 'support_needed', labelKey: 'components.reflection.promptSupportNeeded' },
  { key: 'managed_well',   labelKey: 'components.reflection.promptManagedWell' },
];

export default function ReflectionLog({
  onSkillsApplied,
  onSubmitted,
  initialOpen = false,
  autoOpenToken = 0,
  // Dashboard mode: only render the new check-in form and the just-submitted
  // entry. The history list and "no entries yet" empty state are suppressed
  // so the dashboard panel stays focused on the current check-in.
  hideHistory = false,
}) {
  const { t } = useT();
  const [entries, setEntries] = useState([]);
  const [latestEntryId, setLatestEntryId] = useState(null);
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

  // In dashboard mode (hideHistory), surface only the freshly-submitted entry
  // (the one this dashboard panel just produced). Past reflections stay on
  // the profile page — the dashboard panel is "current check-in" only.
  const visibleEntries = hideHistory
    ? entries.filter((e) => e.id === latestEntryId)
    : entries;

  async function handleSubmit() {
    setError('');
    if (!supportNeeded.trim() && !managedWell.trim()) {
      setError(t('components.reflection.errorAnswerOne'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/reflections', { support_needed: supportNeeded, managed_well: managedWell });
      setSupportNeeded('');
      setManagedWell('');
      setShowForm(false);
      // Remember which row this panel produced so dashboard mode can show
      // just that one entry.
      const newId = res?.data?.id ?? null;
      if (newId != null) setLatestEntryId(newId);
      await load();
      onSubmitted?.();
      setToast(t('components.reflection.toastSaved'));
      setTimeout(() => setToast(''), 4000);
    } catch (e) {
      setError(e.response?.data?.error || t('components.reflection.errorSave'));
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
        ? t('components.reflection.applyNothing')
        : total === 1
          ? t('components.reflection.applyAddedOne', { count: total })
          : t('components.reflection.applyAddedMany', { count: total }));
      setTimeout(() => setToast(''), 3000);
      onSkillsApplied?.();
      await load();
    } catch {
      setError(t('components.reflection.errorApply'));
    }
  }

  async function handleDelete(entry) {
    if (!confirm(t('components.reflection.confirmDelete'))) return;
    await api.delete(`/reflections/${entry.id}`);
    if (latestEntryId === entry.id) setLatestEntryId(null);
    await load();
  }

  async function handleReclassify(entry) {
    try {
      await api.post(`/reflections/${entry.id}/reclassify`, {});
      await load();
      setToast(t('components.reflection.toastReclassified'));
      setTimeout(() => setToast(''), 3000);
    } catch (e) {
      // Reload anyway so the UI reflects whatever ended up in the row.
      try { await load(); } catch { /* noop */ }
      const code = e?.response?.data?.error || e?.message || '';
      const friendly =
        code === 'reclassify_unclassified'
          ? t('components.reflection.errorReclassifyUnclassified')
          : code === 'reclassify_failed'
            ? t('components.reflection.errorReclassifyFailed')
            : t('components.reflection.errorReclassifyGeneric');
      setError(friendly);
      setTimeout(() => setError(''), 5000);
    }
  }

  function timeAgo(iso) {
    const date = new Date(iso);
    const normalized = Number.isNaN(date.getTime()) && typeof iso === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(iso)
      ? new Date(`${iso}Z`)
      : date;
    if (Number.isNaN(normalized.getTime())) return t('components.reflection.timeAgoRecently');
    const ms = Date.now() - normalized.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    if (days === 0) return t('components.reflection.timeAgoToday');
    if (days === 1) return t('components.reflection.timeAgoYesterday');
    if (days < 7) return t('components.reflection.timeAgoDaysAgo', { count: days });
    if (days < 30) {
      const weeks = Math.floor(days / 7);
      return weeks === 1
        ? t('components.reflection.timeAgoWeekAgo', { count: weeks })
        : t('components.reflection.timeAgoWeeksAgo', { count: weeks });
    }
    return normalized.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-3 py-2">
          {toast}
        </div>
      )}

      {/* Check-in prompt — suppressed in dashboard mode (the dashboard
          already renders its own "Open check-in" alert above this panel). */}
      {!hideHistory && dueForCheckIn && !showForm && (
        <div className="bg-gradient-to-r from-blue-50 to-amber-50 border border-blue-200 rounded-xl p-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-foreground font-semibold text-sm">{t('components.reflection.dueTitle')}</p>
            <p className="text-xs text-gray-600 mt-0.5">
              {lastEntryDays === null
                ? t('components.reflection.dueBodyFirst')
                : t('components.reflection.dueBodyDays', { days: lastEntryDays })}
            </p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm whitespace-nowrap">
            {t('components.reflection.startCheckIn')}
          </button>
        </div>
      )}

      {/* New entry form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{t('components.reflection.weeklyCheckIn')}</h3>
            <button onClick={() => { setShowForm(false); setError(''); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>
          {PROMPTS.map(p => (
            <div key={p.key}>
              <label className="label">{t(p.labelKey)}</label>
              <textarea
                ref={p.key === 'support_needed' ? firstFieldRef : undefined}
                rows={3}
                className="input resize-none"
                value={p.key === 'support_needed' ? supportNeeded : managedWell}
                onChange={e => p.key === 'support_needed' ? setSupportNeeded(e.target.value) : setManagedWell(e.target.value)}
                placeholder={t('components.reflection.formPlaceholder')}
              />
            </div>
          ))}
          {error && <p className="text-rose-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setError(''); }} className="btn-ghost text-sm">{t('components.reflection.cancel')}</button>
            <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-sm">
              {submitting ? t('components.reflection.saving') : t('components.reflection.save')}
            </button>
          </div>
        </div>
      )}

      {/* Add manually if not due — suppressed in dashboard mode so the
          panel only renders the active check-in. */}
      {!hideHistory && !showForm && !dueForCheckIn && (
        <button onClick={() => setShowForm(true)} className="text-sm text-primary hover:text-primary/80 font-medium">
          {t('components.reflection.addNow')}
        </button>
      )}

      {/* Entries — either the full history or just the freshly-submitted
          entry when running inside the dashboard panel. In dashboard mode we
          keep the rendered entry visible across `load()` refreshes so the
          just-submitted card doesn't flicker. */}
      {loading && !hideHistory ? (
        <p className="text-sm text-gray-400">{t('components.reflection.loading')}</p>
      ) : visibleEntries.length === 0 ? (
        !hideHistory && !loading && !showForm && !dueForCheckIn && (
          <p className="text-sm text-gray-500">{t('components.reflection.empty')}</p>
        )
      ) : (
        <div className="space-y-3">
          {visibleEntries.map(entry => (
            <Entry
              key={entry.id}
              entry={entry}
              onApply={handleApply}
              onDelete={handleDelete}
              onReclassify={handleReclassify}
              timeAgo={timeAgo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function classifierLabel(source, t) {
  if (!source || source === 'unclassified') return t('components.reflection.classifierNoMatch');
  if (source === 'claude-haiku-4-5+esco') return t('components.reflection.classifierClaudeEsco');
  if (source === 'claude-haiku-4-5') return t('components.reflection.classifierClaude');
  if (source === 'esco') return t('components.reflection.classifierEsco');
  if (source === 'esco+heuristic') return t('components.reflection.classifierEscoHeuristic');
  if (source === 'heuristic') return t('components.reflection.classifierHeuristic');
  return source;
}

function ChipWithEsco({ skill, uri, tone, onDismiss }) {
  const { t } = useT();
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
          title={t('components.reflection.escoOpenTitle', { uri })}
          onClick={e => e.stopPropagation()}
        >
          ESCO
        </a>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('components.reflection.dismissSkill', { skill })}
          title={t('components.reflection.dismissSuggestion')}
          className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[12px] leading-none transition-colors ${dismissColors}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function Entry({ entry, onApply, onDelete, onReclassify, timeAgo }) {
  const { t } = useT();
  // Track which suggestions the user has dismissed (locally, before applying)
  const [dismissedGaps, setDismissedGaps] = useState(() => new Set());
  const [dismissedStrengths, setDismissedStrengths] = useState(() => new Set());
  const [reclassifying, setReclassifying] = useState(false);

  const allGaps = entry.extracted_gaps || [];
  const allStrengths = entry.extracted_strengths || [];
  const keptGaps = allGaps.filter(s => !dismissedGaps.has(s));
  const keptStrengths = allStrengths.filter(s => !dismissedStrengths.has(s));
  const totalKept = keptGaps.length + keptStrengths.length;
  const totalAll = allGaps.length + allStrengths.length;
  const totalDismissed = totalAll - totalKept;
  const hasSuggestions = totalAll > 0;
  const uris = entry.esco_uris || {};
  // "Unclassified" = the edge function never returned a real classifier
  // source, or returned the explicit "unclassified" sentinel because all
  // paths produced zero signals. Surface a manual retry so users aren't
  // stuck staring at a dead entry caused by a transient function failure.
  const rawSource = (entry.classifier_source || '').trim().toLowerCase();
  const isUnclassified = !rawSource || rawSource === 'unclassified';

  async function handleReclassify() {
    if (reclassifying || !onReclassify) return;
    setReclassifying(true);
    try {
      await onReclassify(entry);
    } finally {
      setReclassifying(false);
    }
  }

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
            {t('components.reflection.classifiedVia', { label: classifierLabel(entry.classifier_source, t) })}
          </span>
          {entry.applied && (
            <span className="ml-1 inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 rounded-full px-2 py-0.5 text-[10px] font-medium">
              {t('components.reflection.appliedToSkills')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isUnclassified && onReclassify && (
            <button
              type="button"
              onClick={handleReclassify}
              disabled={reclassifying}
              data-testid="reclassify-button"
              className="text-xs font-medium text-primary hover:text-primary/80 underline-offset-2 hover:underline disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {reclassifying ? t('components.reflection.reclassifying') : t('components.reflection.reclassify')}
            </button>
          )}
          <button onClick={() => onDelete(entry)} className="text-xs text-gray-400 hover:text-rose-500">{t('components.reflection.delete')}</button>
        </div>
      </div>

      <div className="p-4 space-y-3 text-sm">
        {entry.support_needed && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-rose-500 font-medium mb-1">{t('components.reflection.neededSupport')}</p>
            <p className="text-gray-700 whitespace-pre-wrap">{entry.support_needed}</p>
          </div>
        )}
        {entry.managed_well && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-emerald-600 font-medium mb-1">{t('components.reflection.managedWellLabel')}</p>
            <p className="text-gray-700 whitespace-pre-wrap">{entry.managed_well}</p>
          </div>
        )}

        {hasSuggestions && (
          <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 mt-2">
            <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
              <p className="text-[11px] uppercase tracking-wide text-foreground font-medium">
                {t('components.reflection.skillSignals')}
                <span className="text-gray-500 normal-case font-normal ml-1">{t('components.reflection.skillSignalsHint')}</span>
              </p>
              {totalDismissed > 0 && !entry.applied && (
                <button
                  onClick={restoreAll}
                  className="text-[11px] text-primary hover:text-primary/80 underline-offset-2 hover:underline"
                >
                  {t('components.reflection.restoreDismissed', { count: totalDismissed })}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {keptGaps.length > 0 && (
                <div>
                  <p className="text-xs text-gray-600 mb-1">{t('components.reflection.couldAddPrefix')} <strong>{t('components.reflection.skillsGrowing')}</strong>:</p>
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
                  <p className="text-xs text-gray-600 mb-1">{t('components.reflection.couldAddPrefix')} <strong>{t('components.reflection.skillsShare')}</strong>:</p>
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
                <p className="text-xs text-gray-400 italic">{t('components.reflection.allDismissed')}</p>
              )}
            </div>
            {!entry.applied && (
              <button
                onClick={() => onApply(entry, keptGaps, keptStrengths)}
                disabled={totalKept === 0}
                className="mt-3 btn-secondary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {totalKept === 0
                  ? t('components.reflection.applyNothingSelected')
                  : t('components.reflection.applyToLandscape', { count: totalKept })}
              </button>
            )}
          </div>
        )}

        {!hasSuggestions && (
          <p className="text-xs text-gray-400 italic">
            {t('components.reflection.noSignals')}
          </p>
        )}
      </div>
    </div>
  );
}
