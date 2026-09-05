import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SkillTagInput from '../components/SkillTagInput.jsx';
import TeachSkillsEditor from '../components/TeachSkillsEditor.jsx';
import SkillLandscape from '../components/SkillLandscape.jsx';
import SessionRequestModal from '../components/SessionRequestModal.jsx';

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
import { useT } from '../i18n/index.jsx';

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

// Group an already-sorted (reverse-chronological) career list into runs
// of consecutive entries that share the same company, LinkedIn-style.
// Entries without a company stand alone (their group contains just them).
function groupCareerByCompany(entries) {
  const groups = [];
  for (const entry of entries) {
    const company = (entry.company || '').trim();
    const last = groups[groups.length - 1];
    if (company && last && last.company && last.company.toLowerCase() === company.toLowerCase()) {
      last.entries.push(entry);
    } else {
      groups.push({ company, entries: [entry] });
    }
  }
  return groups;
}

// Render a "Jun 2018 – Jul 2022" / "2018 – present" period label, handling
// year-only legacy data gracefully.
function formatPeriod(startY, startM, endY, endM, presentLabel = 'present', months = MONTH_NAMES) {
  const fmt = (y, m) => {
    if (!y) return '';
    if (m && m >= 1 && m <= 12) return `${months[m - 1]} ${y}`;
    return String(y);
  };
  const start = fmt(startY, startM);
  const end = endY ? fmt(endY, endM) : presentLabel;
  if (!start && (!endY)) return '';
  if (!start) return end;
  return `${start} – ${end}`;
}

