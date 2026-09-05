import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';
import { useModalA11y } from '../lib/useModalA11y.js';

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
  showManualAdd = false,
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
        <div className="border border-[var(--border)] text-foreground text-sm rounded-lg px-3 py-2 bg-muted/40">
          {toast}
        </div>
      )}

      {/* Check-in prompt — suppressed in dashboard mode (the dashboard
          already renders its own "Open check-in" alert above this panel). */}
      {!hideHistory && dueForCheckIn && !showForm && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-foreground font-semibold text-sm">{t('components.reflection.dueTitle')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lastEntryDays === null
                ? t('components.reflection.dueBodyFirst')
                : t('components.reflection.dueBodyDays', { days: lastEntryDays })}
            </p>
          </div>
          <Button onClick={() => setShowForm(true)} size="sm" className="whitespace-nowrap">
            {t('components.reflection.startCheckIn')}
          </Button>
        </div>
      )}

      {/* New entry form — renders inline in the parent panel; no extra
          card-in-card container, no repeated title (the parent panel is
          already labelled "Weekly check-in"). */}
      {showForm && (
        <div className="space-y-4 border-b border-[var(--border)] pb-5">
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
            <Button onClick={() => { setShowForm(false); setError(''); }} variant="ghost" size="sm">{t('components.reflection.cancel')}</Button>
            <Button onClick={handleSubmit} disabled={submitting} size="sm">
              {submitting ? t('components.reflection.saving') : t('components.reflection.save')}
            </Button>
          </div>
        </div>
      )}

      {/* Add manually if not due — suppressed in dashboard mode so the
          panel only renders the active check-in. */}
      {(!hideHistory || showManualAdd) && !showForm && !dueForCheckIn && (
        <button onClick={() => setShowForm(true)} className="text-sm text-primary hover:text-primary/80 font-medium">
          {t('components.reflection.addNow')}
        </button>
      )}

      {/* Entries — either the full history or just the freshly-submitted
          entry when running inside the dashboard panel. In dashboard mode we
          keep the rendered entry visible across `load()` refreshes so the
          just-submitted card doesn't flicker. */}
      {loading && !hideHistory ? (
        <p className="text-sm text-muted-foreground">{t('components.reflection.loading')}</p>
      ) : visibleEntries.length === 0 ? (
        !hideHistory && !loading && !showForm && !dueForCheckIn && (
          <p className="text-sm text-muted-foreground">{t('components.reflection.empty')}</p>
        )
      ) : (
        <div className="divide-y divide-[var(--border)]">
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

function SuggestionChip({ skill, onDismiss }) {
  const { t } = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted pl-2.5 pr-1 py-0.5 text-xs text-foreground">
      <span>{skill}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('components.reflection.dismissSkill', { skill })}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground hover:text-foreground"
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
  const [open, setOpen] = useState(false);
  const dialogRef = useModalA11y(open);

  // Close the popup on Escape.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const allGaps = entry.extracted_gaps || [];
  const allStrengths = entry.extracted_strengths || [];
  const keptGaps = allGaps.filter(s => !dismissedGaps.has(s));
  const keptStrengths = allStrengths.filter(s => !dismissedStrengths.has(s));
  const totalKept = keptGaps.length + keptStrengths.length;
  const totalAll = allGaps.length + allStrengths.length;
  const totalDismissed = totalAll - totalKept;
  const hasSuggestions = totalAll > 0;
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
    <>
      {/* Collapsed row — the only thing visible until clicked. */}
      <div className="py-4 first:pt-1 last:pb-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="text-sm font-medium text-foreground">{timeAgo(entry.created_at)}</span>
          <span className="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground">
            {entry.applied && <span>{t('components.reflection.appliedToSkills')}</span>}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </span>
        </button>
      </div>

      {/* Popup with the full entry: answers, skill signals, actions. */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`reflection-modal-title-${entry.id}`}
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white [box-shadow:var(--shadow-overlay)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-5">
              <div>
                <h2 id={`reflection-modal-title-${entry.id}`} className="text-base font-medium leading-snug text-foreground">
                  {t('components.reflection.weeklyCheckIn')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{timeAgo(entry.created_at)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('components.session.close')}
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {entry.support_needed && (
                <div>
                  <p className="label-meta">{t('components.reflection.neededSupport')}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{entry.support_needed}</p>
                </div>
              )}
              {entry.managed_well && (
                <div>
                  <p className="label-meta">{t('components.reflection.managedWellLabel')}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{entry.managed_well}</p>
                </div>
              )}

              {(totalKept > 0 || totalDismissed > 0) && !entry.applied ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {[...keptGaps, ...keptStrengths].map((s, i) => (
                      <SuggestionChip
                        key={`${s}-${i}`}
                        skill={s}
                        onDismiss={
                          allGaps.includes(s)
                            ? () => dismiss(dismissedGaps, setDismissedGaps, s)
                            : () => dismiss(dismissedStrengths, setDismissedStrengths, s)
                        }
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    {totalDismissed > 0 && (
                      <button
                        onClick={restoreAll}
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        {t('components.reflection.restoreDismissed', { count: totalDismissed })}
                      </button>
                    )}
                    {totalKept > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={() => onApply(entry, keptGaps, keptStrengths)}
                      >
                        {t('components.reflection.applyToLandscape', { count: totalKept })}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                !hasSuggestions && (
                  <p className="text-xs text-muted-foreground">{t('components.reflection.noSignals')}</p>
                )
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] p-4">
              {isUnclassified && onReclassify && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={reclassifying}
                  data-testid="reclassify-button"
                  onClick={handleReclassify}
                >
                  {reclassifying ? t('components.reflection.reclassifying') : t('components.reflection.reclassify')}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDelete(entry)}
              >
                {t('components.reflection.delete')}
              </Button>
              <Button type="button" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
                {t('components.popup.done')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
