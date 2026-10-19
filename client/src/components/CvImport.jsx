import React, { useId, useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.jsx';
import { Field } from './ui/field.jsx';
import CareerEntryFields, { department } from './CareerEntryFields.jsx';
import TeachSkillsEditor from './TeachSkillsEditor.jsx';
import SkillTagInput from './SkillTagInput.jsx';
import { monthYearValue, parseMonthYear } from '../lib/monthYear.mjs';

// Update a profile from a CV: one button on the page, everything else in a
// pop-up. Nothing is saved on upload: what the file suggests is laid out in the
// same editable fields as onboarding, next to a note of what it would replace,
// and only "Apply" writes it.
export default function CvImport({ profile, onApplied }) {
  const { t } = useT();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [review, setReview] = useState(null);
  const current = profile.skills || [];
  const change = (field, value) => setReview(now => ({ ...now, [field]: value }));
  // Closing the pop-up drops whatever was not applied.
  const close = () => { setOpen(false); setDraft(null); setReview(null); setError(''); };

  async function upload(file) {
    if (!file || busy) return;
    if (!consent) { setError(t('onboarding.import.consentRequired')); return; }
    if (file.size > 10 * 1024 * 1024 || !/\.(pdf|docx)$/i.test(file.name)) { setError(t('onboarding.import.error')); return; }
    setBusy(true); setError('');
    const data = new FormData();
    data.append('file', file);
    try {
      // The agreement is stored before the file leaves the browser.
      await api.post('/users/me/consents', { purpose: 'ai_profile_import' });
      const { data: imported } = await api.post('/profile/ingest', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      const proposed = imported.proposed || {};
      setDraft(imported);
      setReview({
        // Null when the file names no experience: the profile's own is then kept.
        career: proposed.career_history?.length ? proposed.career_history.map(entry => ({
          role: entry.role || entry.role_title || proposed.job_title || '',
          department: department(entry.department || proposed.department || profile.department),
          company: entry.company || '', description: entry.description || '',
          start_date: monthYearValue(entry.start_year, entry.start_month),
          end_date: monthYearValue(entry.end_year, entry.end_month),
        })) : null,
        bio: proposed.bio || profile.bio || '',
        location: proposed.location || profile.location || '',
        canTeach: (proposed.can_teach?.length ? proposed.can_teach : current.filter(skill => skill.type === 'can_teach'))
          .map(skill => (typeof skill === 'string' ? { skill, example_project: '' } : { skill: skill.skill, example_project: skill.example_project || '' })),
        wantsToLearn: proposed.wants_to_learn?.length ? proposed.wants_to_learn : current.filter(skill => skill.type === 'wants_to_learn').map(skill => skill.skill),
      });
    } catch {
      setError(t('onboarding.import.unavailable'));
    } finally { setBusy(false); }
  }

  async function apply() {
    if (!review || busy) return;
    if (review.career?.some(entry => !entry.role.trim() || !entry.department.trim())) { setError(t('profile.cv.entryIncomplete')); return; }
    const career = review.career?.length
      ? review.career.map(entry => {
          const start = parseMonthYear(entry.start_date);
          const end = parseMonthYear(entry.end_date);
          return { role: entry.role, department: entry.department, company: entry.company, description: entry.description || '',
            start_year: start.year, start_month: start.month, end_year: end.year, end_month: end.month };
        })
      : profile.career?.length ? profile.career : [{ role: profile.current_role || '', department: profile.department || '' }];
    const payload = {
      name: profile.name, department: career[0].department || profile.department, current_role: career[0].role || profile.current_role,
      seniority: profile.seniority, shadow_role_response: profile.shadow_role_response,
      location: review.location, bio: review.bio, career,
      can_teach: review.canTeach, wants_to_learn: review.wantsToLearn,
      program: profile.program || '', cohort_year: profile.cohort_year || null, persona: profile.role,
      linkedin_url: profile.linkedin_url || null, linkedin_headline: profile.linkedin_headline || null,
    };
    setBusy(true); setError('');
    try {
      await api.post(`/profile/ingest/${draft.draft_id}/accept`, { accepted_json: { ...draft.proposed, ...payload } });
      const response = await api.post('/users/me/onboarding', payload);
      close();
      await onApplied(response.data);
    } catch {
      setError(t('onboarding.import.unavailable'));
    } finally { setBusy(false); }
  }

  const was = value => (value ? <p className="text-xs text-muted-foreground">{t('profile.cv.current', { value })}</p> : null);
  // Reading a CV uses AI, which this member switched off.
  if (profile.ai_opt_out) return null;

  return (<>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>{t('profile.cv.open')}</Button>
    <Dialog open={open} onOpenChange={next => { if (!next && !busy) close(); }}>
    <DialogContent className={review ? 'sm:max-w-3xl' : 'sm:max-w-md'} showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{review ? t('profile.cv.reviewTitle') : t('profile.cv.open')}</DialogTitle><DialogDescription>{review ? t('onboarding.import.reviewNotice') : t('onboarding.import.desc')}</DialogDescription></DialogHeader>
      {!review && <>
      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={event => setConsent(event.target.checked)} />
        <span>{t('onboarding.import.consent')}</span>
      </label>
      <input id={inputId} className="peer sr-only" aria-label={t('onboarding.import.browse')} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy || !consent} onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} />
      <label htmlFor={inputId} className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--input)] bg-muted/40 px-4 py-3 text-center peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${busy || !consent ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted'}`}>
        <span className="rounded-[var(--control-radius)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{busy && !review ? t('onboarding.import.reading') : t('onboarding.import.browse')}</span>
        {!busy && <span className="text-xs text-muted-foreground">{t('onboarding.import.hint')}</span>}
      </label>
      </>}
      {review && (
        <div className="space-y-5" data-testid="cv-review">
          <section className="space-y-3">
            <h4 className="text-sm font-semibold">{t('onboarding.career.workExperience')}</h4>
            {review.career ? <>
              <p className="text-xs text-muted-foreground">{t('profile.cv.replacesExperience', { count: profile.career?.length || 0 })}</p>
              {review.career.map((entry, index) => (
                <div key={index} className="career-entry-form">
                  <CareerEntryFields value={entry} onChange={next => change('career', review.career.map((item, at) => (at === index ? next : item)))} />
                  <div><Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => change('career', review.career.filter((_, at) => at !== index))}>{t('profile.career.remove')}</Button></div>
                </div>
              ))}
            </> : <p className="text-xs text-muted-foreground">{t('profile.cv.noExperience')}</p>}
          </section>
          <section className="space-y-2">
            <Field label={t('onboarding.fields.bio')} as="textarea" value={review.bio} onChange={event => change('bio', event.target.value)} />
            {review.bio !== (profile.bio || '') && was(profile.bio)}
            <Field label={t('profile.placeholder.location')} value={review.location} onChange={event => change('location', event.target.value)} />
            {review.location !== (profile.location || '') && was(profile.location)}
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">{t('onboarding.teach.title')}</h4>
            <p className="text-xs text-muted-foreground">{t('profile.cv.replacesSkills')}</p>
            <TeachSkillsEditor value={review.canTeach} onChange={next => change('canTeach', next)} placeholder={t('onboarding.teach.placeholder')} ariaLabel={t('onboarding.teach.aria')} />
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">{t('onboarding.learn.title')}</h4>
            <SkillTagInput value={review.wantsToLearn} onChange={next => change('wantsToLearn', next)} placeholder={t('onboarding.learn.placeholder')} ariaLabel={t('onboarding.learn.aria')} />
          </section>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={apply} disabled={busy}>{t('profile.btn.applyCv')}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>{t('profile.cv.discard')}</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
    </Dialog>
  </>);
}