export default function Profile() {
  const { id } = useParams();
  const { user: currentUser, updateUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();

  const isOwnProfile = !id || (currentUser?.id != null && id === currentUser.id);
  const targetId = isOwnProfile ? currentUser?.id : id;

  // Subpage tabs — the profile is too dense for one long page. State lives
  // in the URL (?tab=) so back/forward and deep links behave.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'overview';
  const validTabs = isOwnProfile
    ? ['overview', 'skills', 'availability', 'experience', 'meetings', 'reflections']
    : ['overview', 'experience'];
  const tab = validTabs.includes(rawTab) ? rawTab : 'overview';
  function setTab(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab'); else params.set('tab', next);
    setSearchParams(params);
  }

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState('');

  // Edit form state
  const [form, setForm] = useState({});
  const [wantsToLearn, setWantsToLearn] = useState([]);
  // Career form uses `start_date` / `end_date` as "YYYY-MM" strings (matching
  // the native <input type="month"> value); we split into year + month on save.
  const [newCareer, setNewCareer] = useState({ role: '', department: '', company: '', description: '', start_date: '', end_date: '' });
  const [showAddCareer, setShowAddCareer] = useState(false);
  const [editingCareerId, setEditingCareerId] = useState(null);
  const [editCareerDraft, setEditCareerDraft] = useState(null);

  // Availability (P3) — mentor pause + return-on date.
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [returnDateDraft, setReturnDateDraft] = useState('');
  const [availabilityNoteDraft, setAvailabilityNoteDraft] = useState('');
  // Multi-period OOO (P4) — list of [start, end] unavailability windows.
  const [periods, setPeriods] = useState([]);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [periodNote, setPeriodNote] = useState('');
  const [periodSaving, setPeriodSaving] = useState(false);

  useEffect(() => {
    setEditing(false);
    setShowAddCareer(false);
    setEditingCareerId(null);
    setEditCareerDraft(null);
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
            department: res.data.department,
            current_role: res.data.current_role,
            location: res.data.location || '',
            bio: res.data.bio || '',
            program: res.data.program || '',
            cohort_year: res.data.cohort_year || ''
          });
          setWantsToLearn(res.data.skills?.filter(s => s.type === 'wants_to_learn').map(s => s.skill) || []);
          setReturnDateDraft(res.data.mentorship_unavailable_until || '');
          setAvailabilityNoteDraft(res.data.mentorship_note || '');
          try {
            const p = await api.get('/users/me/unavailable-periods');
            setPeriods(p.data || []);
          } catch { /* non-fatal */ }
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
      showToast(t('profile.toast.profileUpdated'));
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
    if (!confirm(t('profile.confirmRemoveSkill', { skill: entry.skill }))) return;
    try {
      await api.delete(`/users/me/skills/${entry.id}`);
      await refreshProfile();
      showToast(t('profile.toast.skillRemoved', { skill: entry.skill }));
    } catch {
      showToast(t('profile.toast.skillRemoveError'));
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
    showToast(t('profile.toast.skillsUpdated'));
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
    showToast(t('profile.toast.skillsUpdated'));
  }

  async function setAvailability({ paused, until, note }) {
    setAvailabilitySaving(true);
    try {
      const payload = {};
      if (paused !== undefined) payload.mentorship_paused = paused;
      if (until !== undefined) payload.mentorship_unavailable_until = until || null;
      if (note !== undefined) payload.mentorship_note = note || null;
      await api.put('/users/me', payload);
      await refreshProfile();
      showToast(t('profile.toast.availabilityUpdated'));
    } finally {
      setAvailabilitySaving(false);
    }
  }

  async function setReminderPreference(value) {
    setAvailabilitySaving(true);
    try {
      await api.put('/users/me', { reflection_email_reminders: value });
      await refreshProfile();
      showToast(t('profile.toast.remindersUpdated'));
    } finally {
      setAvailabilitySaving(false);
    }
  }

  async function reloadPeriods() {
    const p = await api.get('/users/me/unavailable-periods');
    setPeriods(p.data || []);
  }

  async function addPeriod() {
    if (!periodStart || !periodEnd) return;
    setPeriodSaving(true);
    try {
      await api.post('/users/me/unavailable-periods', {
        start_date: periodStart, end_date: periodEnd, note: periodNote,
      });
      setPeriodStart(''); setPeriodEnd(''); setPeriodNote('');
      await reloadPeriods();
      showToast(t('profile.toast.availabilityUpdated'));
    } finally {
      setPeriodSaving(false);
    }
  }

  async function removePeriod(id) {
    setPeriodSaving(true);
    try {
      await api.delete(`/users/me/unavailable-periods/${id}`);
      await reloadPeriods();
    } finally {
      setPeriodSaving(false);
    }
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
    // Refetch so the chronological sort and company grouping picks up the
    // new entry in the right position, instead of always pinning it on top.
    await refreshProfile();
    setNewCareer({ role: '', department: '', company: '', description: '', start_date: '', end_date: '' });
    setShowAddCareer(false);
    showToast(t('profile.toast.careerAdded'));
  }

  async function handleDeleteCareer(id) {
    await api.delete(`/users/me/career/${id}`);
    setProfile(prev => ({ ...prev, career: prev.career.filter(c => c.id !== id) }));
    showToast(t('profile.toast.entryRemoved'));
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
    await api.put(`/users/me/career/${editingCareerId}`, payload);
    // Refetch so chronological sort + grouping picks up changes to dates or
    // company name.
    await refreshProfile();
    cancelEditCareer();
    showToast(t('profile.toast.entryUpdated'));
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

  const firstName = profile.name?.split(' ')[0];
  const skillTitle = isOwnProfile
    ? t('profile.skillLandscape.titleOwn')
    : t('profile.skillLandscape.titleOther', { name: firstName });
  const skillDescription = isOwnProfile
    ? t('profile.skillLandscape.descOwn')
    : t('profile.skillLandscape.descOther', { name: firstName });

  return (
    <PageShell>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_4px_12px_rgba(0,0,0,0.12)]">
          {toast}
        </div>
      )}

      {validTabs.length > 1 && (
        <nav className="flex items-center gap-6 border-b border-[var(--border)]" aria-label={t('profile.tabs.label')}>
          {validTabs.map(key => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              data-testid={`profile-tab-${key}`}
              className={`-mb-px border-b-2 px-0.5 pb-2.5 pt-1 text-sm font-medium transition-colors ${
                tab === key
                  ? 'border-[var(--foreground)] text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`profile.tab.${key}`)}
            </button>
          ))}
        </nav>
      )}

      {tab === 'overview' && (
      <>
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
                <h1 className="text-2xl font-medium tracking-[-0.01em]">{profile.name}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {editing ? (
                    <>
                      <input className="input w-48 text-sm" placeholder={t('profile.placeholder.role')} value={form.current_role} onChange={e => setForm(f => ({ ...f, current_role: e.target.value }))} />
                      <select className="input w-40 text-sm" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input className="input w-44 text-sm" placeholder={t('profile.fields.program')} value={form.program} onChange={e => setForm(f => ({ ...f, program: e.target.value }))} />
                      <input className="input w-28 text-sm" type="number" min="1900" max="2100" placeholder={t('profile.fields.cohortYear')} value={form.cohort_year} onChange={e => setForm(f => ({ ...f, cohort_year: e.target.value }))} />
                      <input className="input w-40 text-sm" placeholder={t('profile.placeholder.location')} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
                    </>
                  ) : (
                    <>
                      {profile.role && (
                        <Badge variant="secondary">{t(`profile.persona.${profile.role}`, profile.role)}</Badge>
                      )}
                      <Badge variant="outline">{profile.department}</Badge>
                      {profile.program && <Badge variant="outline">{profile.program}</Badge>}
                      {profile.cohort_year && <Badge variant="outline">{t('profile.fields.classOf', { year: profile.cohort_year })}</Badge>}
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
                    <Button variant="ghost" onClick={() => setEditing(false)}>{t('profile.btn.cancel')}</Button>
                    <Button onClick={handleSaveProfile} disabled={saving}>{saving ? t('profile.btn.saving') : t('profile.btn.save')}</Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setEditing(true)}>{t('profile.btn.editProfile')}</Button>
                )
              ) : profile.mentorship_available === false ? (
                <Button variant="outline" className="h-11 px-6 text-base" disabled>
                  {t('profile.btn.currentlyUnavailable')}
                </Button>
              ) : (
                <Button data-testid="request-session" onClick={() => setShowModal(true)}>{t('profile.btn.requestSession')}</Button>
              )}
            </div>
          </div>
          {!isOwnProfile && profile.mentorship_available === false && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
              {profile.mentorship_unavailable_until && new Date(profile.mentorship_unavailable_until) > new Date()
                ? t('profile.mentoring.pausedUntil', { date: profile.mentorship_unavailable_until })
                : t('profile.mentoring.notAccepting')}
            </p>
          )}
          {editing ? (
            <textarea className="input resize-none text-sm" rows={2} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} placeholder={t('profile.placeholder.bio')} />
          ) : profile.bio ? (
            <p className="text-sm text-muted-foreground">{profile.bio}</p>
          ) : null}
        </SurfaceBody>
      </Surface>

      <Surface>
        <SurfaceHeader
          title={skillTitle}
          description={skillDescription}
        />
        <SurfaceBody className="space-y-5 pt-5">
          <SkillLandscape
            skillProgress={profile.skillProgress || []}
            isOwnProfile={isOwnProfile}
            firstName={firstName}
            onDeleteSkill={isOwnProfile ? handleDeleteSkillFromBubble : undefined}
          />

        {/* Expertise signature */}
        {profile.expertiseSignature?.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/60 p-4">
            <h3 className="mb-2 text-sm font-medium">{isOwnProfile ? t('profile.expertise.titleOwn') : t('profile.expertise.titleOther', { name: firstName })}</h3>
            <div className="flex flex-wrap gap-2">
              {profile.expertiseSignature.map(skill => (
                <Badge key={skill}>{skill}</Badge>
              ))}
            </div>
          </div>
        )}
        </SurfaceBody>
      </Surface>

      {isOwnProfile && (
        <Surface>
          <SurfaceHeader
            title={t('profile.reflection.quickTitle')}
            description={t('profile.reflection.quickDesc')}
            action={
              <Button variant="outline" size="sm" onClick={() => setTab('reflections')}>
                {t('profile.reflection.viewHistory')}
              </Button>
            }
          />
          <SurfaceBody className="pt-5">
            <ReflectionLog
              hideHistory
              showManualAdd
              onSkillsApplied={refreshProfile}
            />
          </SurfaceBody>
        </Surface>
      )}
      </>
      )}

      {isOwnProfile && tab === 'skills' && (
        <Surface>
          <SurfaceHeader title={t('profile.manageSkills.title')} description={t('profile.manageSkills.desc')} />
          <SurfaceBody className="space-y-5 pt-5">
          <div>
            <h3 className="mb-2 text-sm font-medium text-foreground">{t('profile.manageSkills.canTeach')}</h3>
            <TeachSkillsEditor
              value={teachEditorValue}
              onChange={handleTeachSkillsChange}
              placeholder={t('profile.skillInput.placeholder')}
              ariaLabel={t('profile.skillInput.ariaTeach')}
            />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-foreground">{t('profile.manageSkills.wantsToLearn')}</h3>
            <SkillTagInput
              value={wantsToLearn}
              onChange={async (v) => {
                setWantsToLearn(v);
                await handleWantsToLearnChange(v);
              }}
              placeholder={t('profile.skillInput.placeholder')}
              ariaLabel={t('profile.skillInput.ariaLearn')}
            />
          </div>
          </SurfaceBody>
        </Surface>
      )}

      {isOwnProfile && tab === 'availability' && (
        <Surface>
          <SurfaceHeader
            title={t('profile.availability.title')}
            action={
              <Button
                type="button"
                size="sm"
                data-testid="toggle-availability"
                variant={profile.mentorship_paused ? 'default' : 'outline'}
                disabled={availabilitySaving}
                onClick={() => setAvailability({ paused: !profile.mentorship_paused })}
              >
                {profile.mentorship_paused ? t('profile.availability.resume') : t('profile.availability.pause')}
              </Button>
            }
          />
          <SurfaceBody className="pt-5">
            <p className="flex items-center gap-2 text-sm font-medium" data-testid="availability-status">
              <span className={`size-1.5 rounded-full ${profile.mentorship_paused ? 'bg-zinc-400' : 'bg-emerald-500'}`} aria-hidden="true" />
              {profile.mentorship_paused
                ? t('profile.availability.paused')
                : profile.mentorship_unavailable_until && new Date(profile.mentorship_unavailable_until) > new Date()
                  ? t('profile.availability.backOn', { date: profile.mentorship_unavailable_until })
                  : t('profile.availability.available')}
            </p>
            {profile.mentorship_note && (
              <p className="mt-0.5 text-xs text-muted-foreground">{profile.mentorship_note}</p>
            )}

            <label className="mt-5 flex items-start gap-3 text-sm text-foreground">
              <input type="checkbox" checked={profile.reflection_email_reminders !== false} disabled={availabilitySaving}
                onChange={(e) => setReminderPreference(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span>
                <span className="block font-medium">{t('profile.availability.emailReminders')}</span>
                <span className="block text-xs text-muted-foreground">{t('profile.availability.emailRemindersDesc')}</span>
              </span>
            </label>

            <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3">
              <div className="w-44">
                <label className="label">{t('profile.availability.returnOn')}</label>
                <input
                  type="date"
                  className="input w-full text-sm"
                  title={t('profile.availability.returnHint')}
                  data-testid="availability-return-date"
                  value={returnDateDraft}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setReturnDateDraft(e.target.value)}
                  disabled={availabilitySaving}
                />
              </div>
              <div className="w-64 max-w-full">
                <label className="label">{t('profile.availability.note')}</label>
                <input
                  type="text"
                  className="input w-full text-sm"
                  maxLength={120}
                  placeholder={t('profile.availability.notePlaceholder')}
                  data-testid="availability-note"
                  value={availabilityNoteDraft}
                  onChange={(e) => setAvailabilityNoteDraft(e.target.value)}
                  disabled={availabilitySaving}
                />
              </div>
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setReturnDateDraft(profile.mentorship_unavailable_until || '');
                    setAvailabilityNoteDraft(profile.mentorship_note || '');
                  }}
                  disabled={availabilitySaving}
                >
                  {t('profile.availability.reset')}
                </Button>
                <Button
                  type="button"
                  data-testid="save-availability"
                  onClick={() => setAvailability({ until: returnDateDraft, note: availabilityNoteDraft })}
                  disabled={availabilitySaving}
                >
                  {availabilitySaving ? t('profile.btn.saving') : t('profile.btn.save')}
                </Button>
              </div>
            </div>

            {/* Multi-period out-of-office windows (P4) */}
            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <p className="label-meta">{t('profile.availability.periodsTitle')}</p>

              {periods.length > 0 ? (
                <ul className="mt-2 divide-y divide-[var(--border)]" data-testid="unavailable-periods">
                  {periods.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium text-foreground">{p.start_date} → {p.end_date}</span>
                        {p.note && <span className="ml-2 text-xs text-muted-foreground">{p.note}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePeriod(p.id)}
                        disabled={periodSaving}
                        aria-label={t('profile.availability.periodRemove')}
                        className="text-muted-foreground hover:text-red-500 text-sm leading-none"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground italic">{t('profile.availability.periodsEmpty')}</p>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-[150px_150px_minmax(200px,300px)_auto] sm:items-end">
                <div>
                  <label className="label">{t('profile.availability.periodStart')}</label>
                  <input
                    type="date"
                    className="input w-full text-sm"
                    value={periodStart}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    disabled={periodSaving}
                  />
                </div>
                <div>
                  <label className="label">{t('profile.availability.periodEnd')}</label>
                  <input
                    type="date"
                    className="input w-full text-sm"
                    value={periodEnd}
                    min={periodStart || new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    disabled={periodSaving}
                  />
                </div>
                <div>
                  <label className="label">{t('profile.availability.note')}</label>
                  <input
                    type="text"
                    className="input w-full text-sm"
                    maxLength={120}
                    placeholder={t('profile.availability.periodNotePlaceholder')}
                    value={periodNote}
                    onChange={(e) => setPeriodNote(e.target.value)}
                    disabled={periodSaving}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  data-testid="add-period"
                  onClick={addPeriod}
                  disabled={periodSaving || !periodStart || !periodEnd || periodEnd < periodStart}
                >
                  {t('profile.availability.periodAdd')}
                </Button>
              </div>
            </div>

          </SurfaceBody>
        </Surface>
      )}

      {tab === 'experience' && (
      <Surface>
        <SurfaceHeader
          title={t('profile.career.title')}
          action={
            isOwnProfile ? (
              <Button variant="outline" size="sm" onClick={() => setShowAddCareer(!showAddCareer)}>
                {showAddCareer ? t('profile.btn.cancel') : t('profile.career.addEntry')}
              </Button>
            ) : null
          }
        />
        <SurfaceBody className="pt-5">

        {isOwnProfile && showAddCareer && (
          <div className="mb-5 space-y-3 border-b border-[var(--border)] pb-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input className="input text-sm" placeholder={t('profile.career.roleTitle')} value={newCareer.role} onChange={e => setNewCareer(c => ({...c, role: e.target.value}))} />
              <select className="input text-sm" value={newCareer.department} onChange={e => setNewCareer(c => ({...c, department: e.target.value}))}>
                <option value="">{t('profile.career.department')}</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input className="input text-sm" placeholder={t('profile.career.company')} value={newCareer.company} onChange={e => setNewCareer(c => ({...c, company: e.target.value}))} />
              <div>
                <label className="block text-[10px] text-ink-tertiary mb-1">{t('profile.career.from')}</label>
                <MonthYearPicker
                  value={newCareer.start_date}
                  onChange={(v) => setNewCareer(c => ({...c, start_date: v}))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-ink-tertiary mb-1">{t('profile.career.to')} <span className="text-ink-tertiary/70">{t('profile.career.toHint')}</span></label>
                <MonthYearPicker
                  value={newCareer.end_date}
                  onChange={(v) => setNewCareer(c => ({...c, end_date: v}))}
                />
              </div>
            </div>
            <textarea
              className="input text-sm resize-none"
              rows={2}
              placeholder={t('profile.career.descPlaceholder')}
              value={newCareer.description}
              onChange={e => setNewCareer(c => ({...c, description: e.target.value}))}
            />
            <Button size="sm" onClick={handleAddCareer}>{t('profile.career.add')}</Button>
          </div>
        )}

        {profile.career?.length > 0 ? (
          <div className="space-y-5">
            {groupCareerByCompany(profile.career).map((group, gIdx) => (
              <div key={`group-${gIdx}-${group.company || 'no-co'}`} className="space-y-2">
                {group.company && group.entries.length > 1 && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.company}
                  </p>
                )}
                <div className={group.entries.length > 1 ? 'space-y-3 border-l border-border pl-4' : 'space-y-3'}>
            {group.entries.map(entry => (
              editingCareerId === entry.id && editCareerDraft ? (
                <div key={entry.id} className="space-y-3 rounded-md border border-[var(--border)] p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <input
                      className="input text-sm"
                      placeholder={t('profile.career.roleTitle')}
                      value={editCareerDraft.role}
                      onChange={e => setEditCareerDraft(d => ({...d, role: e.target.value}))}
                    />
                    <select
                      className="input text-sm"
                      value={editCareerDraft.department}
                      onChange={e => setEditCareerDraft(d => ({...d, department: e.target.value}))}
                    >
                      <option value="">{t('profile.career.department')}</option>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input
                      className="input text-sm"
                      placeholder={t('profile.career.company')}
                      value={editCareerDraft.company}
                      onChange={e => setEditCareerDraft(d => ({...d, company: e.target.value}))}
                    />
                    <div />
                    <div>
                      <label className="block text-[10px] text-ink-tertiary mb-1">{t('profile.career.from')}</label>
                      <MonthYearPicker
                        value={editCareerDraft.start_date}
                        onChange={(v) => setEditCareerDraft(d => ({...d, start_date: v}))}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-ink-tertiary mb-1">{t('profile.career.to')} <span className="text-ink-tertiary/70">{t('profile.career.toHint')}</span></label>
                      <MonthYearPicker
                        value={editCareerDraft.end_date}
                        onChange={(v) => setEditCareerDraft(d => ({...d, end_date: v}))}
                      />
                    </div>
                  </div>
                  <textarea
                    className="input text-sm resize-none"
                    rows={2}
                    placeholder={t('profile.career.descPlaceholder')}
                    value={editCareerDraft.description}
                    onChange={e => setEditCareerDraft(d => ({...d, description: e.target.value}))}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveEditedCareer}>{t('profile.btn.save')}</Button>
                    <Button size="sm" variant="ghost" onClick={cancelEditCareer}>{t('profile.btn.cancel')}</Button>
                  </div>
                </div>
              ) : (
                <div key={entry.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground">{entry.role}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.department}
                      {/* Hide the company name on individual rows when it's
                          already shown as the group header above. */}
                      {entry.company && group.entries.length === 1 && ` · ${entry.company}`}
                      {(entry.start_year || entry.end_year) && ` · ${formatPeriod(entry.start_year, entry.start_month, entry.end_year, entry.end_month, t('profile.career.present'), t('profile.career.monthsShort').split(','))}`}
                    </p>
                    {entry.description && (
                      <p className="text-xs text-secondary-foreground mt-1">{entry.description}</p>
                    )}
                  </div>
                  {isOwnProfile && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => startEditCareer(entry)}>{t('profile.career.edit')}</Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDeleteCareer(entry.id)}>
                        {t('profile.career.remove')}
                      </Button>
                    </div>
                  )}
                </div>
              )
            ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{isOwnProfile ? t('profile.career.emptyOwn') : t('profile.career.emptyOther')}</p>
        )}
        </SurfaceBody>
      </Surface>
      )}

      {isOwnProfile && tab === 'meetings' && (
        <Surface>
          <SurfaceHeader
            title={t('profile.pastMeetings.title')}
            description={
              <>
                {t('profile.pastMeetings.descPrefix')}
                <Link to="/" className="text-primary hover:underline">{t('profile.pastMeetings.dashboard')}</Link>.
              </>
            }
          />
          <SurfaceBody className="pt-5">
            <PastMeetings currentUserId={currentUser?.id} />
          </SurfaceBody>
        </Surface>
      )}

      {isOwnProfile && tab === 'reflections' && (
        <Surface className="scroll-mt-8" id="reflection-log">
          <SurfaceHeader
            title={t('profile.reflection.title')}
            description={
              <>
                {t('profile.reflection.descPrefix')}
                <a href="https://esco.ec.europa.eu/en" target="_blank" rel="noreferrer" className="text-primary hover:underline">{t('profile.reflection.escoLink')}</a>
                {t('profile.reflection.descSuffix')}
              </>
            }
          />
          <SurfaceBody className="pt-5">
            <ReflectionLog onSkillsApplied={refreshProfile} />
          </SurfaceBody>
        </Surface>
      )}

      {showModal && (
        <SessionRequestModal
          mentor={profile}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); showToast(t('profile.toast.sessionRequestSent')); }}
        />
      )}
    </PageShell>
  );
}
