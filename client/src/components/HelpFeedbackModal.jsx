import React, { useEffect, useRef, useState } from 'react';
import api from '../api/index.js';
import { useModalA11y } from '../lib/useModalA11y.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';

const CATEGORIES = [
  { value: 'general', labelKey: 'components.help.categoryGeneral' },
  { value: 'bug', labelKey: 'components.help.categoryBug' },
  { value: 'idea', labelKey: 'components.help.categoryIdea' },
  { value: 'question', labelKey: 'components.help.categoryQuestion' },
];

// Small dialog opened from the profile dropdown. Lets any signed-in user
// send a short note to the team. Submissions land in `feedback_messages`
// and are reviewable by org/platform admins under Admin → Feedback.
export default function HelpFeedbackModal({ onClose }) {
  const { t } = useT();
  const [category, setCategory] = useState('general');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentAt, setSentAt] = useState(null);
  const dialogRef = useModalA11y(true);
  const inFlight = useRef(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit() {
    if (busy || inFlight.current) return;
    const text = (message || '').trim();
    if (!text) {
      setError(t('components.help.errorEmpty'));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await api.post('/feedback', { category, message: text });
      setSentAt(Date.now());
      setMessage('');
    } catch (e) {
      setError(e?.response?.data?.error || t('components.help.errorSend'));
    } finally {
      setBusy(false);
      inFlight.current = false;
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
        aria-labelledby="help-modal-title"
        className="card w-full max-w-md flex flex-col [box-shadow:var(--shadow-overlay)]"
      >
        <div className="p-6 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between gap-3">
            <h2 id="help-modal-title" className="text-lg font-semibold text-foreground">
              {t('components.help.title')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('components.help.close')}
              disabled={busy}
              className="text-muted-foreground hover:text-secondary-foreground text-2xl leading-none disabled:opacity-50"
            >
              &times;
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t('components.help.subtitle')}
          </p>
        </div>

        <div className="p-6 space-y-4">
          {sentAt ? (
            <div className="rounded-lg border border-[var(--border)] bg-muted/40 p-4 text-sm text-foreground">
              <p className="font-medium">{t('components.help.thanksTitle')}</p>
              <p className="mt-1">{t('components.help.thanksBody')}</p>
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
              {t('components.help.whatAbout')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  disabled={busy}
                  className={[
                    'rounded-xl border px-3 py-2 text-left text-sm transition-colors duration-150',
                    category === c.value
                      ? 'border-foreground bg-muted text-foreground'
                      : 'border-[var(--border)] bg-card text-foreground hover:bg-muted/60',
                  ].join(' ')}
                >
                  {t(c.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="help-message" className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
              {t('components.help.yourMessage')}
            </label>
            <textarea
              id="help-message"
              rows={5}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
              placeholder={t('components.help.placeholder')}
              data-testid="help-message-input"
              className="input"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{message.length}/2000</p>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="p-5 border-t border-[var(--border-subtle)] flex justify-end gap-2">
          <Button
            type="button"
            onClick={onClose}
            disabled={busy}
            variant="ghost"
            size="sm"
          >
            {sentAt ? t('components.help.close') : t('components.help.cancel')}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || !message.trim()}
            data-testid="help-submit-button"
            size="sm"
          >
            {busy ? t('components.help.sending') : sentAt ? t('components.help.sendAnother') : t('components.help.send')}
          </Button>
        </div>
      </div>
    </div>
  );
}
