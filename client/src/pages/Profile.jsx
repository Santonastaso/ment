import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SkillTagInput from '../components/SkillTagInput.jsx';
import TeachSkillsEditor from '../components/TeachSkillsEditor.jsx';
import BadgeDisplay from '../components/BadgeDisplay.jsx';
import SessionRequestModal from '../components/SessionRequestModal.jsx';
import SkillLandscape from '../components/SkillLandscape.jsx';
import PastMeetings from '../components/PastMeetings.jsx';
import MonthYearPicker from '../components/MonthYearPicker.jsx';
import ReflectionLog from '../components/ReflectionLog.jsx';
import api from '../api/index.js';

const DEPARTMENTS = ['Engineering', 'Finance', 'Marketing', 'Operations', 'HR', 'Legal', 'Product', 'Design', 'Sales', 'Other'];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Convert (year, month) to "YYYY-MM" string that <input type="month"> expects.
function ymToInput(year, month) {
  if (!year) return '';
  const m = month && month >= 1 && month <= 12 ? String(month).padStart(2, '0') : '01';
  return `${year}-${m}`;
}

// Parse "YYYY-MM" back into { year, month } pair (null-safe).
function inputToYM(value) {
  if (!value) return { year: null, month: null };
  const [y, m] = value.split('-');
  const year = parseInt(y);
  const month = parseInt(m);
  return {
    year: Number.isFinite(year) ? year : null,
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : null,
  };
}

// Render a "Jun 2018 – Jul 2022" / "2018 – present" period label, handling
// year-only legacy data gracefully.
function formatPeriod(startY, startM, endY, endM) {
  const fmt = (y, m) => {
    if (!y) return '';
    if (m && m >= 1 && m <= 12) return `${MONTH_NAMES[m - 1]} ${y}`;
    return String(y);
  };
  const start = fmt(startY, startM);
  const end = endY ? fmt(endY, endM) : 'present';
  if (!start && (!endY)) return '';
  if (!start) return end;
  return `${start} – ${end}`;
}

