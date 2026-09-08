import React, { useEffect, useState } from 'react';
import IcsDownloadButton from './IcsDownloadButton.jsx';
import api from '../api/index.js';
import { useModalA11y } from '../lib/useModalA11y.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';

// Popup the mentee sees on their next dashboard load after a mentor accepts
// one or more session requests. Lists each pending acceptance with:
//   - mentor name + title
//   - scheduled time OR a "Set a date" inline picker when the mentor accepted
//     without proposing a time
//   - an "Add to calendar" ICS button once a time is set
// "Got it" persists the acknowledgement via acknowledge_session RPC so the
// modal does not reappear on subsequent logins.
function formatScheduled(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function minDateTimeLocal() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export default function AcceptanceModal({ sessions, onAcknowledged, onClose }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [editingDateFor, setEditingDateFor] = useState(null);
  const [draftDate, setDraftDate] = useState('');
  const [localSessions, setLocalSessions] = useState(sessions);
  const [error, setError] = useState('');
  const dialogRef = useModalA11y(true);

  // Keep local state in sync if the parent reloads the prop (e.g. after a
  // partial dismissAll retry).
  useEffect(() => { setLocalSessions(sessions); }, [sessions]);

  // Escape key dismisses the modal (matches WAI-ARIA dialog expectations).
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  if (!localSessions || localSessions.length === 0) return null;

  async function dismissAll() {
    if (busy) return;
    setBusy(true);
    setError('');
    const acknowledgedIds = new Set();
    try {
      for (const s of localSessions) {
        // Acknowledge each row — the RPC is idempotent and only writes when
        // the row was previously unacknowledged.
        // eslint-disable-next-line no-await-in-loop
        await api.post(`/sessions/${s.id}/acknowledge`, {});
        acknowledgedIds.add(s.id);
      }
      // Wait for the parent to refresh badge/list before closing, otherwise
      // there's a frame where the modal is gone but the badge is stale.
      await onAcknowledged?.();
      onClose?.();
    } catch (e) {
      // Some rows may have succeeded before the failure. Drop the
      // acknowledged ones from the list so the user can retry just the
      // remainder, and force the parent to refresh its counts.
      if (acknowledgedIds.size > 0) {
        setLocalSessions((prev) => prev.filter((s) => !acknowledgedIds.has(s.id)));
        try { await onAcknowledged?.(); } catch { /* noop */ }
      }
      setError(e?.response?.data?.error || t('components.acceptance.errorAck'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDateFor(session) {
    if (!draftDate) return;
    setBusy(true);
    setError('');
    try {
      const isoDate = new Date(draftDate).toISOString();
      const res = await api.put(`/sessions/${session.id}`, { scheduled_at: isoDate });
      const next = localSessions.map((s) =>
        s.id === session.id
          ? { ...s, scheduled_at: res?.data?.scheduled_at || isoDate }
          : s
      );
      setLocalSessions(next);
      setEditingDateFor(null);
      setDraftDate('');
    } catch (e) {
      setError(e?.response?.data?.error || t('components.acceptance.errorDate'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="acceptance-modal-title"
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-[10px] border border-[var(--border)] bg-card [box-shadow:var(--shadow-overlay)]"
      >
        <div className="p-6 border-b border-[var(--border-subtle)] flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
            <h2 id="acceptance-modal-title" className="text-lg font-semibold text-foreground">
              {localSessions.length === 1 ? t('components.acceptance.titleOne') : t('components.acceptance.titleMany')}
            </h2>
            <button
              onClick={onClose}
              aria-label={t('components.acceptance.close')}
              disabled={busy}
              className="text-muted-foreground hover:text-secondary-foreground text-2xl leading-none disabled:opacity-50"
            >
              &times;
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t('components.acceptance.subtitle')}
          </p>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {localSessions.map((session) => {
            const scheduled = formatScheduled(session.scheduled_at);
            const isEditing = editingDateFor === session.id;
            return (
              <div
                key={session.id}
                data-testid="acceptance-session"
                className="rounded-xl border border-[var(--border)] bg-muted/60 p-4 space-y-3"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {session.title || t('components.acceptance.sessionFallback')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('components.acceptance.withMentor', { name: session.mentor?.name || t('components.acceptance.yourMentor') })}
                  </p>
                </div>

                {scheduled ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{t('components.acceptance.scheduledFor')}</span> {scheduled}
                    </p>
                    <IcsDownloadButton sessionId={session.id} />
                  </div>
                ) : isEditing ? (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-secondary-foreground">
                      {t('components.acceptance.proposeDate')}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="datetime-local"
                        value={draftDate}
                        min={minDateTimeLocal()}
                        onChange={(e) => setDraftDate(e.target.value)}
                        className="rounded-lg border border-[var(--input)] bg-card px-3 py-1.5 text-sm"
                      />
                      <Button
                        type="button"
                        disabled={busy || !draftDate}
                        onClick={() => saveDateFor(session)}
                        size="sm"
                      >
                        {t('components.acceptance.saveDate')}
                      </Button>
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => { setEditingDateFor(null); setDraftDate(''); }}
                        variant="ghost"
                        size="sm"
                      >
                        {t('components.acceptance.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-secondary-foreground">
                      {t('components.acceptance.noTime')}
                    </p>
                    <Button
                      type="button"
                      data-testid="set-date-button"
                      onClick={() => {
                        setEditingDateFor(session.id);
                        setDraftDate(minDateTimeLocal());
                      }}
                      variant="outline"
                      size="sm"
                    >
                      {t('components.acceptance.setDate')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-5 border-t border-[var(--border-subtle)] flex-shrink-0 space-y-2">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              data-testid="acceptance-got-it"
              onClick={dismissAll}
              disabled={busy}
              size="sm"
            >
              {busy ? t('components.acceptance.saving') : t('components.acceptance.gotIt')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
