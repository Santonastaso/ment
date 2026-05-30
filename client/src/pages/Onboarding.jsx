import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SkillTagInput from '../components/SkillTagInput.jsx';
import TeachSkillsEditor from '../components/TeachSkillsEditor.jsx';
import MonthYearPicker from '../components/MonthYearPicker.jsx';
import api from '../api/index.js';
import SuggestedPill from '../components/SuggestedPill.jsx';
import { useT } from '../i18n/index.jsx';

const DEPARTMENTS = ['Engineering', 'Finance', 'Marketing', 'Operations', 'HR', 'Legal', 'Product', 'Design', 'Sales', 'Other'];

function monthYearToPicker(year, month) {
  if (!year) return '';
  const m = month && month >= 1 && month <= 12 ? month : 1;
  return `${year}-${String(m).padStart(2, '0')}`;
}

export default function Onboarding() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [draftId, setDraftId] = useState(null);
  const [classifierSource, setClassifierSource] = useState('');
  const [suggested, setSuggested] = useState(() => new Set());

  // Step 1 — Background
  const [name, setName] = useState(user?.name || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [currentRole, setCurrentRole] = useState(user?.current_role || '');
  const [location, setLocation] = useState(user?.location || '');
  const [bio, setBio] = useState(user?.bio || '');
  // start_date / end_date are "YYYY-MM" strings (native <input type="month"> format)
  const [career, setCareer] = useState([{ role: '', department: '', company: '', start_date: '', end_date: '' }]);

  // Step 2 — Can teach: array of { skill, example_project }
  const [canTeach, setCanTeach] = useState([]);

  // Step 3 — Wants to learn + day-shadow open question
  const [wantsToLearn, setWantsToLearn] = useState([]);
  const [shadowResponse, setShadowResponse] = useState(user?.shadow_role_response || '');

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

  function updateCareer(idx, field, value) {
    setCareer(career.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  function removeCareer(idx) {
    setCareer(career.filter((_, i) => i !== idx));
  }

  function applyProposed(proposed, source) {
    const next = new Set();
    if (proposed.department) { setDepartment(proposed.department); next.add('department'); }
    if (proposed.current_role) { setCurrentRole(proposed.current_role); next.add('current_role'); }
    if (proposed.location) { setLocation(proposed.location); next.add('location'); }
    if (proposed.bio) { setBio(proposed.bio); next.add('bio'); }
    if (Array.isArray(proposed.career_history) && proposed.career_history.length) {
      setCareer(proposed.career_history.map(ch => ({
        role: ch.role || '',
        department: ch.department || '',
        company: ch.company || '',
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
    if (!file) return;
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('kind', 'performance_review');
    try {
      const res = await api.post('/profile/ingest', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setDraftId(res.data.draft_id);
      applyProposed(res.data.proposed, res.data.classifier_source);
      setStep(1);
    } catch (e) {
      setError(e.response?.data?.error || t('onboarding.import.error'));
    } finally {
      setUploading(false);
    }
  }

  async function handleFinish() {
    setSaving(true);
    setError('');
    try {
      const validCareer = career
        .filter(c => c.role.trim() && c.department.trim())
        .map(c => {
          const s = splitDate(c.start_date);
          const e = splitDate(c.end_date);
          return {
            role: c.role,
            department: c.department,
            company: c.company,
            start_year: s.year,
            start_month: s.month,
            end_year: e.year,
            end_month: e.month,
          };
        });
      const accepted = {
        name, department, current_role: currentRole, location, bio,
        career_history: validCareer,
        can_teach: canTeach,
        wants_to_learn: wantsToLearn,
      };
      if (draftId) {
        await api.post(`/profile/ingest/${draftId}/accept`, { accepted_json: accepted });
      }
      const res = await api.post('/users/me/onboarding', {
        name, department, current_role: currentRole, location, bio,
        shadow_role_response: shadowResponse,
        career: validCareer,
        can_teach: canTeach,
        wants_to_learn: wantsToLearn
      });
      updateUser(res.data);
      navigate('/');
    } catch (e) {
      setError(e.response?.data?.error || t('onboarding.error.generic'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">M</span>
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('onboarding.header.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('onboarding.header.subtitle')}</p>
        </div>
      </div>

      <div>
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[0, 1, 2, 3].map(s => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1 shrink-0 ${step >= s ? 'text-foreground' : 'text-gray-400'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${step > s ? 'bg-primary border-primary text-white' : step === s ? 'border-primary text-foreground' : 'border-gray-300 text-gray-400'}`}>
                  {step > s ? '✓' : s + 1}
                </div>
                <span className="text-xs font-medium hidden md:block">
                  {s === 0 ? t('onboarding.steps.import') : s === 1 ? t('onboarding.steps.background') : s === 2 ? t('onboarding.steps.teach') : t('onboarding.steps.learn')}
                </span>
              </div>
              {s < 3 && <div className={`flex-1 min-w-4 h-0.5 ${step > s ? 'bg-primary' : 'bg-gray-200'}`} />}
            </React.Fragment>
          ))}
        </div>

        <div className="card p-6 space-y-6">
          {step === 0 && (
            <>
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-1">{t('onboarding.import.title')}</h2>
                <p className="text-gray-500 text-sm">
                  {t('onboarding.import.desc')}
                </p>
              </div>
              <label className="block border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-primary-light hover:bg-gray-50">
                <input
                  type="file"
                  accept=".docx,.pdf,.txt"
                  className="hidden"
                  disabled={uploading}
                  onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); e.target.value = ''; }}
                />
                {uploading ? <p className="text-sm text-gray-500">{t('onboarding.import.reading')}</p> : (
                  <>
                    <p className="text-sm font-medium text-gray-600">{t('onboarding.import.drop')}</p>
                    <p className="text-xs text-gray-400 mt-1">{t('onboarding.import.hint')}</p>
                  </>
                )}
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-1">{t('onboarding.background.title')}</h2>
                <p className="text-gray-500 text-sm">{t('onboarding.background.desc')}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="label">{t('onboarding.fields.fullName')}</label>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={t('onboarding.fields.fullNamePlaceholder')} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('onboarding.fields.department')}{suggested.has('department') && <SuggestedPill source={classifierSource} />}</label>
                  <select className="input" value={department} onChange={e => setDepartment(e.target.value)}>
                    <option value="">{t('onboarding.fields.selectDepartment')}</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('onboarding.fields.currentRole')}{suggested.has('current_role') && <SuggestedPill source={classifierSource} />}</label>
                  <input className="input" value={currentRole} onChange={e => setCurrentRole(e.target.value)} placeholder={t('onboarding.fields.currentRolePlaceholder')} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('onboarding.fields.location')}{suggested.has('location') && <SuggestedPill source={classifierSource} />} <span className="font-normal text-gray-400">{t('onboarding.fields.locationHint')}</span></label>
                  <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder={t('onboarding.fields.locationPlaceholder')} list="ment-location-suggestions" />
                  <datalist id="ment-location-suggestions">
                    {['New York','San Francisco','Toronto','Mexico City','London','Berlin','Paris','Madrid','Amsterdam','Stockholm','Dublin','Milan','Tokyo','Singapore','Sydney','Mumbai','Bangalore','Seoul','São Paulo','Dubai','Remote'].map(l => <option key={l} value={l} />)}
                  </datalist>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('onboarding.fields.bio')}{suggested.has('bio') && <SuggestedPill source={classifierSource} />} <span className="font-normal text-gray-400">{t('onboarding.fields.optional')}</span></label>
                  <textarea className="input resize-none" rows={2} value={bio} onChange={e => setBio(e.target.value)} placeholder={t('onboarding.fields.bioPlaceholder')} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="label mb-0">{t('onboarding.career.previousRoles')}{suggested.has('career') && <SuggestedPill source={classifierSource} />} <span className="font-normal text-gray-400">{t('onboarding.fields.optional')}</span></label>
                  <button type="button" onClick={addCareerRow} className="text-sm text-primary hover:text-foreground font-medium">{t('onboarding.career.addRole')}</button>
                </div>
                <div className="space-y-3">
                  {career.map((c, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input className="input text-sm" placeholder={t('onboarding.career.roleTitle')} value={c.role} onChange={e => updateCareer(i, 'role', e.target.value)} />
                        <select className="input text-sm" value={c.department} onChange={e => updateCareer(i, 'department', e.target.value)}>
                          <option value="">{t('onboarding.fields.department')}</option>
                          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <input className="input text-sm" placeholder={t('onboarding.career.companyOptional')} value={c.company} onChange={e => updateCareer(i, 'company', e.target.value)} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-ink-tertiary mb-1">{t('onboarding.career.from')}</label>
                          <MonthYearPicker value={c.start_date} onChange={(v) => updateCareer(i, 'start_date', v)} />
                        </div>
                        <div>
                          <label className="block text-[10px] text-ink-tertiary mb-1">{t('onboarding.career.to')} <span className="text-ink-tertiary/70">{t('onboarding.career.toHint')}</span></label>
                          <MonthYearPicker value={c.end_date} onChange={(v) => updateCareer(i, 'end_date', v)} />
                        </div>
                      </div>
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
                <h2 className="text-xl font-semibold text-foreground mb-1">{t('onboarding.teach.title')}{suggested.has('can_teach') && <SuggestedPill source={classifierSource} />}</h2>
                <p className="text-gray-500 text-sm">{t('onboarding.teach.desc')}</p>
              </div>
              <TeachSkillsEditor
                value={canTeach}
                onChange={setCanTeach}
                placeholder={t('onboarding.teach.placeholder')}
                ariaLabel={t('onboarding.teach.aria')}
              />
              {canTeach.length === 0 && (
                <p className="text-xs text-gray-400">{t('onboarding.teach.empty')}</p>
              )}
            </>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <>
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-1">{t('onboarding.learn.title')}{suggested.has('wants_to_learn') && <SuggestedPill source={classifierSource} />}</h2>
                <p className="text-gray-500 text-sm">{t('onboarding.learn.desc')}</p>
              </div>
              <SkillTagInput
                value={wantsToLearn}
                onChange={setWantsToLearn}
                placeholder={t('onboarding.learn.placeholder')}
                ariaLabel={t('onboarding.learn.aria')}
              />

              <div className="pt-2">
                <label className="label">
                  {t('onboarding.learn.shadowLabel')}
                  <span className="font-normal text-gray-400 ml-1">{t('onboarding.fields.optional')}</span>
                </label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  value={shadowResponse}
                  onChange={e => setShadowResponse(e.target.value)}
                  placeholder={t('onboarding.learn.shadowPlaceholder')}
                />
              </div>
            </>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex justify-between pt-2">
            {step > 0 ? (
              <button onClick={() => setStep(s => s - 1)} className="btn-secondary">{t('onboarding.nav.back')}</button>
            ) : <div />}

            {step === 0 ? (
              <button onClick={() => setStep(1)} className="btn-primary">{t('onboarding.nav.skip')}</button>
            ) : step < 3 ? (
              <button onClick={() => setStep(s => s + 1)} className="btn-primary">
                {t('onboarding.nav.continue')}
              </button>
            ) : (
              <button onClick={handleFinish} disabled={saving} className="btn-primary">
                {saving ? t('onboarding.nav.saving') : t('onboarding.nav.finish')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
