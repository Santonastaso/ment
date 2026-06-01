import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import IcsDownloadButton from './IcsDownloadButton.jsx';
import RatingPicker from './RatingPicker.jsx';
import { Surface, SurfaceBody } from './Surface.jsx';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';

// Softer status badges — slate borders, subtle backgrounds. Trust-palette
// rather than the saturated yellow/blue/green of the previous version.
const statusColors = {
  pending:   'bg-amber-50 text-amber-800 border-amber-200',
  scheduled: 'bg-primary/10 text-primary border-primary/20',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-muted text-muted-foreground border-border',
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
  const [reflection, setReflection] = useState('');
  const [rating, setRating] = useState(null);
  const [showReflection, setShowReflection] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [draftDate, setDraftDate] = useState(isoToLocalInput(session.scheduled_at));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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

  const initials = (other?.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <Surface className="transition-colors hover:border-primary/25">
      <SurfaceBody>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <Link to={`/profile/${other?.id}`} className="font-semibold text-foreground hover:text-primary text-sm transition-colors">
                {other?.name}
              </Link>
              <span className="text-xs text-muted-foreground">{otherRole}</span>
            </div>
            <p className="text-sm font-medium text-muted-foreground mt-0.5">{session.title}</p>
            {session.scheduled_at ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(session.scheduled_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            ) : isUndated ? (
              <p className="text-xs text-muted-foreground italic mt-0.5">{t('components.session.noDateSet')}</p>
            ) : null}
            {session.topics?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {session.topics.map((t, i) => (
                  <span key={i} className="bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5 text-[11px] font-medium">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <span className={`text-[10px] font-semibold uppercase tracking-label px-2 py-1 rounded-full border ${statusColors[session.status] || statusColors.pending}`}>
          {statusLabel(session.status)}
        </span>
      </div>

      {/* Pre-session question */}
      {session.pre_session_question && (
        <div className="mt-4 bg-muted rounded-lg p-3 text-sm text-muted-foreground border border-border">
          <span className="font-medium text-foreground">{t('components.session.focusQuestion')}</span>
          <span className="italic">"{session.pre_session_question}"</span>
        </div>
      )}

      {/* Your private reflection — visible only to the side that wrote it */}
      {session.status === 'completed' && (
        (isMentee && session.reflection) || (isMentor && session.mentor_reflection)
      ) && (
        <div className="mt-3 bg-emerald-50 rounded-lg p-3 text-sm text-muted-foreground border border-emerald-100">
          <span className="font-medium text-emerald-700">{t('components.session.yourReflection')}</span>
          <span className="italic">"{isMentor ? session.mentor_reflection : session.reflection}"</span>
        </div>
      )}

      {/* Reflection input — shown when the user clicks Mark as completed */}
      {showReflection && session.status !== 'completed' && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="label text-sm">{reflectionPrompt}</label>
            <textarea
              className="input resize-none text-sm"
              rows={3}
              value={reflection}
              onChange={e => setReflection(e.target.value)}
              placeholder={t('components.session.reflectionPlaceholder')}
              autoFocus
            />
          </div>
          <div>
            <label className="label text-sm">{t('components.session.howUseful')}</label>
            <RatingPicker value={rating} onChange={setRating} />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">{error}</p>
          )}
        </div>
      )}

      {/* Reschedule input — inline datetime picker */}
      {editingDate && (
        <div className="mt-4 bg-muted rounded-lg p-3 border border-border space-y-2">
          <label className="label">
            {isMentor && session.status === 'pending'
              ? t('components.session.dateLabelAccept')
              : session.scheduled_at ? t('components.session.dateLabelReschedule') : t('components.session.dateLabelSet')}
          </label>
          <input
            type="datetime-local"
            className="input text-sm"
            value={draftDate}
            min={minDateTimeLocal()}
            onChange={e => setDraftDate(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2 items-center">
        {showAcceptDecline && (
          <>
            <button onClick={handleAccept} className="btn-primary text-sm">{t('components.session.accept')}</button>
            <button onClick={handleDecline} className="btn-ghost text-sm text-red-500 hover:bg-red-50">{t('components.session.decline')}</button>
          </>
        )}

        {showMarkComplete && !editingDate && (
          <button onClick={handleComplete} disabled={submitting} className="btn-primary text-sm">
            {showReflection ? (submitting ? t('components.session.saving') : t('components.session.saveReflectionComplete')) : t('components.session.markCompleted')}
          </button>
        )}

        {/* Reschedule controls — different states */}
        {showReschedule && !editingDate && !showReflection && (
          <button
            onClick={() => { setDraftDate(isoToLocalInput(session.scheduled_at)); setEditingDate(true); }}
            className="btn-secondary text-sm"
          >
            {isMentor && session.status === 'pending'
              ? t('components.session.acceptSchedule')
              : session.scheduled_at ? t('components.session.reschedule') : t('components.session.setDate')}
          </button>
        )}
        {editingDate && (
          <>
            <button onClick={handleSaveDate} disabled={submitting || !draftDate} className="btn-primary text-sm">
              {submitting ? t('components.session.saving') : t('components.session.save')}
            </button>
            <button onClick={() => { setEditingDate(false); setDraftDate(isoToLocalInput(session.scheduled_at)); }} className="btn-ghost text-sm">
              {t('components.session.discard')}
            </button>
          </>
        )}

        {/* Cancel — visible whenever the session can still be called off.
            For pending-as-mentor we already have Decline, which is the same action;
            don't double up. */}
        {showCancel && !showAcceptDecline && !editingDate && !showReflection && (
          <button onClick={handleCancelSession} className="btn-ghost text-sm text-red-500 hover:bg-red-50">
            {t('components.session.cancel')}
          </button>
        )}

        {/* ICS download — only for confirmed scheduled sessions with a date */}
        {isFuture && <IcsDownloadButton sessionId={session.id} />}

        {showReflection && !submitting && (
          <button onClick={() => setShowReflection(false)} className="btn-ghost text-sm">
            {t('components.session.discardReflection')}
          </button>
        )}
      </div>
      </SurfaceBody>
    </Surface>
  );
}
