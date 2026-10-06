import React, { useMemo, useState } from 'react';
import api from '../api/index.js';
import { useEffect, useRef } from 'react';
import { homeCopy } from './demo/homeCopy.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';
import Portal from './ui/portal.jsx';
import { useModalA11y } from '../lib/useModalA11y.js';
import { ChevronDown, X } from 'lucide-react';
import TimeSlotSelect from './TimeSlotSelect.jsx';

const TOTAL_STEPS = 4;

export default function SessionRequestModal({ mentor, onClose, onSuccess, initialQuestion = '', initialIntent = 'one_off' }) {
  const { t, lang } = useT();
  const dialogRef = useModalA11y(true);
  const copy = homeCopy(lang);
  const [step, setStep] = useState(1);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [question, setQuestion] = useState(initialQuestion);
  const [intent, setIntent] = useState(initialIntent === 'ongoing' ? 'ongoing' : 'one_off');
  const [draft, setDraft] = useState('');
  const [draftEdited, setDraftEdited] = useState(false);
  const [requestTitle, setRequestTitle] = useState(initialQuestion.slice(0, 80));
  const [topicsOpen, setTopicsOpen] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const submitLock = useRef(false);
  const submittedPayload = useRef(null);
  const bodyRef = useRef(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, submitting]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  // Keep the default comfortably beyond the one-hour minimum.
  const minDate = new Date(Date.now() + 60 * 60 * 1000);
  const minDateTime = new Date(minDate.getTime() - minDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const suggestedDate = new Date(Date.now() + 90 * 60 * 1000);
  const suggestedDateTime = new Date(suggestedDate.getTime() - suggestedDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  function pickDay(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(14, 0, 0, 0);
    setScheduledAt(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  }

  function hasInvalidTime() {
    return scheduledAt && (!Number.isFinite(new Date(scheduledAt).getTime()) || new Date(scheduledAt).getTime() < Date.now() + 60 * 60 * 1000);
  }

  async function reviewDraft() {
    if (hasInvalidTime()) { setError(t('components.sessionRequest.step3Invalid')); return; }
    setError('');
    if (!draftEdited) {
      setGeneratingDraft(true);
      try {
        const { data } = await api.post('/discovery/draft', { query: question.trim(), person_id: mentor.id, variant: 0 });
        setDraft(data.draft || '');
      } catch {
        setDraft(question.trim());
        setDraftEdited(true);
        setError('');
      } finally {
        setGeneratingDraft(false);
      }
    }
    if (!requestTitle.trim()) setRequestTitle(question.trim().slice(0, 80));
    setStep(4);
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
    if (hasInvalidTime()) { setError(t('components.sessionRequest.step3Invalid')); setStep(3); return; }
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
      const response = await api.post('/sessions', submittedPayload.current);
      onSuccess?.(response.data);
    } catch (e) {
      setError(t('components.sessionRequest.errorGeneric'));
      if (e.response?.status >= 400 && e.response?.status < 500) submittedPayload.current = null;
      submitLock.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Portal>
    <div className="app-modal-overlay session-request-backdrop bg-black/20">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="session-request-title" className="app-modal-panel session-request-modal flex w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--dialog-radius)] border border-[var(--border)] bg-card [box-shadow:var(--shadow-overlay)]">
        <div className="flex-shrink-0 border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-center justify-between">
            <h2 id="session-request-title" className="text-xl font-semibold tracking-[-0.02em] text-foreground">{t('components.sessionRequest.title')}</h2>
            <Button type="button" variant="ghost" size="icon-sm" disabled={submitting} aria-label={copy.close} title={copy.close} onClick={onClose}><X aria-hidden="true" /></Button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{t('components.sessionRequest.subtitle', { name: mentor.name, department: mentor.department })}</p>
        </div>

        <div key={step} ref={bodyRef} className="session-modal-scroll session-step-content min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Step indicator */}
          <p className="text-xs font-medium tabular-nums text-muted-foreground">{step} / {TOTAL_STEPS}</p>

          {/* STEP 1 — Topics */}
          {step === 1 && (
            <div>
              <p className="mb-3 text-xs text-muted-foreground">{t('components.sessionRequest.availabilityNotice')}</p>
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
                        aria-pressed={active}
                        onClick={() => toggleTopic(skill)}
                        className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card text-foreground border-border hover:bg-muted'
                        }`}
                      >
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
              <div className="mt-4">
                <p className="label mb-2">{copy.intent}</p>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label={copy.intent}>
                  {[
                    { value: 'one_off', label: copy.oneOff },
                    { value: 'ongoing', label: copy.ongoing },
                  ].map(option => {
                    const active = intent === option.value;
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant={active ? 'default' : 'outline'}
                        aria-pressed={active}
                        className="h-auto min-h-11 justify-start whitespace-normal rounded-xl px-4 py-3 text-left"
                        onClick={() => setIntent(option.value)}
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 — Date/time */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="label">{t('components.sessionRequest.step3Label')}</p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('components.sessionRequest.step3Label')}>
                <Button type="button" variant={!scheduledAt ? 'default' : 'outline'} className="h-auto min-h-11 whitespace-normal px-3" aria-pressed={!scheduledAt} onClick={() => setScheduledAt('')}>{t('components.sessionRequest.reviewNoTime')}</Button>
                <Button type="button" variant={scheduledAt ? 'default' : 'outline'} className="h-auto min-h-11 whitespace-normal px-3" aria-pressed={!!scheduledAt} onClick={() => setScheduledAt(suggestedDateTime)}>{t('components.sessionRequest.pickTime')}</Button>
              </div>
              {scheduledAt && <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 flex flex-wrap gap-2">
                  {[1, 3, 7].map(days => <Button key={days} type="button" size="sm" variant="outline" onClick={() => pickDay(days)}>{t(`components.sessionRequest.day${days}`)}</Button>)}
                </div>
                <label className="label">{t('components.sessionRequest.date')}
                  <input type="date" className="input mt-1" min={minDateTime.slice(0, 10)} value={scheduledAt.slice(0, 10)} onChange={e => setScheduledAt(`${e.target.value}T${scheduledAt.slice(11, 16)}`)} />
                </label>
                <TimeSlotSelect label={t('components.sessionRequest.time')} value={scheduledAt} min={minDateTime} onChange={setScheduledAt} />
              </div>}
              <p className="text-xs text-muted-foreground">{t('components.sessionRequest.step3Optional')}</p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5 text-sm">
              <p className="font-semibold text-foreground">{t('components.sessionRequest.reviewTitle')}</p>
              <label className="block">{t('components.sessionRequest.requestTitle')}<input className="input mt-1" value={requestTitle} maxLength={120} disabled={submitting || !!submittedPayload.current} onChange={e => setRequestTitle(e.target.value)} /></label>
              <label className="block">{copy.message}<textarea className="input mt-1 min-h-40 resize-none" value={draft} maxLength={6000} disabled={submitting || !!submittedPayload.current} onChange={e => { setDraft(e.target.value); setDraftEdited(true); }} /></label>
              <section className="space-y-2" aria-label={t('components.sessionRequest.reviewTopics')}>
                <Button
                  type="button"
                  variant="outline"
                  aria-expanded={topicsOpen}
                  aria-controls="session-request-review-topics"
                  className="w-full justify-between whitespace-normal text-left"
                  onClick={() => setTopicsOpen(open => !open)}
                >
                  <span>{t('components.sessionRequest.reviewTopics')} · {selectedTopics.length}</span>
                  <ChevronDown aria-hidden="true" className={`transition-transform duration-200 ${topicsOpen ? 'rotate-180' : ''}`} />
                </Button>
                {topicsOpen && <div id="session-request-review-topics" className="flex flex-wrap gap-2 pt-1">
                  {teachSkills.map(skill => <Button key={skill} type="button" size="sm" variant={selectedTopics.includes(skill) ? 'default' : 'outline'} aria-pressed={selectedTopics.includes(skill)} onClick={() => toggleTopic(skill)}>{skill}</Button>)}
                  {teachSkills.length === 0 && <p className="text-muted-foreground">{t('components.sessionRequest.step1NoSkills', { name: mentor.name.split(' ')[0] })}</p>}
                </div>}
              </section>
              <section className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3" aria-label={t('components.sessionRequest.reviewWhen')}>
                <div><p className="text-xs font-medium text-muted-foreground">{t('components.sessionRequest.reviewWhen')}</p><p>{scheduledAt ? new Date(scheduledAt).toLocaleString(lang) : t('components.sessionRequest.reviewNoTime')}</p></div>
                <Button type="button" variant="outline" size="sm" onClick={() => setStep(3)}>{t(scheduledAt ? 'conversations.reschedule' : 'components.sessionRequest.pickTime')}</Button>
              </section>
              <section className="space-y-2" aria-label={copy.intent}>
                <p className="font-medium">{copy.intent}</p>
                <div className="grid grid-cols-2 gap-2">
                  {[{ value: 'one_off', label: copy.oneOff }, { value: 'ongoing', label: copy.ongoing }].map(option => <Button key={option.value} type="button" variant={intent === option.value ? 'default' : 'outline'} aria-pressed={intent === option.value} disabled={submitting || !!submittedPayload.current} className="h-auto min-h-11 whitespace-normal" onClick={() => setIntent(option.value)}>{option.label}</Button>)}
                </div>
              </section>
              <p className="text-xs text-muted-foreground">{t('components.sessionRequest.reviewNotice')}</p>
            </div>
          )}

          {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
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
              <Button onClick={reviewDraft} disabled={generatingDraft}>{generatingDraft ? copy.preparing : t('components.sessionRequest.review')}</Button>
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
    </Portal>
  );
}
