import React, { useMemo, useState } from 'react';
import api from '../api/index.js';

const TOTAL_STEPS = 3;

export default function SessionRequestModal({ mentor, onClose, onSuccess }) {
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
      setError('Please enter your focus question.');
      setStep(2);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/sessions', {
        mentor_id: mentor.id,
        title: `Mentoring with ${mentor.name}`,
        scheduled_at: scheduledAt || null,
        pre_session_question: question.trim(),
        duration_minutes: 60,
        topics: selectedTopics,
      });
      onSuccess?.();
    } catch (e) {
      setError(e.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Request a session</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
          <p className="text-sm text-gray-500 mt-1">with {mentor.name} · {mentor.department}</p>
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
                What would you like to focus on?
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Pick one or more topics from {mentor.name.split(' ')[0]}'s areas of expertise. You can also skip this and just describe it in the next step.
              </p>
              {teachSkills.length === 0 ? (
                <p className="text-sm text-gray-400 italic">
                  {mentor.name.split(' ')[0]} hasn't listed any teachable skills yet — skip ahead and describe what you want to discuss.
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
                        {active && <span className="mr-1.5">✓</span>}
                        {skill}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedTopics.length > 0 && (
                <p className="text-xs text-gray-500 mt-3">
                  {selectedTopics.length} topic{selectedTopics.length === 1 ? '' : 's'} selected.
                </p>
              )}
            </div>
          )}

          {/* STEP 2 — Focus question */}
          {step === 2 && (
            <div>
              <label className="label">
                What is the one specific question you want to leave this session with an answer to?
              </label>
              <textarea
                className="input resize-none"
                rows={5}
                maxLength={200}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="e.g. How do I structure a large TypeScript project without the types becoming a maintenance burden?"
                autoFocus
              />
              <div className="text-right text-xs text-gray-400 mt-1">{question.length}/200</div>
              {selectedTopics.length > 0 && (
                <div className="mt-3 bg-blue-50/60 border border-blue-100 rounded-lg p-3">
                  <p className="text-[11px] uppercase tracking-wide text-foreground font-medium mb-1">Topics you picked</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedTopics.map(t => (
                      <span key={t} className="bg-white text-foreground border border-blue-200 rounded-full px-2.5 py-0.5 text-xs">
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
              <label className="label">Proposed date and time <span className="text-gray-400 font-normal">(optional — you can set this later)</span></label>
              <input
                type="datetime-local"
                className="input"
                value={scheduledAt}
                min={minDateTime}
                onChange={e => setScheduledAt(e.target.value)}
              />
              <div className="mt-4 bg-gray-50 rounded-lg p-3 text-sm text-gray-600 space-y-2">
                <div>
                  <span className="font-medium text-foreground">Your focus question:</span>
                  <p className="mt-1 italic">"{question}"</p>
                </div>
                {selectedTopics.length > 0 && (
                  <div>
                    <span className="font-medium text-foreground">Topics:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {selectedTopics.map(t => (
                        <span key={t} className="bg-white text-foreground border border-blue-200 rounded-full px-2.5 py-0.5 text-xs">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 pb-6 flex justify-between gap-3 flex-shrink-0">
          {step === 1 && (
            <>
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={() => setStep(2)} className="btn-primary">
                {selectedTopics.length === 0 ? 'Skip — I\'ll describe it' : 'Continue'}
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => { setStep(1); setError(''); }} className="btn-secondary">Back</button>
              <button
                onClick={() => { if (question.trim()) { setStep(3); setError(''); } else setError('Please enter your focus question.'); }}
                className="btn-primary"
              >
                Next
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button onClick={() => { setStep(2); setError(''); }} className="btn-secondary">Back</button>
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary">
                {submitting ? 'Sending…' : 'Send request'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
