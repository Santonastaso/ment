import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SkillTagInput from '../components/SkillTagInput.jsx';
import TeachSkillsEditor from '../components/TeachSkillsEditor.jsx';
import CareerEntryFields from '../components/CareerEntryFields.jsx';
import { Field } from '../components/ui/field.jsx';
import { hasPlaceholderName, onboardingErrorKey } from '../lib/onboarding.mjs';
import { Check } from 'lucide-react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import LanguageSwitcher from '../i18n/LanguageSwitcher.jsx';
import { Button } from '../components/ui/button.jsx';

function SuggestedPill() {
  const { t } = useT();
  return <span className="ml-2 text-xs font-medium text-amber-700">{t('onboarding.import.suggested')}</span>;
}

function monthYearToPicker(year, month) {
  if (!year) return '';
  const m = month && month >= 1 && month <= 12 ? month : 1;
  return `${year}-${String(m).padStart(2, '0')}`;
}

export default function Onboarding({ returnTo }) {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [draftId, setDraftId] = useState(null);
  const [classifierSource, setClassifierSource] = useState('');
  const [aiConsent, setAiConsent] = useState(false);
  const [suggested, setSuggested] = useState(() => new Set());

  // Step 1 — Background
  const nameLocked = !!user?.external_source && !hasPlaceholderName(user?.name, user?.email);
  const [name, setName] = useState(hasPlaceholderName(user?.name, user?.email) ? '' : user?.name || '');
  const [persona, setPersona] = useState(user?.role === 'alumnus' ? 'alumnus' : 'student');
  const [program, setProgram] = useState(user?.program || '');
  const [cohortYear, setCohortYear] = useState(user?.cohort_year || '');
  const [location, setLocation] = useState(user?.location || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [linkedinUrl, setLinkedinUrl] = useState(user?.linkedin_url || '');
  // start_date / end_date are "YYYY-MM" strings (native <input type="month"> format)
  const [career, setCareer] = useState([{ role: '', department: '', company: '', start_date: '', end_date: '' }]);

  // Step 2 — Can teach: array of { skill, example_project }
  const [canTeach, setCanTeach] = useState([]);

  // Step 3 — Wants to learn
  const [wantsToLearn, setWantsToLearn] = useState([]);

  function addCareerRow() {
    setCareer([...career, { role: '', department: '', company: '', start_date: '', end_date: '' }]);
  }

  function splitDate(s) {
    if (!s) return { year: null, month: null };
    const [y, m] = s.split('-');
    const year = parseInt(y);
    const month = parseInt(m);
    return {
      year: Number.isFinite(year) ? year : null,
      month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : null,
    };
  }

  function removeCareer(idx) {
    setCareer(career.filter((_, i) => i !== idx));
  }

  function applyProposed(proposed, source) {
    const next = new Set();
    if (proposed.location) { setLocation(proposed.location); next.add('location'); }
    if (proposed.bio) { setBio(proposed.bio); next.add('bio'); }
    const importedCareer = Array.isArray(proposed.career_history) && proposed.career_history.length
      ? proposed.career_history
      : [{ role_title: proposed.job_title || proposed.current_role || '', department: proposed.department || '' }];
    if (importedCareer[0].role_title || importedCareer[0].role || importedCareer[0].department) {
      setCareer(importedCareer.map(ch => ({
        role: ch.role || ch.role_title || proposed.job_title || proposed.current_role || '',
        department: ch.department || proposed.department || '',
        company: ch.company || '',
        description: ch.description || '',
        start_date: monthYearToPicker(ch.start_year, ch.start_month),
        end_date: monthYearToPicker(ch.end_year, ch.end_month),
      })));
      next.add('career');
    }
    if (Array.isArray(proposed.can_teach) && proposed.can_teach.length) {
      setCanTeach(proposed.can_teach);
      next.add('can_teach');
    }
    if (Array.isArray(proposed.wants_to_learn) && proposed.wants_to_learn.length) {
      setWantsToLearn(proposed.wants_to_learn);
      next.add('wants_to_learn');
    }
    setSuggested(next);
    setClassifierSource(source || '');
  }

  async function handleUpload(file) {
    if (!file || uploading) return;
    if (file.size > 10 * 1024 * 1024 || !/\.(pdf|docx)$/i.test(file.name)) {
      setError(t('onboarding.import.error'));
      return;
    }
    if (!aiConsent) {
      setError(t('onboarding.import.consentRequired'));
      return;
    }
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('kind', 'cv');
    try {
      const res = await api.post('/profile/ingest', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setDraftId(res.data.draft_id);
      applyProposed(res.data.proposed, res.data.classifier_source);
      setStep(1);
    } catch (e) {
      console.error('Profile import failed:', e.response?.status, e.response?.data?.error || e.message);
      setError(t(onboardingErrorKey(e, true)));
    } finally {
      setUploading(false);
    }
  }

  async function handleFinish() {
    if (saving) return;
    if (!name.trim()) { setError(t('onboarding.error.nameRequired')); setStep(1); return; }
    if (!career[0]?.role.trim() || !career[0]?.department.trim()) {
      setError(t('onboarding.error.workExperienceRequired'));
      setStep(1);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const validCareer = career
        .filter((c, index) => index === 0 || c.role.trim() || c.department.trim() || c.company.trim() || c.description?.trim() || c.start_date || c.end_date)
        .map(c => {
          const s = splitDate(c.start_date);
          const e = splitDate(c.end_date);
          return {
            role: c.role,
            department: c.department,
            company: c.company,
            description: c.description || '',
            start_year: s.year,
            start_month: s.month,
            end_year: e.year,
            end_month: e.month,
          };
        });
      const primaryCareer = validCareer[0];
      const accepted = {
        name, department: primaryCareer.department, current_role: primaryCareer.role, location, bio,
        career_history: validCareer,
        can_teach: canTeach,
        wants_to_learn: wantsToLearn,
      };
      if (draftId) {
        await api.post(`/profile/ingest/${draftId}/accept`, { accepted_json: accepted });
      }
      const res = await api.post('/users/me/onboarding', {
        name, seniority: user?.seniority ?? null,
        shadow_role_response: user?.shadow_role_response ?? null,
        department: primaryCareer.department, current_role: primaryCareer.role, location, bio,
        career: validCareer,
        can_teach: canTeach,
        wants_to_learn: wantsToLearn,
        program,
        cohort_year: cohortYear,
        persona,
        linkedin_url: linkedinUrl,
        linkedin_headline: null,
      });
      updateUser(res.data);
      navigate(returnTo || '/');
    } catch (e) {
      setError(t(onboardingErrorKey(e)));
    } finally {
      setSaving(false);
    }
  }

  function handleContinue() {
    if (step === 1 && (!career[0]?.role.trim() || !career[0]?.department.trim())) {
      setError(t('onboarding.error.workExperienceRequired'));
      return;
    }
    setError('');
    setStep(current => current + 1);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">M</span>
          <div>
            <h1 className="text-xl font-medium tracking-[-0.01em] text-foreground">{t('onboarding.header.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('onboarding.header.subtitle')}</p>
          </div>
        </div>
        <LanguageSwitcher />
      </div>

      <div>
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[0, 1, 2, 3].map(s => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1 shrink-0 ${step >= s ? 'text-foreground' : 'text-muted-foreground'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${step > s ? 'bg-primary border-primary text-white' : step === s ? 'border-primary text-foreground' : 'border-[var(--input)] text-muted-foreground'}`}>
                  {step > s ? <Check className="size-4" aria-hidden="true" /> : s + 1}
                </div>
                <span className="text-xs font-medium hidden md:block">
                  {s === 0 ? t('onboarding.steps.import') : s === 1 ? t('onboarding.steps.background') : s === 2 ? t('onboarding.steps.teach') : t('onboarding.steps.learn')}
                </span>
              </div>
              {s < 3 && <div className={`flex-1 min-w-4 h-0.5 ${step > s ? 'bg-primary' : 'bg-gray-200'}`} />}
            </React.Fragment>
          ))}
        </div>

        <div key={step} className="onboarding-step-content card p-6 space-y-6">
          {draftId && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">
            {t('onboarding.import.reviewNotice')}
          </p>}
          {step === 0 && (
            <>
              <div>
                <h2 className="text-xl font-medium tracking-[-0.01em] text-foreground mb-1">{t('onboarding.import.title')}</h2>
                <p className="text-muted-foreground text-sm">
                  {t('onboarding.import.desc')}
                </p>
              </div>
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={aiConsent} onChange={e => setAiConsent(e.target.checked)} className="mt-0.5" />
                <span>{t('onboarding.import.consent')}</span>
              </label>
              <label className={`flex min-h-32 flex-col items-center justify-center rounded-xl border border-[var(--input)] bg-muted/40 p-6 text-center ${aiConsent ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-60'}`}>
                <input
                  type="file"
                  accept=".docx,.pdf"
                  className="hidden"
                  disabled={uploading || !aiConsent}
                  onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); e.target.value = ''; }}
                />
                {uploading ? <p className="text-sm text-muted-foreground">{t('onboarding.import.reading')}</p> : (
                  <>
                    <span className="rounded-[var(--control-radius)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{t('onboarding.import.browse')}</span>
                    <p className="text-xs text-muted-foreground mt-1">{t('onboarding.import.hint')}</p>
                  </>
                )}
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <h2 className="text-xl font-medium tracking-[-0.01em] text-foreground mb-1">{t('onboarding.background.title')}</h2>
                <p className="text-muted-foreground text-sm">{t('onboarding.background.desc')}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label={t('onboarding.fields.fullName')} value={name} onChange={event => setName(event.target.value)} readOnly={nameLocked} maxLength={160} hint={nameLocked ? t('onboarding.fields.nameLocked') : undefined} />
                </div>
                <h3 className="sm:col-span-2 text-base font-medium pt-3">{t('onboarding.background.academic')}</h3>
                <div className="sm:col-span-2">
                  <label className="label">{t('onboarding.persona.title')}</label>
                  <div className="flex gap-2">
                    {['student', 'alumnus'].map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPersona(p)}
                        aria-pressed={persona === p}
                        className={`h-14 flex-1 rounded-lg border text-base font-semibold transition-colors ${persona === p ? 'border-transparent bg-primary text-primary-foreground' : 'border-[var(--border)] bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground'}`}
                      >
                        {t(`onboarding.persona.${p}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">{t('onboarding.fields.program')}</label>
                  <input className="input" value={program} onChange={e => setProgram(e.target.value)} placeholder={t('onboarding.fields.programPlaceholder')} />
                </div>
                <div>
                  <label className="label">{t('onboarding.fields.cohortYear')}</label>
                  <input className="input" type="number" min="1900" max="2100" value={cohortYear} onChange={e => setCohortYear(e.target.value)} placeholder="2024" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('onboarding.fields.location')}{suggested.has('location') && <SuggestedPill source={classifierSource} />} <span className="font-normal text-muted-foreground">{t('onboarding.fields.locationHint')}</span></label>
                  <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder={t('onboarding.fields.locationPlaceholder')} list="ment-location-suggestions" />
                  <datalist id="ment-location-suggestions">
                    {['New York','San Francisco','Toronto','Mexico City','London','Berlin','Paris','Madrid','Amsterdam','Stockholm','Dublin','Milan','Tokyo','Singapore','Sydney','Mumbai','Bangalore','Seoul','São Paulo','Dubai','Remote'].map(l => <option key={l} value={l} />)}
                  </datalist>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('onboarding.fields.bio')}{suggested.has('bio') && <SuggestedPill source={classifierSource} />} <span className="font-normal text-muted-foreground">{t('onboarding.fields.optional')}</span></label>
                  <textarea className="input resize-none" rows={2} value={bio} onChange={e => setBio(e.target.value)} placeholder={t('onboarding.fields.bioPlaceholder')} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('onboarding.fields.linkedin')}</label><input className="input" type="url" value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/..." />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="label mb-0">{t('onboarding.career.workExperience')}{suggested.has('career') && <SuggestedPill source={classifierSource} />}</label>
                  <button type="button" onClick={addCareerRow} className="text-sm text-primary hover:text-foreground font-medium">{t('onboarding.career.addRole')}</button>
                </div>
                <div className="space-y-3">
                  {career.map((c, i) => (
                    <div key={i} className="onboarding-career-entry rounded-lg p-3 space-y-2">
                      <CareerEntryFields value={c} required={i === 0} descriptionLabel={t('onboarding.career.projects')} onChange={next => setCareer(current => current.map((entry, index) => index === i ? next : entry))} />
                      {career.length > 1 && (
                        <button type="button" onClick={() => removeCareer(i)} className="text-xs text-red-400 hover:text-red-600">{t('onboarding.career.remove')}</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <>
              <div>
                <h2 className="text-xl font-medium tracking-[-0.01em] text-foreground mb-1">{t('onboarding.teach.title')}{suggested.has('can_teach') && <SuggestedPill source={classifierSource} />}</h2>
                <p className="text-muted-foreground text-sm">{t('onboarding.teach.desc')}</p>
              </div>
              <TeachSkillsEditor
                value={canTeach}
                onChange={setCanTeach}
                placeholder={t('onboarding.teach.placeholder')}
                ariaLabel={t('onboarding.teach.aria')}
              />
              {canTeach.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('onboarding.teach.empty')}</p>
              )}
            </>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <>
              <div>
                <h2 className="text-xl font-medium tracking-[-0.01em] text-foreground mb-1">{t('onboarding.learn.title')}{suggested.has('wants_to_learn') && <SuggestedPill source={classifierSource} />}</h2>
                <p className="text-muted-foreground text-sm">{t('onboarding.learn.desc')}</p>
              </div>
              <SkillTagInput
                value={wantsToLearn}
                onChange={setWantsToLearn}
                placeholder={t('onboarding.learn.placeholder')}
                ariaLabel={t('onboarding.learn.aria')}
              />
            </>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex justify-between pt-2">
            {step > 0 ? (
              <Button onClick={() => { setError(''); setStep(s => s - 1); }} variant="outline" disabled={saving || uploading}>{t('onboarding.nav.back')}</Button>
            ) : <div />}

            {step === 0 ? (
              <Button onClick={() => { setError(''); setStep(1); }} disabled={uploading}>{t('onboarding.nav.skip')}</Button>
            ) : step < 3 ? (
              <Button onClick={handleContinue}>
                {t('onboarding.nav.continue')}
              </Button>
            ) : (
              <Button onClick={handleFinish} disabled={saving}>
                {saving ? t('onboarding.nav.saving') : t('onboarding.nav.finish')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