export default function Profile() {
  const { id } = useParams();
  const { user: currentUser, updateUser } = useAuth();
  const navigate = useNavigate();

  const isOwnProfile = !id || parseInt(id) === currentUser?.id;
  const targetId = isOwnProfile ? currentUser?.id : parseInt(id);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState('');
  const [showSkillEditor, setShowSkillEditor] = useState(false);

  // Edit form state
  const [form, setForm] = useState({});
  const [wantsToLearn, setWantsToLearn] = useState([]);
  // Career form uses `start_date` / `end_date` as "YYYY-MM" strings (matching
  // the native <input type="month"> value); we split into year + month on save.
  const [newCareer, setNewCareer] = useState({ role: '', department: '', company: '', description: '', start_date: '', end_date: '' });
  const [showAddCareer, setShowAddCareer] = useState(false);
  const [editingCareerId, setEditingCareerId] = useState(null);
  const [editCareerDraft, setEditCareerDraft] = useState(null);
  const [editingShadow, setEditingShadow] = useState(false);
  const [shadowDraft, setShadowDraft] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await api.get(isOwnProfile ? '/users/me' : `/users/${targetId}`);
        setProfile(res.data);
        if (isOwnProfile) {
          setForm({
            name: res.data.name,
            department: res.data.department,
            current_role: res.data.current_role,
            location: res.data.location || '',
            bio: res.data.bio || ''
          });
          setWantsToLearn(res.data.skills?.filter(s => s.type === 'wants_to_learn').map(s => s.skill) || []);
          setShadowDraft(res.data.shadow_role_response || '');
        }
      } catch {
        navigate('/');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [targetId, isOwnProfile]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleSaveProfile() {
    setSaving(true);
    try {
      const res = await api.put('/users/me', form);
      setProfile(prev => ({ ...prev, ...res.data }));
      updateUser(res.data);
      setEditing(false);
      showToast('Profile updated');
    } finally {
      setSaving(false);
    }
  }

  async function refreshProfile() {
    const res = await api.get('/users/me');
    setProfile(res.data);
  }

  async function handleDeleteSkillFromBubble(entry) {
    if (!entry?.id) return;
    if (!confirm(`Remove "${entry.skill}" from your skill landscape?`)) return;
    try {
      await api.delete(`/users/me/skills/${entry.id}`);
      await refreshProfile();
      showToast(`Removed “${entry.skill}”`);
    } catch {
      showToast('Could not remove that skill — try again.');
    }
  }

  async function handleTeachSkillsChange(next) {
    const prev = (profile?.skills || []).filter(s => s.type === 'can_teach');

    // Removals: prev had id but next doesn't
    for (const p of prev) {
      if (!next.some(n => n.id === p.id)) {
        await api.delete(`/users/me/skills/${p.id}`);
      }
    }
    // Additions: entries without an id
    for (const n of next) {
      if (!n.id) {
        await api.post('/users/me/skills', { skill: n.skill, type: 'can_teach', example_project: n.example_project || '' });
      }
    }
    // Example-project edits on existing skills
    for (const n of next) {
      if (n.id) {
        const old = prev.find(p => p.id === n.id);
        if (old && (old.example_project || '') !== (n.example_project || '')) {
          await api.put(`/users/me/skills/${n.id}`, { example_project: n.example_project || '' });
        }
      }
    }
    await refreshProfile();
    showToast('Skills updated');
  }

  async function handleWantsToLearnChange(next) {
    const prev = (profile?.skills || []).filter(s => s.type === 'wants_to_learn');
    const prevNames = prev.map(s => s.skill.toLowerCase());
    const nextNames = next.map(s => s.toLowerCase());

    for (const p of prev) {
      if (!nextNames.includes(p.skill.toLowerCase())) {
        await api.delete(`/users/me/skills/${p.id}`);
      }
    }
    for (const skill of next) {
      if (!prevNames.includes(skill.toLowerCase())) {
        await api.post('/users/me/skills', { skill, type: 'wants_to_learn' });
      }
    }
    await refreshProfile();
    showToast('Skills updated');
  }

  async function handleSaveShadow() {
    // Send only the field being changed — the server now does partial updates.
    await api.put('/users/me', { shadow_role_response: shadowDraft });
    await refreshProfile();
    setEditingShadow(false);
    showToast('Saved');
  }

  async function handleAddCareer() {
    if (!newCareer.role.trim() || !newCareer.department.trim()) return;
    const start = inputToYM(newCareer.start_date);
    const end = inputToYM(newCareer.end_date);
    const payload = {
      role: newCareer.role,
      department: newCareer.department,
      company: newCareer.company,
      description: newCareer.description,
      start_year: start.year,
      start_month: start.month,
      end_year: end.year,
      end_month: end.month,
    };
    const res = await api.post('/users/me/career', payload);
    setProfile(prev => ({ ...prev, career: [res.data, ...(prev.career || [])] }));
    setNewCareer({ role: '', department: '', company: '', description: '', start_date: '', end_date: '' });
    setShowAddCareer(false);
    showToast('Career entry added');
  }

  async function handleDeleteCareer(id) {
    await api.delete(`/users/me/career/${id}`);
    setProfile(prev => ({ ...prev, career: prev.career.filter(c => c.id !== id) }));
    showToast('Entry removed');
  }

  function startEditCareer(entry) {
    setEditingCareerId(entry.id);
    setEditCareerDraft({
      role: entry.role || '',
      department: entry.department || '',
      company: entry.company || '',
      description: entry.description || '',
      start_date: ymToInput(entry.start_year, entry.start_month),
      end_date: ymToInput(entry.end_year, entry.end_month),
    });
  }

  function cancelEditCareer() {
    setEditingCareerId(null);
    setEditCareerDraft(null);
  }

  async function handleSaveEditedCareer() {
    if (!editingCareerId || !editCareerDraft) return;
    if (!editCareerDraft.role.trim() || !editCareerDraft.department.trim()) return;
    const start = inputToYM(editCareerDraft.start_date);
    const end = inputToYM(editCareerDraft.end_date);
    const payload = {
      role: editCareerDraft.role,
      department: editCareerDraft.department,
      company: editCareerDraft.company,
      description: editCareerDraft.description,
      start_year: start.year,
      start_month: start.month,
      end_year: end.year,
      end_month: end.month,
    };
    const res = await api.put(`/users/me/career/${editingCareerId}`, payload);
    setProfile(prev => ({
      ...prev,
      career: prev.career.map(c => c.id === editingCareerId ? res.data : c),
    }));
    cancelEditCareer();
    showToast('Entry updated');
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="card p-6 h-32 bg-gray-100" />
        <div className="card p-6 h-48 bg-gray-100" />
      </div>
    );
  }

  if (!profile) return null;

  const skills = profile.skills || [];
  const teachSkills = skills.filter(s => s.type === 'can_teach');
  const learnSkills = skills.filter(s => s.type === 'wants_to_learn');
  const teachEditorValue = teachSkills.map(s => ({ id: s.id, skill: s.skill, example_project: s.example_project || '' }));

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-navy text-white px-5 py-2.5 rounded-full text-sm font-medium shadow-lg z-50 transition-all">
          {toast}
        </div>
      )}

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-navy-light flex items-center justify-center text-white text-2xl font-bold">
              {profile.name?.charAt(0)}
            </div>
            <div>
              {editing ? (
                <input className="input text-xl font-bold mb-1" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
              ) : (
                <h1 className="text-2xl font-bold text-navy">{profile.name}</h1>
              )}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {editing ? (
                  <>
                    <input className="input text-sm w-48" placeholder="Role title" value={form.current_role} onChange={e => setForm(f => ({...f, current_role: e.target.value}))} />
                    <select className="input text-sm w-40" value={form.department} onChange={e => setForm(f => ({...f, department: e.target.value}))}>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input className="input text-sm w-40" placeholder="Location" value={form.location} onChange={e => setForm(f => ({...f, location: e.target.value}))} />
                  </>
                ) : (
                  <>
                    <span className="text-gray-600 text-sm">{profile.current_role}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-600 text-sm">{profile.department}</span>
                    {profile.location && (<>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600 text-sm inline-flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        {profile.location}
                      </span>
                    </>)}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {isOwnProfile ? (
              editing ? (
                <>
                  <button onClick={() => setEditing(false)} className="btn-ghost text-sm">Cancel</button>
                  <button onClick={handleSaveProfile} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save'}</button>
                </>
              ) : (
                <button onClick={() => setEditing(true)} className="btn-secondary text-sm">Edit profile</button>
              )
            ) : (
              <button onClick={() => setShowModal(true)} className="btn-primary text-sm">Request a session</button>
            )}
          </div>
        </div>

        {/* Bio */}
        <div className="mt-4">
          {editing ? (
            <textarea
              className="input resize-none text-sm"
              rows={2}
              value={form.bio}
              onChange={e => setForm(f => ({...f, bio: e.target.value}))}
              placeholder="A short bio…"
            />
          ) : profile.bio ? (
            <p className="text-gray-600 text-sm">{profile.bio}</p>
          ) : null}
        </div>
      </div>

      {/* Skill landscape — visual progress overview */}
      <div className="card p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="section-title mb-1">Your skill landscape</h2>
            <p className="text-xs text-gray-500">
              {isOwnProfile
                ? 'A snapshot of what you share and where you’re growing. Sessions push the bars forward.'
                : `An overview of where ${profile.name?.split(' ')[0]} can help and where they’re growing.`}
            </p>
          </div>
          {isOwnProfile && (
            <button
              onClick={() => setShowSkillEditor(s => !s)}
              className="text-sm text-navy-light hover:text-navy font-medium whitespace-nowrap"
            >
              {showSkillEditor ? 'Done editing' : 'Edit skills'}
            </button>
          )}
        </div>

        <SkillLandscape
          skillProgress={profile.skillProgress || []}
          isOwnProfile={isOwnProfile}
          firstName={profile.name?.split(' ')[0]}
          onDeleteSkill={handleDeleteSkillFromBubble}
        />

        {/* Expertise signature */}
        {profile.expertiseSignature?.length > 0 && (
          <div className="bg-navy/5 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-navy mb-2">What colleagues seek {isOwnProfile ? 'you' : profile.name?.split(' ')[0]} out for</h3>
            <div className="flex flex-wrap gap-2">
              {profile.expertiseSignature.map(skill => (
                <span key={skill} className="bg-navy text-white rounded-full px-3 py-0.5 text-sm font-medium">{skill}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Skill editors — own profile, on demand */}
      {isOwnProfile && showSkillEditor && (
        <div className="card p-6 space-y-5">
          <h2 className="section-title mb-0">Manage your skills</h2>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">What you can teach</h3>
            <TeachSkillsEditor
              value={teachEditorValue}
              onChange={handleTeachSkillsChange}
              placeholder="Type a skill and press Enter"
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">What you want to learn</h3>
            <SkillTagInput
              value={wantsToLearn}
              onChange={async (v) => {
                setWantsToLearn(v);
                await handleWantsToLearnChange(v);
              }}
              placeholder="Type a skill and press Enter"
            />
          </div>
        </div>
      )}

      {/* Career history */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title mb-0">Career history</h2>
          {isOwnProfile && (
            <button onClick={() => setShowAddCareer(!showAddCareer)} className="text-sm text-navy-light hover:text-navy font-medium">
              {showAddCareer ? 'Cancel' : '+ Add entry'}
            </button>
          )}
        </div>

        {isOwnProfile && showAddCareer && (
          <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input className="input text-sm" placeholder="Role title *" value={newCareer.role} onChange={e => setNewCareer(c => ({...c, role: e.target.value}))} />
              <select className="input text-sm" value={newCareer.department} onChange={e => setNewCareer(c => ({...c, department: e.target.value}))}>
                <option value="">Department *</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input className="input text-sm" placeholder="Company" value={newCareer.company} onChange={e => setNewCareer(c => ({...c, company: e.target.value}))} />
              <div>
                <label className="block text-[10px] text-ink-tertiary mb-1">From</label>
                <MonthYearPicker
                  value={newCareer.start_date}
                  onChange={(v) => setNewCareer(c => ({...c, start_date: v}))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-ink-tertiary mb-1">To <span className="text-ink-tertiary/70">(leave empty if this is your current role)</span></label>
                <MonthYearPicker
                  value={newCareer.end_date}
                  onChange={(v) => setNewCareer(c => ({...c, end_date: v}))}
                />
              </div>
            </div>
            <textarea
              className="input text-sm resize-none"
              rows={2}
              placeholder="What did you do in this role? (optional)"
              value={newCareer.description}
              onChange={e => setNewCareer(c => ({...c, description: e.target.value}))}
            />
            <button onClick={handleAddCareer} className="btn-primary text-sm">Add</button>
          </div>
        )}

        {profile.career?.length > 0 ? (
          <div className="space-y-3">
            {profile.career.map(entry => (
              editingCareerId === entry.id ? (
                <div key={entry.id} className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className="input text-sm"
                      placeholder="Role title *"
                      value={editCareerDraft.role}
                      onChange={e => setEditCareerDraft(d => ({...d, role: e.target.value}))}
                    />
                    <select
                      className="input text-sm"
                      value={editCareerDraft.department}
                      onChange={e => setEditCareerDraft(d => ({...d, department: e.target.value}))}
                    >
                      <option value="">Department *</option>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input
                      className="input text-sm"
                      placeholder="Company"
                      value={editCareerDraft.company}
                      onChange={e => setEditCareerDraft(d => ({...d, company: e.target.value}))}
                    />
                    <div />
                    <div>
                      <label className="block text-[10px] text-ink-tertiary mb-1">From</label>
                      <MonthYearPicker
                        value={editCareerDraft.start_date}
                        onChange={(v) => setEditCareerDraft(d => ({...d, start_date: v}))}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-ink-tertiary mb-1">To <span className="text-ink-tertiary/70">(leave empty if this is your current role)</span></label>
                      <MonthYearPicker
                        value={editCareerDraft.end_date}
                        onChange={(v) => setEditCareerDraft(d => ({...d, end_date: v}))}
                      />
                    </div>
                  </div>
                  <textarea
                    className="input text-sm resize-none"
                    rows={2}
                    placeholder="What did you do in this role? (optional)"
                    value={editCareerDraft.description}
                    onChange={e => setEditCareerDraft(d => ({...d, description: e.target.value}))}
                  />
                  <div className="flex gap-2">
                    <button onClick={handleSaveEditedCareer} className="btn-primary text-sm">Save</button>
                    <button onClick={cancelEditCareer} className="btn-ghost text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={entry.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-navy">{entry.role}</p>
                    <p className="text-xs text-gray-500">
                      {entry.department}
                      {entry.company && ` · ${entry.company}`}
                      {(entry.start_year || entry.end_year) && ` · ${formatPeriod(entry.start_year, entry.start_month, entry.end_year, entry.end_month)}`}
                    </p>
                    {entry.description && (
                      <p className="text-xs text-gray-600 mt-1">{entry.description}</p>
                    )}
                  </div>
                  {isOwnProfile && (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button onClick={() => startEditCareer(entry)} className="text-gray-400 hover:text-navy text-sm">
                        Edit
                      </button>
                      <button onClick={() => handleDeleteCareer(entry.id)} className="text-gray-400 hover:text-red-500 text-sm">
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">{isOwnProfile ? 'Add your previous roles to improve your matches.' : 'No career history listed.'}</p>
        )}
      </div>

      {/* Past meetings — completed sessions, your historical log */}
      {isOwnProfile && (
        <div className="card p-6">
          <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="section-title mb-0">Past meetings</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Completed mentoring sessions, both as mentor and mentee. Active sessions live on your <Link to="/" className="text-navy-light hover:underline">dashboard</Link>.
              </p>
            </div>
          </div>
          <PastMeetings currentUserId={currentUser?.id} />
        </div>
      )}

      {/* Reflection log — own profile only, fully private */}
      {isOwnProfile && (
        <div className="card p-6">
          <div className="mb-4">
            <h2 className="section-title mb-0">Reflection log</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              A short weekly check-in. Answers are read by an AI and matched to the
              {' '}<a href="https://esco.ec.europa.eu/en" target="_blank" rel="noreferrer" className="text-navy-light hover:underline">ESCO taxonomy</a>{' '}
              of skills, then surfaced as one-click suggestions for your landscape. Only you can see this.
            </p>
          </div>
          <ReflectionLog onSkillsApplied={refreshProfile} />
        </div>
      )}

      {/* Day-shadow reflection — private to owner */}
      {isOwnProfile && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="section-title mb-0">A role you'd love to shadow</h2>
            {!editingShadow && (
              <button onClick={() => setEditingShadow(true)} className="text-sm text-navy-light hover:text-navy font-medium">
                {profile.shadow_role_response ? 'Edit' : '+ Add'}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">Only you can see this. We use it to surface unexpected matches over time.</p>
          {editingShadow ? (
            <div className="space-y-2">
              <textarea
                className="input resize-none text-sm"
                rows={3}
                value={shadowDraft}
                onChange={e => setShadowDraft(e.target.value)}
                placeholder="If you could spend a day shadowing someone in a completely different role, what would that role look like?"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveShadow} className="btn-primary text-sm">Save</button>
                <button onClick={() => { setEditingShadow(false); setShadowDraft(profile.shadow_role_response || ''); }} className="btn-ghost text-sm">Cancel</button>
              </div>
            </div>
          ) : profile.shadow_role_response ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{profile.shadow_role_response}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">No answer yet — even a sentence helps.</p>
          )}
        </div>
      )}

      {/* Badges */}
      {profile.badges?.length > 0 && (
        <div className="card p-6">
          <h2 className="section-title">Recognition</h2>
          <BadgeDisplay badges={profile.badges} />
        </div>
      )}

      {showModal && (
        <SessionRequestModal
          mentor={profile}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); showToast('Session request sent!'); }}
        />
      )}
    </div>
  );
}
