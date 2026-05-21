import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SkillTagInput from '../components/SkillTagInput.jsx';
import TeachSkillsEditor from '../components/TeachSkillsEditor.jsx';
import MonthYearPicker from '../components/MonthYearPicker.jsx';
import api from '../api/index.js';
import SuggestedPill from '../components/SuggestedPill.jsx';

const DEPARTMENTS = ['Engineering', 'Finance', 'Marketing', 'Operations', 'HR', 'Legal', 'Product', 'Design', 'Sales', 'Other'];

function monthYearToPicker(year, month) {
  if (!year) return '';
  const m = month && month >= 1 && month <= 12 ? month : 1;
  return `${year}-${String(m).padStart(2, '0')}`;
}

export default function Onboarding() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
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
      setError(e.response?.data?.error || 'Could not read that file. Try another format or skip to enter manually.');
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
      setError(e.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">M</span>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Set up your profile</h1>
          <p className="text-sm text-muted-foreground">A few steps so we can match you with mentors.</p>
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
                  {s === 0 ? 'Import' : s === 1 ? 'Background' : s === 2 ? 'Teach' : 'Learn'}
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
                <h2 className="text-xl font-semibold text-foreground mb-1">Import your profile</h2>
                <p className="text-gray-500 text-sm">
                  Upload a performance review or CV (.docx or .pdf). We pre-fill your profile — edit anything before saving.
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
                {uploading ? <p className="text-sm text-gray-500">Reading document…</p> : (
                  <>
                    <p className="text-sm font-medium text-gray-600">Drop a file or click to browse</p>
                    <p className="text-xs text-gray-400 mt-1">.docx, .pdf, .txt — max 10MB</p>
                  </>
                )}
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-1">Your background</h2>
                <p className="text-gray-500 text-sm">Tell us about your current role and experience. This helps us find relevant matches.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="label">Full name</label>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Department{suggested.has('department') && <SuggestedPill source={classifierSource} />}</label>
                  <select className="input" value={department} onChange={e => setDepartment(e.target.value)}>
                    <option value="">Select department</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Current role title{suggested.has('current_role') && <SuggestedPill source={classifierSource} />}</label>
                  <input className="input" value={currentRole} onChange={e => setCurrentRole(e.target.value)} placeholder="e.g. Senior Software Engineer" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Location{suggested.has('location') && <SuggestedPill source={classifierSource} />} <span className="font-normal text-gray-400">(city or "Remote")</span></label>
                  <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. London, San Francisco, Remote" list="ment-location-suggestions" />
                  <datalist id="ment-location-suggestions">
                    {['New York','San Francisco','Toronto','Mexico City','London','Berlin','Paris','Madrid','Amsterdam','Stockholm','Dublin','Milan','Tokyo','Singapore','Sydney','Mumbai','Bangalore','Seoul','São Paulo','Dubai','Remote'].map(l => <option key={l} value={l} />)}
                  </datalist>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Short bio{suggested.has('bio') && <SuggestedPill source={classifierSource} />} <span className="font-normal text-gray-400">(optional)</span></label>
                  <textarea className="input resize-none" rows={2} value={bio} onChange={e => setBio(e.target.value)} placeholder="A sentence about you, your interests, or what drives you." />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="label mb-0">Previous roles{suggested.has('career') && <SuggestedPill source={classifierSource} />} <span className="font-normal text-gray-400">(optional)</span></label>
                  <button type="button" onClick={addCareerRow} className="text-sm text-primary hover:text-foreground font-medium">+ Add role</button>
                </div>
                <div className="space-y-3">
                  {career.map((c, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input className="input text-sm" placeholder="Role title" value={c.role} onChange={e => updateCareer(i, 'role', e.target.value)} />
                        <select className="input text-sm" value={c.department} onChange={e => updateCareer(i, 'department', e.target.value)}>
                          <option value="">Department</option>
                          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <input className="input text-sm" placeholder="Company (optional)" value={c.company} onChange={e => updateCareer(i, 'company', e.target.value)} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-ink-tertiary mb-1">From</label>
                          <MonthYearPicker value={c.start_date} onChange={(v) => updateCareer(i, 'start_date', v)} />
                        </div>
                        <div>
                          <label className="block text-[10px] text-ink-tertiary mb-1">To <span className="text-ink-tertiary/70">(empty = present)</span></label>
                          <MonthYearPicker value={c.end_date} onChange={(v) => updateCareer(i, 'end_date', v)} />
                        </div>
                      </div>
                      {career.length > 1 && (
                        <button type="button" onClick={() => removeCareer(i)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
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
                <h2 className="text-xl font-semibold text-foreground mb-1">What you can teach{suggested.has('can_teach') && <SuggestedPill source={classifierSource} />}</h2>
                <p className="text-gray-500 text-sm">What topics could you help a colleague with based on your experience? For each skill, you can optionally add an example project that shows you've done it.</p>
              </div>
              <TeachSkillsEditor
                value={canTeach}
                onChange={setCanTeach}
                placeholder="e.g. React, system design, financial modeling…"
              />
              {canTeach.length === 0 && (
                <p className="text-xs text-gray-400">Add at least one skill to get better matches. You can always update this later.</p>
              )}
            </>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <>
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-1">What you want to learn{suggested.has('wants_to_learn') && <SuggestedPill source={classifierSource} />}</h2>
                <p className="text-gray-500 text-sm">What skills or areas do you want to develop in the next 6–12 months? Type a skill and press Enter.</p>
              </div>
              <SkillTagInput
                value={wantsToLearn}
                onChange={setWantsToLearn}
                placeholder="e.g. leadership, Python, SEO, project management…"
              />

              <div className="pt-2">
                <label className="label">
                  If you could spend a day shadowing someone in a completely different role, what would that role look like?
                  <span className="font-normal text-gray-400 ml-1">(optional)</span>
                </label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  value={shadowResponse}
                  onChange={e => setShadowResponse(e.target.value)}
                  placeholder="A few sentences is plenty. Only you will see this."
                />
              </div>
            </>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex justify-between pt-2">
            {step > 0 ? (
              <button onClick={() => setStep(s => s - 1)} className="btn-secondary">Back</button>
            ) : <div />}

            {step === 0 ? (
              <button onClick={() => setStep(1)} className="btn-primary">Skip — enter manually</button>
            ) : step < 3 ? (
              <button onClick={() => setStep(s => s + 1)} className="btn-primary">
                Continue
              </button>
            ) : (
              <button onClick={handleFinish} disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : 'Finish & see my matches'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
