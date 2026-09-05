import React, { useMemo, useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';

const TOTAL_STEPS = 4;

export default function SessionRequestModal({ mentor, onClose, onSuccess }) {
  const { t } = useT();
  const [step, setStep] = useState(1);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [question, setQuestion] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Min datetime: 1 hour from now
  const minDateTime = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);

  // Mentor's can_teach skills come through with the user payload from /matches
  // and from peer profile fetches. We dedupe and filter to can_teach.
  const teachSkills = useMemo(() => {
    const list = (mentor?.skills || []).filter(s => s.type === 'can_teach');
    const seen = new Set();
    const out = [];
    for (const s of list) {
      const key = (s.skill || '').toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s.skill);
    }
    return out;
  }, [mentor]);

  function toggleTopic(skill) {
    setSelectedTopics(prev =>
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  }

  async function handleSubmit() {
    if (!question.trim()) {
      setError(t('components.sessionRequest.errorFocusQuestion'));
      setStep(2);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/sessions', {
        mentor_id: mentor.id,
        title: `Session with ${mentor.name}`,
        scheduled_at: scheduledAt || null,
        pre_session_question: question.trim(),
        duration_minutes: 60,
        topics: selectedTopics,
      });
      onSuccess?.();
    } catch (e) {
      setError(e.response?.data?.error || t('components.sessionRequest.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl [box-shadow:var(--shadow-overlay)] w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-[var(--border-subtle)] flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">{t('components.sessionRequest.title')}</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-secondary-foreground text-2xl leading-none">&times;</button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{t('components.sessionRequest.subtitle', { name: mentor.name, department: mentor.department })}</p>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Step indicator */}
          <div className="flex gap-2 mb-2">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full ${(i + 1) <= step ? 'bg-primary' : 'bg-gray-200'}`} />
            ))}
          </div>

          {/* STEP 1 — Topics */}
          {step === 1 && (
            <div>
              <label className="label mb-1">
                {t('components.sessionRequest.step1Label')}
              </label>
              <p className="text-xs text-muted-foreground mb-3">
                {t('components.sessionRequest.step1Help', { name: mentor.name.split(' ')[0] })}
              </p>
              {teachSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  {t('components.sessionRequest.step1NoSkills', { name: mentor.name.split(' ')[0] })}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {teachSkills.map(skill => {
                    const active = selectedTopics.includes(skill);
                    return (
                      <button
                        key={skill}
                        type="button"
                        onClick={() => toggleTopic(skill)}
                        className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card text-foreground border-border hover:bg-muted'
                        }`}
                      >
                        {active && <span className="mr-1.5">✓“</span>}
                        {skill}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedTopics.length > 0 && (
                <p className="text-xs text-muted-foreground mt-3">
                  {selectedTopics.length === 1
                    ? t('components.sessionRequest.step1SelectedOne', { count: selectedTopics.length })
                    : t('components.sessionRequest.step1SelectedMany', { count: selectedTopics.length })}
                </p>
              )}
            </div>
          )}

          {/* STEP 2 — Focus question */}
          {step === 2 && (
            <div>
              <label className="label">
                {t('components.sessionRequest.step2Label')}
              </label>
              <textarea
                className="input resize-none"
                rows={5}
                maxLength={200}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder={t('components.sessionRequest.step2Placeholder')}
                autoFocus
              />
              <div className="text-right text-xs text-muted-foreground mt-1">{question.length}/200</div>
              {selectedTopics.length > 0 && (
                <div className="mt-3 rounded-lg border border-[var(--border)] bg-muted/40 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-foreground font-medium mb-1">{t('components.sessionRequest.step2TopicsPicked')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedTopics.map(t => (
                      <span key={t} className="bg-white text-foreground border border-[var(--border)] rounded-full px-2.5 py-0.5 text-xs">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3 — Date/time */}
          {step === 3 && (
            <div>
              <label className="label">{t('components.sessionRequest.step3Label')} <span className="text-muted-foreground font-normal">{t('components.sessionRequest.step3Optional')}</span></label>
              <input
                type="datetime-local"
                className="input"
                value={scheduledAt}
                min={minDateTime}
                onChange={e => setScheduledAt(e.target.value)}
              />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <p className="font-medium text-foreground">{t('components.sessionRequest.reviewTitle')}</p>
              <div><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('components.sessionRequest.reviewQuestion')}</span><p className="mt-1 text-foreground">{question}</p></div>
              {selectedTopics.length > 0 && <div><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('components.sessionRequest.reviewTopics')}</span><p className="mt-1 text-foreground">{selectedTopics.join(', ')}</p></div>}
              <div><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('components.sessionRequest.reviewWhen')}</span><p className="mt-1 text-foreground">{scheduledAt ? new Date(scheduledAt).toLocaleString() : t('components.sessionRequest.reviewNoTime')}</p></div>
              <p className="text-xs text-muted-foreground">{t('components.sessionRequest.reviewNotice')}</p>
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 pb-6 flex justify-between gap-3 flex-shrink-0">
          {step === 1 && (
            <>
              <Button onClick={onClose} variant="ghost">{t('components.sessionRequest.cancel')}</Button>
              <Button onClick={() => setStep(2)}>
                {selectedTopics.length === 0 ? t('components.sessionRequest.skip') : t('components.sessionRequest.continue')}
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button onClick={() => { setStep(1); setError(''); }} variant="outline">{t('components.sessionRequest.back')}</Button>
              <Button
                onClick={() => { if (question.trim()) { setStep(3); setError(''); } else setError(t('components.sessionRequest.errorFocusQuestion')); }}
              >
                {t('components.sessionRequest.next')}
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button onClick={() => { setStep(2); setError(''); }} variant="outline">{t('components.sessionRequest.back')}</Button>
              <Button onClick={() => setStep(4)}>{t('components.sessionRequest.review')}</Button>
            </>
          )}
          {step === 4 && (
            <>
              <Button onClick={() => { setStep(3); setError(''); }} variant="outline">{t('components.sessionRequest.back')}</Button>
              <Button onClick={handleSubmit} disabled={submitting}>{submitting ? t('components.sessionRequest.sending') : t('components.sessionRequest.confirm')}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
