import React, { useMemo, useState } from 'react';
import api from '../api/index.js';
import { useEffect, useRef } from 'react';
import { createDraft } from './demo/homeDemo.js';
import { homeCopy } from './demo/homeCopy.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';

const TOTAL_STEPS = 4;

export default function SessionRequestModal({ mentor, onClose, onSuccess, initialQuestion = '', initialIntent = 'one_off' }) {
  const { t, lang } = useT();
  const copy = homeCopy(lang);
  const [step, setStep] = useState(1);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [question, setQuestion] = useState(initialQuestion);
  const [intent, setIntent] = useState(initialIntent === 'ongoing' ? 'ongoing' : 'one_off');
  const [draft, setDraft] = useState('');
  const [draftEdited, setDraftEdited] = useState(false);
  const [requestTitle, setRequestTitle] = useState(initialQuestion.slice(0, 80));
  const idempotencyKey = useRef(crypto.randomUUID());
  const submitLock = useRef(false);
  const submittedPayload = useRef(null);
  const bodyRef = useRef(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  // Min datetime: 1 hour from now
  const minDate = new Date(Date.now() + 60 * 60 * 1000);
  const minDateTime = new Date(minDate.getTime() - minDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  function reviewDraft() {
    if (scheduledAt && new Date(scheduledAt).getTime() < Date.now() + 60 * 60 * 1000) { setError(t('components.sessionRequest.step3Label')); return; }
    if (!draftEdited) setDraft(createDraft({ name: mentor.name, question, intent, when: scheduledAt ? new Date(scheduledAt).toLocaleString(lang) : '', copy }));
    if (!requestTitle.trim()) setRequestTitle(question.trim().slice(0, 80));
    setError(''); setStep(4);
  }

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
    if (step !== 4 || submitLock.current) return;
    if (!draft.trim() || !requestTitle.trim()) { setError(copy.emptyDraft); return; }
    if (!question.trim()) {
      setError(t('components.sessionRequest.errorFocusQuestion'));
      setStep(2);
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        mentor_id: mentor.id,
        title: requestTitle.trim(),
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        pre_session_question: question.trim(),
        message: draft.trim(),
        follow_up_intent: intent,
        idempotency_key: idempotencyKey.current,
        duration_minutes: 60,
        topics: selectedTopics,
      };
      submittedPayload.current ||= payload;
      await api.post('/sessions', submittedPayload.current);
      onSuccess?.();
    } catch (e) {
      setError(e.response?.data?.error || t('components.sessionRequest.errorGeneric'));
      if (e.response?.status >= 400 && e.response?.status < 500) submittedPayload.current = null;
      submitLock.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
      <div className="session-request-modal flex max-h-[calc(100vh-2rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-[18px] border border-[var(--border)] bg-card [box-shadow:var(--shadow-overlay)]">
        <div className="flex-shrink-0 border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{t('components.sessionRequest.title')}</h2>
            <button disabled={submitting} aria-label={copy.close} onClick={onClose} className="grid size-9 place-items-center rounded-lg text-2xl leading-none text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">&times;</button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{t('components.sessionRequest.subtitle', { name: mentor.name, department: mentor.department })}</p>
        </div>

        <div ref={bodyRef} className="session-modal-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Step indicator */}
          <p className="text-xs font-medium tabular-nums text-muted-foreground">{step} / {TOTAL_STEPS}</p>

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
                        {active && <span className="mr-1.5" aria-hidden="true">+</span>}
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
                maxLength={4000}
                aria-label={t('components.sessionRequest.step2Label')}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder={t('components.sessionRequest.step2Placeholder')}
                autoFocus
              />
              <div className="text-right text-xs text-muted-foreground mt-1">{question.length}/4000</div>
              <label className="mt-3 block text-sm">{copy.intent}<select className="input mt-1" value={intent} onChange={e => setIntent(e.target.value)}><option value="one_off">{copy.oneOff}</option><option value="ongoing">{copy.ongoing}</option></select></label>
              {selectedTopics.length > 0 && (
                <div className="mt-3 rounded-lg border border-[var(--border)] bg-muted/40 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-foreground font-medium mb-1">{t('components.sessionRequest.step2TopicsPicked')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedTopics.map(t => (
                      <span key={t} className="rounded-md border border-[var(--border)] bg-card px-2.5 py-0.5 text-xs text-foreground">
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
                aria-label={t('components.sessionRequest.step3Label')}
                className="input"
                value={scheduledAt}
                min={minDateTime}
                onChange={e => setScheduledAt(e.target.value)}
              />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5 text-sm">
              <div className="border-b border-border pb-4">
                <p className="font-semibold text-foreground">{t('components.sessionRequest.reviewTitle')}</p>
                <p className="mt-2"><span className="font-medium">{copy.recipient}:</span> {mentor.name}</p>
              </div>
              <p className="text-xs text-muted-foreground">{copy.draft}</p>
              <label className="block">{t('components.sessionRequest.title')}<input className="input mt-1" value={requestTitle} maxLength={120} disabled={submitting || !!submittedPayload.current} onChange={e => setRequestTitle(e.target.value)} /></label>
              <label className="block">{copy.message}<textarea className="input mt-1 min-h-40 resize-none" value={draft} maxLength={6000} disabled={submitting || !!submittedPayload.current} onChange={e => { setDraft(e.target.value); setDraftEdited(true); }} /></label>
              <p>{intent === 'ongoing' ? copy.ongoing : copy.oneOff}</p>
              <div><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('components.sessionRequest.reviewQuestion')}</span><p className="mt-1 text-foreground">{question}</p></div>
              {selectedTopics.length > 0 && <div><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('components.sessionRequest.reviewTopics')}</span><p className="mt-1 text-foreground">{selectedTopics.join(', ')}</p></div>}
              <div><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('components.sessionRequest.reviewWhen')}</span><p className="mt-1 text-foreground">{scheduledAt ? new Date(scheduledAt).toLocaleString() : t('components.sessionRequest.reviewNoTime')}</p></div>
              <p className="text-xs text-muted-foreground">{t('components.sessionRequest.reviewNotice')}</p>
            </div>
          )}

          {error && <div role="alert" className="text-red-600 text-sm">{error}<a className="mt-2 block underline" href="/explorer?mode=directory">{copy.browse}</a></div>}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-4">
          {step === 1 && (
            <>
              <Button onClick={onClose} variant="outline">{t('components.sessionRequest.cancel')}</Button>
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
              <Button onClick={reviewDraft}>{t('components.sessionRequest.review')}</Button>
            </>
          )}
          {step === 4 && (
            <>
              <Button disabled={submitting || !!submittedPayload.current} onClick={() => { setStep(3); setError(''); }} variant="outline">{t('components.sessionRequest.back')}</Button>
              <Button onClick={handleSubmit} disabled={submitting}>{submitting ? t('components.sessionRequest.sending') : t('components.sessionRequest.confirm')}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
