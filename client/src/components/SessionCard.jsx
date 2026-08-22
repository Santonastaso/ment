import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
import IcsDownloadButton from './IcsDownloadButton.jsx';
import RatingPicker from './RatingPicker.jsx';
import { Button } from '@/components/ui/button';
import { useModalA11y } from '../lib/useModalA11y.js';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';

// Status rendered as a small dot + word — semantic colour stays a dot,
// per the app-wide design language.
const statusDot = {
  pending:   'bg-amber-500',
  scheduled: 'bg-primary',
  completed: 'bg-emerald-500',
  cancelled: 'bg-zinc-400',
};

// Min datetime (HTML form attribute) — 1 hour from now
function minDateTimeLocal() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  // Strip seconds/milliseconds; convert to local-time YYYY-MM-DDTHH:mm
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export default function SessionCard({ session, currentUserId, onUpdate }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reflection, setReflection] = useState('');
  const [rating, setRating] = useState(null);
  const [showReflection, setShowReflection] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [draftDate, setDraftDate] = useState(isoToLocalInput(session.scheduled_at));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useModalA11y();

  // Close on Escape while the popup is open.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const isMentor = session.mentor?.id === currentUserId;
  const isMentee = session.mentee?.id === currentUserId;
  const other = isMentor ? session.mentee : session.mentor;
  const otherRole = isMentor ? t('components.session.role.mentee') : t('components.session.role.mentor');
  const statusLabel = (s) => {
    const known = ['pending', 'scheduled', 'completed', 'cancelled'];
    return known.includes(s) ? t(`components.session.status.${s}`) : s;
  };

  const sessionTime = session.scheduled_at ? new Date(session.scheduled_at).getTime() : null;
  const isPastScheduled  = session.status === 'scheduled' && sessionTime !== null && sessionTime < Date.now();
  const isFuture         = session.status === 'scheduled' && sessionTime !== null && sessionTime >= Date.now();
  const isUndated        = session.status === 'scheduled' && sessionTime === null;

  // Has the current viewer already submitted their own completion?
  const viewerCompleted = isMentor
    ? !!session.mentor_completed_at
    : isMentee ? !!session.mentee_completed_at : false;

  const showAcceptDecline = isMentor && session.status === 'pending';
  // Both sides can mark a past session complete — each writes their own
  // reflection. Once the viewer has completed their side, the card moves to
  // Past meetings, so we no longer offer the action here.
  const showMarkComplete  = (isMentee || isMentor) && isPastScheduled && !viewerCompleted;
  const reflectionPrompt  = isMentor
    ? t('components.session.reflectionPrompt.mentor')
    : t('components.session.reflectionPrompt.mentee');
  const showReschedule    =
    !isPastScheduled &&
    (session.status === 'pending' || session.status === 'scheduled') &&
    session.status !== 'completed' && session.status !== 'cancelled';
  const showCancel        =
    !isPastScheduled &&
    (session.status === 'pending' || session.status === 'scheduled');

  async function handleAccept() {
    const updated = await api.put(`/sessions/${session.id}`, { status: 'scheduled' });
    onUpdate?.(updated.data);
  }
  async function handleDecline() {
    if (!confirm(t('components.session.confirmDecline'))) return;
    const updated = await api.put(`/sessions/${session.id}`, { status: 'cancelled' });
    onUpdate?.(updated.data);
  }
  async function handleComplete() {
    if (showReflection) {
      setSubmitting(true);
      setError('');
      // Send the reflection + rating to the right fields based on viewer's role
      const body = { status: 'completed' };
      if (reflection.trim()) {
        if (isMentor) body.mentor_reflection = reflection.trim();
        else body.reflection = reflection.trim();
      }
      if (rating !== null) {
        if (isMentor) body.mentor_rating = rating;
        else body.mentee_rating = rating;
      }
      try {
        const updated = await api.put(`/sessions/${session.id}`, body);
        setShowReflection(false);
        onUpdate?.(updated.data);
      } catch (e) {
        setError(e?.message || t('components.session.saveError'));
      } finally {
        setSubmitting(false);
      }
    } else {
      setShowReflection(true);
    }
  }
  async function handleSaveDate() {
    if (!draftDate) return;
    setSubmitting(true);
    try {
      const body = { scheduled_at: new Date(draftDate).toISOString() };
      if (isMentor && session.status === 'pending') body.status = 'scheduled';
      const updated = await api.put(`/sessions/${session.id}`, body);
      onUpdate?.(updated.data);
      setEditingDate(false);
    } finally {
      setSubmitting(false);
    }
  }
  async function handleCancelSession() {
    const msg = isMentor && session.status === 'pending'
      ? t('components.session.confirmCancelRequest')
      : t('components.session.confirmCancelSession');
    if (!confirm(msg)) return;
    const updated = await api.put(`/sessions/${session.id}`, { status: 'cancelled' });
    onUpdate?.(updated.data);
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
          <span className="min-w-0 truncate text-sm">
            <span className="font-medium text-foreground">{other?.name}</span>
            <span className="text-muted-foreground"> · {otherRole}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground">
            {session.scheduled_at && (
              <span>
                {new Date(session.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${statusDot[session.status] || statusDot.pending}`} aria-hidden="true" />
              {statusLabel(session.status)}
            </span>
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </span>
        </button>
      </div>

      {/* Popup with the meeting details, reflection and actions. */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`session-modal-title-${session.id}`}
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white [box-shadow:var(--shadow-overlay)]"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-5">
              <div className="min-w-0">
                <h2 id={`session-modal-title-${session.id}`} className="text-base font-medium leading-snug text-foreground">
                  {session.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {other?.name} · {otherRole}
                  {session.scheduled_at
                    ? <> · {new Date(session.scheduled_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</>
                    : null}
                </p>
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

            {/* Body */}
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {!session.scheduled_at && isUndated && (
                <p className="text-sm italic text-muted-foreground">{t('components.session.noDateSet')}</p>
              )}

              {session.topics?.length > 0 && (
                <p className="text-sm text-muted-foreground">{session.topics.join(' · ')}</p>
              )}

              {session.pre_session_question && (
                <p className="border-l-2 border-[var(--border)] pl-3 text-sm italic text-muted-foreground">
                  “{session.pre_session_question}”
                </p>
              )}

              {session.status === 'completed' &&
                ((isMentee && session.reflection) || (isMentor && session.mentor_reflection)) && (
                  <div>
                    <p className="label-meta">{t('components.session.yourReflection')}</p>
                    <p className="mt-1 text-sm italic text-muted-foreground">
                      “{isMentor ? session.mentor_reflection : session.reflection}”
                    </p>
                  </div>
                )}

              {/* Reflection input — shown when the user clicks Mark as completed */}
              {showReflection && session.status !== 'completed' && (
                <div className="space-y-3">
                  <div>
                    <label className="label">{reflectionPrompt}</label>
                    <textarea
                      className="input resize-none"
                      rows={3}
                      value={reflection}
                      onChange={e => setReflection(e.target.value)}
                      placeholder={t('components.session.reflectionPlaceholder')}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="label">{t('components.session.howUseful')}</label>
                    <RatingPicker value={rating} onChange={setRating} />
                  </div>
                </div>
              )}

              {/* Reschedule input — inline datetime picker */}
              {editingDate && (
                <div className="space-y-1">
                  <label className="label">
                    {isMentor && session.status === 'pending'
                      ? t('components.session.dateLabelAccept')
                      : session.scheduled_at ? t('components.session.dateLabelReschedule') : t('components.session.dateLabelSet')}
                  </label>
                  <input
                    type="datetime-local"
                    className="input max-w-xs"
                    value={draftDate}
                    min={minDateTimeLocal()}
                    onChange={e => setDraftDate(e.target.value)}
                    autoFocus
                  />
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600" role="alert">{error}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] p-4">
              {showAcceptDecline && (
                <>
                  <Button type="button" size="sm" onClick={handleAccept}>{t('components.session.accept')}</Button>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDecline}>
                    {t('components.session.decline')}
                  </Button>
                </>
              )}

              {showMarkComplete && !editingDate && (
                <Button type="button" size="sm" onClick={handleComplete} disabled={submitting}>
                  {showReflection ? (submitting ? t('components.session.saving') : t('components.session.saveReflectionComplete')) : t('components.session.markCompleted')}
                </Button>
              )}

              {showReschedule && !editingDate && !showReflection && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setDraftDate(isoToLocalInput(session.scheduled_at)); setEditingDate(true); }}
                >
                  {isMentor && session.status === 'pending'
                    ? t('components.session.acceptSchedule')
                    : session.scheduled_at ? t('components.session.reschedule') : t('components.session.setDate')}
                </Button>
              )}

              {editingDate && (
                <>
                  <Button type="button" size="sm" onClick={handleSaveDate} disabled={submitting || !draftDate}>
                    {submitting ? t('components.session.saving') : t('components.session.save')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingDate(false); setDraftDate(isoToLocalInput(session.scheduled_at)); }}>
                    {t('components.session.discard')}
                  </Button>
                </>
              )}

              {/* Cancel — visible whenever the session can still be called off.
                  For pending-as-mentor we already have Decline, which is the same action;
                  don't double up. */}
              {showCancel && !showAcceptDecline && !editingDate && !showReflection && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleCancelSession}>
                  {t('components.session.cancel')}
                </Button>
              )}

              {isFuture && <IcsDownloadButton sessionId={session.id} />}

              <Link
                to={`/profile/${other?.id}`}
                className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setOpen(false)}
              >
                {t('components.session.viewProfile')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
