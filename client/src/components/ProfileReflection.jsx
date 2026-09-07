import React, { useEffect, useId, useRef, useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';

// Draft ownership stays in Profile so changing tabs does not discard an answer.
export default function ProfileReflection({ history = false, draft, onDraftChange, onSkillsApplied }) {
  const { t, lang } = useT();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(history);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    if (!history) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/reflections').then(res => {
      if (!cancelled) setEntries(res.data.entries || []);
    }).catch(() => {
      if (!cancelled) setError(t('components.reflection.errorLoad'));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [history, reload, t]);

  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    if (!draft.support_needed.trim() && !draft.managed_well.trim()) {
      setError(t('components.reflection.errorAnswerOne'));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/reflections', draft);
      setEntries(prev => [res.data, ...prev.filter(entry => entry.id !== res.data.id)]);
      onDraftChange({ support_needed: '', managed_well: '' });
      setOpen(false);
    } catch {
      setError(t('components.reflection.errorSave'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function apply(entry, gaps, strengths) {
    if (lock.current || entry.applied) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.post(`/reflections/${entry.id}/apply`, { gaps, strengths });
      setEntries(prev => prev.map(item => item.id === entry.id ? { ...item, applied: true } : item));
      try { await onSkillsApplied?.(); }
      catch { setError(t('components.reflection.refreshError')); }
    } catch {
      setError(t('components.reflection.errorApply'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {!history && !open && <Button type="button" onClick={() => setOpen(true)}>{t('components.reflection.startCheckIn')}</Button>}
      {!history && open && (
        <form onSubmit={submit} className="space-y-3">
          {['support_needed', 'managed_well'].map(key => (
            <div key={key}>
              <label htmlFor={fieldId + key} className="mb-1 block text-sm font-medium">{t(key === 'support_needed' ? 'components.reflection.promptSupportNeeded' : 'components.reflection.promptManagedWell')}</label>
              <textarea id={fieldId + key} autoFocus={key === 'support_needed'} rows={2} className="input w-full resize-y" disabled={busy}
                value={draft[key]} onChange={event => onDraftChange({ ...draft, [key]: event.target.value })}
                placeholder={t('components.reflection.formPlaceholder')} />
            </div>
          ))}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>{t('components.reflection.cancel')}</Button>
            <Button type="submit" disabled={busy}>{t(busy ? 'components.reflection.saving' : 'components.reflection.save')}</Button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {history && error && <Button variant="outline" onClick={() => setReload(n => n + 1)}>{t('explorer.retry')}</Button>}
      {loading && <p role="status" className="text-sm">{t('components.reflection.loading')}</p>}
      {history && !loading && !error && entries.length === 0 && <p className="text-sm text-muted-foreground">{t('components.reflection.empty')}</p>}
      {entries.map(entry => (
        <ReflectionReview key={entry.id} entry={entry} busy={busy} onApply={apply} lang={lang} />
      ))}
      {!history && <ContinuationIntent />}
    </div>
  );
}

function ContinuationIntent() {
  const { t } = useT();
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState('');

  async function save(nextAnswer) {
    setSaving(true);
    try {
      await api.post('/continuation-intent', { cohort_term: 'Next term', answer: nextAnswer });
      setAnswer(nextAnswer);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-t border-border pt-3">
      <p className="text-sm font-medium">{t('profile.reflection.continueTitle')}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('profile.reflection.continueHelp')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {['yes', 'unsure', 'no'].map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={answer === value ? 'secondary' : 'outline'}
            disabled={saving}
            onClick={() => save(value)}
          >
            {t(`profile.reflection.continue.${value}`)}
          </Button>
        ))}
      </div>
    </section>
  );
}

function ReflectionReview({ entry, busy, onApply, lang }) {
  const { t } = useT();
  const [review, setReview] = useState(false);
  const [dismissed, setDismissed] = useState([]);
  const gaps = (entry.extracted_gaps || []).filter(skill => !dismissed.includes('gap:' + skill));
  const strengths = (entry.extracted_strengths || []).filter(skill => !dismissed.includes('strength:' + skill));
  const date = new Date(entry.created_at);
  const count = gaps.length + strengths.length;
  return (
    <article className="space-y-2 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">{Number.isNaN(date.getTime()) ? t('components.reflection.timeAgoRecently') : date.toLocaleDateString(lang)}</p>
      {entry.support_needed && <p className="whitespace-pre-wrap break-words text-sm">{entry.support_needed}</p>}
      {entry.managed_well && <p className="whitespace-pre-wrap break-words text-sm">{entry.managed_well}</p>}
      {entry.classifier_source?.startsWith('demo') && <p className="text-xs text-muted-foreground">{t('components.reflection.demoLabel')}</p>}
      {entry.applied ? <p role="status" className="text-sm">{t('components.reflection.appliedToSkills')}</p> : review ? (
        <div className="space-y-3">
          {[['gap', entry.extracted_gaps || [], 'profile.manageSkills.wantsToLearn'], ['strength', entry.extracted_strengths || [], 'profile.manageSkills.canTeach']].map(([kind, skills, label]) => (
            <div key={kind}>
              <h4 className="text-sm font-semibold">{t(label)}</h4>
              {skills.map(skill => <label key={skill} className="mt-1 flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={busy} checked={!dismissed.includes(kind + ':' + skill)}
                  onChange={e => setDismissed(prev => e.target.checked ? prev.filter(item => item !== kind + ':' + skill) : [...prev, kind + ':' + skill])} />
                {skill}
              </label>)}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReview(false)}>{t('components.reflection.cancel')}</Button>
            <Button size="sm" disabled={busy || !count} onClick={() => onApply(entry, gaps, strengths)}>{t('components.reflection.applyToLandscape', { count })}</Button>
          </div>
        </div>
      ) : count > 0 ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setReview(true)}>{t('components.reflection.reviewSuggestions')}</Button>
      ) : <p className="text-sm text-muted-foreground">{t('components.reflection.noSignals')}</p>}
    </article>
  );
}
