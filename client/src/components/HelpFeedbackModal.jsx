import React, { useEffect, useState } from 'react';
import api from '../api/index.js';

const CATEGORIES = [
  { value: 'general', label: 'General comment' },
  { value: 'bug', label: 'Bug or broken thing' },
  { value: 'idea', label: 'Idea or suggestion' },
  { value: 'question', label: 'Question for the team' },
];

// Small dialog opened from the profile dropdown. Lets any signed-in user
// send a short note to the team. Submissions land in `feedback_messages`
// and are reviewable by org/platform admins under Admin → Feedback.
export default function HelpFeedbackModal({ onClose }) {
  const [category, setCategory] = useState('general');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentAt, setSentAt] = useState(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit() {
    if (busy) return;
    const text = (message || '').trim();
    if (!text) {
      setError('Add at least one sentence so we know how to help.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/feedback', { category, message: text });
      setSentAt(Date.now());
      setMessage('');
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not send the message. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <h2 id="help-modal-title" className="text-lg font-semibold text-foreground">
              Help &amp; Feedback
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              disabled={busy}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-50"
            >
              &times;
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Quick note for the team — we read every one. For account or security
            issues, please reach out to your org admin directly.
          </p>
        </div>

        <div className="p-6 space-y-4">
          {sentAt ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <p className="font-medium">Thanks — we got it.</p>
              <p className="mt-1">Your admin will see this message next time they open the feedback view.</p>
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1.5">
              What is this about?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  disabled={busy}
                  className={[
                    'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    category === c.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 bg-white text-foreground hover:bg-muted/40',
                  ].join(' ')}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="help-message" className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1.5">
              Your message
            </label>
            <textarea
              id="help-message"
              rows={5}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
              placeholder="What's on your mind?"
              data-testid="help-message-input"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p className="mt-1 text-[11px] text-gray-400">{message.length}/2000</p>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-muted/40"
          >
            {sentAt ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !message.trim()}
            data-testid="help-submit-button"
            className="rounded-lg bg-primary text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
          >
            {busy ? 'Sending…' : sentAt ? 'Send another' : 'Send message'}
          </button>
        </div>
      </div>
    </div>
  );
}
