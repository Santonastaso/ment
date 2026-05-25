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
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody, SurfaceHeader } from '../components/Surface.jsx';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';
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

  const isOwnProfile = !id || (currentUser?.id != null && id === currentUser.id);
  const targetId = isOwnProfile ? currentUser?.id : id;

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
    setEditing(false);
    setShowSkillEditor(false);
    setShowAddCareer(false);
    setEditingCareerId(null);
    setEditCareerDraft(null);
    setEditingShadow(false);
    setShowModal(false);
  }, [targetId]);

  useEffect(() => {
    if (!targetId) return;
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
  }, [targetId, isOwnProfile, navigate]);

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
      <PageShell>
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </PageShell>
    );
  }

  if (!profile) return null;

  const skills = profile.skills || [];
  const teachSkills = skills.filter(s => s.type === 'can_teach');
  const learnSkills = skills.filter(s => s.type === 'wants_to_learn');
  const teachEditorValue = teachSkills.map(s => ({ id: s.id, skill: s.skill, example_project: s.example_project || '' }));

  const skillTitle = isOwnProfile ? 'Your skill landscape' : `${profile.name?.split(' ')[0]}'s skill landscape`;
  const skillDescription = isOwnProfile
    ? 'A snapshot of what you share and where you’re growing. Sessions push the bars forward.'
    : `An overview of where ${profile.name?.split(' ')[0]} can help.`;

  return (
    <PageShell>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg">
          {toast}
        </div>
      )}

      <Surface>
        <SurfaceBody className="pt-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <Avatar className="size-16 border-2 border-border shadow-sm">
                <AvatarFallback className="bg-primary text-lg font-bold text-primary-foreground">
                  {profile.name?.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div>
                {editing ? (
                  <input className="input mb-2 text-xl font-bold" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                ) : (
                  <h1 className="text-2xl font-bold tracking-tight">{profile.name}</h1>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {editing ? (
                    <>
                      <input className="input w-48 text-sm" placeholder="Role" value={form.current_role} onChange={e => setForm(f => ({ ...f, current_role: e.target.value }))} />
                      <select className="input w-40 text-sm" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input className="input w-40 text-sm" placeholder="Location" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
                    </>
                  ) : (
                    <>
                      <Badge variant="secondary">{profile.current_role}</Badge>
                      <Badge variant="outline">{profile.department}</Badge>
                      {profile.location && (
                        <Badge variant="outline" className="gap-1 font-normal">
                          <MapPin className="size-3" />
                          {profile.location}
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {isOwnProfile ? (
                editing ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button size="sm" onClick={handleSaveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit profile</Button>
                )
              ) : (
                <Button size="sm" onClick={() => setShowModal(true)}>Request a session</Button>
              )}
            </div>
          </div>
          {editing ? (
            <textarea className="input resize-none text-sm" rows={2} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} placeholder="A short bio…" />
          ) : profile.bio ? (
            <p className="text-sm text-muted-foreground">{profile.bio}</p>
          ) : null}
        </SurfaceBody>
      </Surface>

      <Surface>
        <SurfaceHeader
          title={skillTitle}
          description={skillDescription}
          action={
            isOwnProfile ? (
              <Button variant="outline" size="sm" onClick={() => setShowSkillEditor(s => !s)}>
                {showSkillEditor ? 'Done editing' : 'Edit skills'}
              </Button>
            ) : null
          }
        />
        <SurfaceBody className="space-y-5 pt-5">
        <SkillLandscape
          skillProgress={profile.skillProgress || []}
          isOwnProfile={isOwnProfile}
          firstName={profile.name?.split(' ')[0] || 'they'}
          onDeleteSkill={isOwnProfile ? handleDeleteSkillFromBubble : undefined}
        />

        {/* Expertise signature */}
        {profile.expertiseSignature?.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/60 p-4">
            <h3 className="mb-2 text-sm font-semibold">What colleagues seek {isOwnProfile ? 'you' : profile.name?.split(' ')[0]} out for</h3>
            <div className="flex flex-wrap gap-2">
              {profile.expertiseSignature.map(skill => (
                <Badge key={skill}>{skill}</Badge>
              ))}
            </div>
          </div>
        )}
        </SurfaceBody>
      </Surface>

      {/* Skill editors — own profile, on demand */}
      {isOwnProfile && showSkillEditor && (
        <Surface>
          <SurfaceHeader title="Manage your skills" />
          <SurfaceBody className="space-y-5 pt-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">What you can teach</h3>
            <TeachSkillsEditor
              value={teachEditorValue}
              onChange={handleTeachSkillsChange}
              placeholder="Type a skill and press Enter"
            />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">What you want to learn</h3>
            <SkillTagInput
              value={wantsToLearn}
              onChange={async (v) => {
                setWantsToLearn(v);
                await handleWantsToLearnChange(v);
              }}
              placeholder="Type a skill and press Enter"
            />
          </div>
          </SurfaceBody>
        </Surface>
      )}

      <Surface>
        <SurfaceHeader
          title="Career history"
          action={
            isOwnProfile ? (
              <Button variant="outline" size="sm" onClick={() => setShowAddCareer(!showAddCareer)}>
                {showAddCareer ? 'Cancel' : '+ Add entry'}
              </Button>
            ) : null
          }
        />
        <SurfaceBody className="pt-5">

        {isOwnProfile && showAddCareer && (
          <div className="mb-4 space-y-3 rounded-lg border border-[var(--border)] bg-muted/40 p-4">
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
            <Button size="sm" onClick={handleAddCareer}>Add</Button>
          </div>
        )}

        {profile.career?.length > 0 ? (
          <div className="space-y-3">
            {profile.career.map(entry => (
              editingCareerId === entry.id && editCareerDraft ? (
                <div key={entry.id} className="space-y-3 rounded-lg border border-[var(--border)] bg-muted/40 p-4">
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
                    <Button size="sm" onClick={handleSaveEditedCareer}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={cancelEditCareer}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div key={entry.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground">{entry.role}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.department}
                      {entry.company && ` · ${entry.company}`}
                      {(entry.start_year || entry.end_year) && ` · ${formatPeriod(entry.start_year, entry.start_month, entry.end_year, entry.end_month)}`}
                    </p>
                    {entry.description && (
                      <p className="text-xs text-gray-600 mt-1">{entry.description}</p>
                    )}
                  </div>
                  {isOwnProfile && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => startEditCareer(entry)}>Edit</Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDeleteCareer(entry.id)}>
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              )
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{isOwnProfile ? 'Add your previous roles to improve your matches.' : 'No career history listed.'}</p>
        )}
        </SurfaceBody>
      </Surface>

      {isOwnProfile && (
        <Surface>
          <SurfaceHeader
            title="Past meetings"
            description={
              <>
                Completed mentoring sessions, both as mentor and mentee. Active sessions live on your{' '}
                <Link to="/" className="text-primary hover:underline">dashboard</Link>.
              </>
            }
          />
          <SurfaceBody className="pt-5">
            <PastMeetings currentUserId={currentUser?.id} />
          </SurfaceBody>
        </Surface>
      )}

      {isOwnProfile && (
        <Surface className="scroll-mt-8" id="reflection-log">
          <SurfaceHeader
            title="Reflection log"
            description={
              <>
                A short weekly check-in. Answers are read by an AI and matched to the{' '}
                <a href="https://esco.ec.europa.eu/en" target="_blank" rel="noreferrer" className="text-primary hover:underline">ESCO taxonomy</a>{' '}
                of skills, then surfaced as one-click suggestions for your landscape. Only you can see this.
              </>
            }
          />
          <SurfaceBody className="pt-5">
            <ReflectionLog onSkillsApplied={refreshProfile} />
          </SurfaceBody>
        </Surface>
      )}

      {isOwnProfile && (
        <Surface>
          <SurfaceHeader
            title="A role you'd love to shadow"
            description="Only you can see this. We use it to surface unexpected matches over time."
            action={
              !editingShadow ? (
                <Button variant="outline" size="sm" onClick={() => setEditingShadow(true)}>
                  {profile.shadow_role_response ? 'Edit' : '+ Add'}
                </Button>
              ) : null
            }
          />
          <SurfaceBody className="pt-5">
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
                <Button size="sm" onClick={handleSaveShadow}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditingShadow(false); setShadowDraft(profile.shadow_role_response || ''); }}>Cancel</Button>
              </div>
            </div>
          ) : profile.shadow_role_response ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">{profile.shadow_role_response}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">No answer yet — even a sentence helps.</p>
          )}
          </SurfaceBody>
        </Surface>
      )}

      {profile.badges?.length > 0 && (
        <Surface>
          <SurfaceHeader title="Recognition" />
          <SurfaceBody className="pt-5">
            <BadgeDisplay badges={profile.badges} />
          </SurfaceBody>
        </Surface>
      )}

      {showModal && (
        <SessionRequestModal
          mentor={profile}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); showToast('Session request sent!'); }}
        />
      )}
    </PageShell>
  );
}
