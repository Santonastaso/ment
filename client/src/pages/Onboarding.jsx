import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SkillTagInput from '../components/SkillTagInput.jsx';
import TeachSkillsEditor from '../components/TeachSkillsEditor.jsx';
import api from '../api/index.js';

const DEPARTMENTS = ['Engineering', 'Finance', 'Marketing', 'Operations', 'HR', 'Legal', 'Product', 'Design', 'Sales', 'Other'];

export default function Onboarding() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1 — Background
  const [name, setName] = useState(user?.name || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [currentRole, setCurrentRole] = useState(user?.current_role || '');
  const [location, setLocation] = useState(user?.location || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [career, setCareer] = useState([{ role: '', department: '', company: '', start_year: '', end_year: '' }]);

  // Step 2 — Can teach: array of { skill, example_project }
  const [canTeach, setCanTeach] = useState([]);

  // Step 3 — Wants to learn + day-shadow open question
  const [wantsToLearn, setWantsToLearn] = useState([]);
  const [shadowResponse, setShadowResponse] = useState(user?.shadow_role_response || '');

  function addCareerRow() {
    setCareer([...career, { role: '', department: '', company: '', start_year: '', end_year: '' }]);
  }

  function updateCareer(idx, field, value) {
    setCareer(career.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  function removeCareer(idx) {
    setCareer(career.filter((_, i) => i !== idx));
  }

  async function handleFinish() {
    setSaving(true);
    setError('');
    try {
      const validCareer = career.filter(c => c.role.trim() && c.department.trim());
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
    <div className="min-h-screen bg-gray-50">
      <div className="bg-navy py-6">
        <div className="max-w-2xl mx-auto px-4">
          <h1 className="text-white font-bold text-2xl">MENT</h1>
          <p className="text-blue-200 text-sm mt-1">Set up your profile to get matched</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Progress */}
        <div className="flex items-center gap-3 mb-8">
          {[1, 2, 3].map(s => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-2 ${step >= s ? 'text-navy' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 ${step > s ? 'bg-navy border-navy text-white' : step === s ? 'border-navy text-navy' : 'border-gray-300 text-gray-400'}`}>
                  {step > s ? '✓' : s}
                </div>
                <span className="text-sm font-medium hidden sm:block">
                  {s === 1 ? 'Your background' : s === 2 ? 'What you can teach' : 'What you want to learn'}
                </span>
              </div>
              {s < 3 && <div className={`flex-1 h-0.5 ${step > s ? 'bg-navy' : 'bg-gray-200'}`} />}
            </React.Fragment>
          ))}
        </div>

        <div className="card p-6 space-y-6">
          {/* STEP 1 */}
          {step === 1 && (
            <>
              <div>
                <h2 className="text-xl font-semibold text-navy mb-1">Your background</h2>
                <p className="text-gray-500 text-sm">Tell us about your current role and experience. This helps us find relevant matches.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="label">Full name</label>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Department</label>
                  <select className="input" value={department} onChange={e => setDepartment(e.target.value)}>
                    <option value="">Select department</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Current role title</label>
                  <input className="input" value={currentRole} onChange={e => setCurrentRole(e.target.value)} placeholder="e.g. Senior Software Engineer" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Location <span className="font-normal text-gray-400">(city or "Remote")</span></label>
                  <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. London, San Francisco, Remote" list="ment-location-suggestions" />
                  <datalist id="ment-location-suggestions">
                    {['New York','San Francisco','Toronto','Mexico City','London','Berlin','Paris','Madrid','Amsterdam','Stockholm','Dublin','Milan','Tokyo','Singapore','Sydney','Mumbai','Bangalore','Seoul','São Paulo','Dubai','Remote'].map(l => <option key={l} value={l} />)}
                  </datalist>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Short bio <span className="font-normal text-gray-400">(optional)</span></label>
                  <textarea className="input resize-none" rows={2} value={bio} onChange={e => setBio(e.target.value)} placeholder="A sentence about you, your interests, or what drives you." />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="label mb-0">Previous roles <span className="font-normal text-gray-400">(optional)</span></label>
                  <button type="button" onClick={addCareerRow} className="text-sm text-navy-light hover:text-navy font-medium">+ Add role</button>
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
                        <div className="flex gap-2">
                          <input className="input text-sm" type="number" placeholder="From" min="1990" max="2030" value={c.start_year} onChange={e => updateCareer(i, 'start_year', e.target.value)} />
                          <input className="input text-sm" type="number" placeholder="To" min="1990" max="2030" value={c.end_year} onChange={e => updateCareer(i, 'end_year', e.target.value)} />
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
                <h2 className="text-xl font-semibold text-navy mb-1">What you can teach</h2>
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
                <h2 className="text-xl font-semibold text-navy mb-1">What you want to learn</h2>
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
            {step > 1 ? (
              <button onClick={() => setStep(s => s - 1)} className="btn-secondary">Back</button>
            ) : <div />}

            {step < 3 ? (
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
