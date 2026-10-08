import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { flushSync } from 'react-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SkillTagInput from '../components/SkillTagInput.jsx';
import TeachSkillsEditor from '../components/TeachSkillsEditor.jsx';
import SkillCloud, { SkillCloudFilters } from '../components/SkillCloud.jsx';
import { Field } from '../components/ui/field.jsx';
import SessionRequestModal from '../components/SessionRequestModal.jsx';

import CareerEntryFields, { DEPARTMENTS } from '../components/CareerEntryFields.jsx';
import ProfileReflection from '../components/ProfileReflection.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody, SurfaceHeader } from '../components/Surface.jsx';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MapPin, Plus, X } from 'lucide-react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { sessionPath } from '../lib/conversationLinks.mjs';


const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function safeLinkedInHref(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

function conciseHeadline(profile) {
  const repeated = [profile.current_role, profile.department, profile.program, profile.location,
    profile.cohort_year ? `class of ${profile.cohort_year}` : '']
    .filter(Boolean).map(value => value.toLowerCase());
  return (profile.linkedin_headline || '').split(/[|·]/)
    .map(part => part.trim())
    .filter(part => {
      const normalized = part.replace(/^essec\s+/i, '').toLowerCase();
      return normalized && normalized !== 'demo profile' && !repeated.some(value => normalized === value || normalized.includes(value));
    }).join(' · ');
}

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

function attachSkillEvidence(profile, evidence) {
  const bySkill = new Map();
  for (const item of evidence || []) bySkill.set(item.skill_id, [...(bySkill.get(item.skill_id) || []), item]);
  const skills = (profile.skills || []).map((skill) => ({ ...skill, evidence: bySkill.get(skill.id) || [], session_count: (bySkill.get(skill.id) || []).length }));
  const skillProgress = (profile.skillProgress || skills).map((skill) => ({ ...skill, evidence: bySkill.get(skill.id) || [], session_count: (bySkill.get(skill.id) || []).length }));
  return { ...profile, skills, skillProgress };
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
    ? ['overview', 'skills', 'availability', 'experience', 'reflections']
    : ['overview', 'experience'];
  const tab = validTabs.includes(rawTab) ? rawTab : 'overview';
  const previousTab = React.useRef(tab);
  const tabDirection = validTabs.indexOf(tab) >= validTabs.indexOf(previousTab.current) ? 'forward' : 'backward';
  const tabTransitionId = React.useRef(0);
  const supportsViewTransitions = typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
  useEffect(() => { previousTab.current = tab; }, [tab]);
  // Arrived from a chat result: offer the way back to that conversation.
  const fromChat = !isOwnProfile && searchParams.get('from') === 'chat';
  const chatThread = searchParams.get('thread');
  function setTab(next) {
    if (!validTabs.includes(next) || next === tab) return;
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab'); else params.set('tab', next);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!supportsViewTransitions || reducedMotion) {
      setSearchParams(params);
      return;
    }

    const direction = validTabs.indexOf(next) >= validTabs.indexOf(tab) ? 'forward' : 'backward';
    const transitionId = ++tabTransitionId.current;
    document.documentElement.dataset.profileTabDirection = direction;
    const clearDirection = () => {
      if (tabTransitionId.current === transitionId) delete document.documentElement.dataset.profileTabDirection;
    };
    try {
      document.startViewTransition(() => flushSync(() => setSearchParams(params)))
        .finished.then(clearDirection, clearDirection);
    } catch {
      clearDirection();
      setSearchParams(params);
    }
  }

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [cvConsent, setCvConsent] = useState(false);
  const [cvBusy, setCvBusy] = useState(false);
  const [cvDraft, setCvDraft] = useState(null);
  const [cvError, setCvError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState('');
  const [reflectionDraft, setReflectionDraft] = useState({ support_needed: '', managed_well: '' });
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const reflectionTriggerRef = React.useRef(null);
  const [skillFilter, setSkillFilter] = useState('all');
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifySaving, setNotifySaving] = useState(false);
  const [notifyError, setNotifyError] = useState('');

  // Edit form state
  const [form, setForm] = useState({});
  const [wantsToLearn, setWantsToLearn] = useState([]);
  // Career form uses `start_date` / `end_date` as "YYYY-MM" strings (matching
  // the native <input type="month"> value); we split into year + month on save.
  const [newCareer, setNewCareer] = useState({ role: '', department: '', company: '', description: '', start_date: '', end_date: '' });
  const [showAddCareer, setShowAddCareer] = useState(false);
  const [editingCareerId, setEditingCareerId] = useState(null);
  const [editCareerDraft, setEditCareerDraft] = useState(null);
  const [careerBusy, setCareerBusy] = useState(false);

  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [capacity, setCapacity] = useState(null);
  const [capacityDraft, setCapacityDraft] = useState({ weekly_limit: '', monthly_limit: '' });
  const [capacityError, setCapacityError] = useState('');

  useEffect(() => {
    setReflectionDraft({ support_needed: '', managed_well: '' });
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
      setLoadError(false);
      try {
        const res = await api.get(isOwnProfile ? '/users/me' : `/users/${targetId}`);
        let loadedProfile = res.data;
        if (isOwnProfile) {
          const evidenceResponse = await api.get('/users/me/skill-evidence');
          loadedProfile = attachSkillEvidence(loadedProfile, evidenceResponse.data);
        }
        setProfile(loadedProfile);
        if (isOwnProfile) {
          setForm({
            department: res.data.department,
            current_role: res.data.current_role,
            location: res.data.location || '',
            bio: res.data.bio || '',
            program: res.data.program || '',
            cohort_year: res.data.cohort_year || '',
            linkedin_url: res.data.linkedin_url || ''
          });
          setNotifyEmail(res.data.notification_email || '');
          setWantsToLearn(res.data.skills?.filter(s => s.type === 'wants_to_learn').map(s => s.skill) || []);
          try {
            setCapacityError('');
            const capacityResponse = await api.get('/users/me/capacity');
            setCapacity(capacityResponse.data);
            setCapacityDraft({ weekly_limit: capacityResponse.data.weekly_limit, monthly_limit: capacityResponse.data.monthly_limit });
          } catch {
            setCapacity(null);
            setCapacityError(t('components.sessionRequest.errorGeneric'));
          }
        }
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [targetId, isOwnProfile, loadAttempt]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // Saved on its own rather than with the profile form: it lives on a
  // different tab and an empty value is meaningful (fall back to the login).
  async function handleSaveNotifyEmail() {
    const value = notifyEmail.trim().toLowerCase();
    if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setNotifyError(t('profile.notifyEmail.invalid'));
      return;
    }
    setNotifySaving(true);
    setNotifyError('');
    try {
      const res = await api.put('/users/me', { notification_email: value || null });
      setProfile(prev => ({ ...prev, ...res.data }));
      setNotifyEmail(res.data.notification_email || '');
      showToast(t('profile.notifyEmail.saved'));
    } catch {
      setNotifyError(t('components.sessionRequest.errorGeneric'));
    } finally {
      setNotifySaving(false);
    }
  }

  async function handleSaveProfile() {
    setSaving(true);
    try {
      const res = await api.put('/users/me', form);
      setProfile(prev => ({ ...prev, ...res.data }));
      updateUser(res.data);
      setEditing(false);
      showToast(t('profile.toast.profileUpdated'));
    } catch {
      showToast(t('components.sessionRequest.errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  async function refreshProfile() {
    const res = await api.get('/users/me');
    const evidenceResponse = await api.get('/users/me/skill-evidence');
    const loadedProfile = attachSkillEvidence(res.data, evidenceResponse.data);
    setProfile(loadedProfile);
    setWantsToLearn(loadedProfile.skills?.filter(s => s.type === 'wants_to_learn').map(s => s.skill) || []);
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

    // Reject only new/changed evidence; preserve legacy examples until edited.
    if (next.some(n => {
      const old = prev.find(p => p.id === n.id);
      return (!old || (old.example_project || '') !== (n.example_project || '')) && (n.example_project || '').length > 80;
    })) throw new Error('evidence_too_long');

    await api.post('/users/me/skills/batch', { type: 'can_teach', skills: next });
    await refreshProfile();
    showToast(t('profile.toast.skillsUpdated'));
  }

  async function handleWantsToLearnChange(next) {
    const prev = (profile?.skills || []).filter(s => s.type === 'wants_to_learn');
    await api.post('/users/me/skills/batch', {
      type: 'wants_to_learn',
      skills: next.map(skill => ({ skill, id: prev.find(p => p.skill.toLowerCase() === skill.toLowerCase())?.id })),
    });
    await refreshProfile();
    showToast(t('profile.toast.skillsUpdated'));
  }

  async function setAvailability({ paused }) {
    setAvailabilitySaving(true);
    setCapacityError('');
    try {
      await api.put('/users/me', { mentorship_paused: paused });
      await refreshProfile();
      showToast(t('profile.toast.availabilityUpdated'));
    } catch {
      setCapacityError(t('components.sessionRequest.errorGeneric'));
    } finally {
      setAvailabilitySaving(false);
    }
  }

  async function saveCapacity() {
    const weekly = Math.max(1, Math.min(50, Number(capacityDraft.weekly_limit) || 1));
    const monthly = Math.max(weekly, Math.min(200, Number(capacityDraft.monthly_limit) || weekly));
    setAvailabilitySaving(true);
    setCapacityError('');
    try {
      await api.put('/users/me', { weekly_meeting_limit: weekly, monthly_meeting_limit: monthly });
      const response = await api.get('/users/me/capacity');
      setCapacity(response.data);
      setCapacityDraft({ weekly_limit: response.data.weekly_limit, monthly_limit: response.data.monthly_limit });
      await refreshProfile();
      showToast(t('profile.toast.availabilityUpdated'));
    } catch {
      setCapacityError(t('components.sessionRequest.errorGeneric'));
    } finally {
      setAvailabilitySaving(false);
    }
  }

  async function handleAddCareer() {
    if (!newCareer.role.trim() || !newCareer.department.trim() || careerBusy) return;
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
    setCareerBusy(true);
    try {
      await api.post('/users/me/career', payload);
      await refreshProfile();
      setNewCareer({ role: '', department: '', company: '', description: '', start_date: '', end_date: '' });
      setShowAddCareer(false);
      showToast(t('profile.toast.careerAdded'));
    } catch {
      showToast(t('profile.toast.careerSaveError'));
    } finally {
      setCareerBusy(false);
    }
  }

  async function handleCvUpload(file) {
    if (!file || cvBusy) return;
    if (!cvConsent) { setCvError(t('onboarding.import.consentRequired')); return; }
    if (file.size > 10 * 1024 * 1024 || !/\.(pdf|docx)$/i.test(file.name)) { setCvError(t('onboarding.import.error')); return; }
    setCvBusy(true);
    setCvError('');
    const data = new FormData();
    data.append('file', file);
    try {
      const response = await api.post('/profile/ingest', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      setCvDraft(response.data);
    } catch {
      setCvError(t('onboarding.import.unavailable'));
    } finally {
      setCvBusy(false);
    }
  }

  async function applyCvDraft() {
    if (!cvDraft || cvBusy) return;
    const proposed = cvDraft.proposed || {};
    const career = proposed.career_history?.length
      ? proposed.career_history.map(entry => ({
          role: entry.role || entry.role_title || proposed.job_title || profile.current_role || '',
          department: entry.department || proposed.department || profile.department || '',
          company: entry.company || '', description: entry.description || '',
          start_year: entry.start_year ?? null, start_month: entry.start_month ?? null,
          end_year: entry.end_year ?? null, end_month: entry.end_month ?? null,
        }))
      : profile.career?.length ? profile.career : [{ role: proposed.job_title || profile.current_role || '', department: proposed.department || profile.department || '' }];
    const primary = career[0] || {};
    const skills = profile.skills || [];
    const payload = {
      name: profile.name, department: primary.department || profile.department,
      current_role: primary.role || primary.role_title || profile.current_role,
      seniority: profile.seniority, shadow_role_response: profile.shadow_role_response,
      location: proposed.location || profile.location || '', bio: proposed.bio || profile.bio || '',
      career,
      can_teach: proposed.can_teach?.length ? proposed.can_teach : skills.filter(skill => skill.type === 'can_teach'),
      wants_to_learn: proposed.wants_to_learn?.length ? proposed.wants_to_learn : skills.filter(skill => skill.type === 'wants_to_learn').map(skill => skill.skill),
      program: profile.program || '', cohort_year: profile.cohort_year || null,
      persona: profile.role, linkedin_url: profile.linkedin_url || null,
      linkedin_headline: profile.linkedin_headline || null,
    };
    setCvBusy(true);
    setCvError('');
    try {
      await api.post(`/profile/ingest/${cvDraft.draft_id}/accept`, { accepted_json: { ...proposed, ...payload } });
      const response = await api.post('/users/me/onboarding', payload);
      updateUser(response.data);
      await refreshProfile();
      setCvDraft(null);
      setEditing(false);
      showToast(t('profile.toast.profileUpdated'));
    } catch {
      setCvError(t('onboarding.import.unavailable'));
    } finally {
      setCvBusy(false);
    }
  }

  async function handleDeleteCareer(id) {
    if (careerBusy || !window.confirm(t('profile.career.confirmRemove'))) return;
    setCareerBusy(true);
    try {
      await api.delete(`/users/me/career/${id}`);
      setProfile(prev => ({ ...prev, career: prev.career.filter(c => c.id !== id) }));
      showToast(t('profile.toast.entryRemoved'));
    } catch {
      showToast(t('profile.toast.careerSaveError'));
    } finally {
      setCareerBusy(false);
    }
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
    if (!editingCareerId || !editCareerDraft || careerBusy) return;
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
    setCareerBusy(true);
    try {
      await api.put(`/users/me/career/${editingCareerId}`, payload);
      await refreshProfile();
      cancelEditCareer();
      showToast(t('profile.toast.entryUpdated'));
    } catch {
      showToast(t('profile.toast.careerSaveError'));
    } finally {
      setCareerBusy(false);
    }
  }

  const linkedinHref = safeLinkedInHref(profile?.linkedin_url);
  const headlineSummary = conciseHeadline(profile || {});

  if (loading) {
    return (
      <PageShell>
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </PageShell>
    );
  }

  if (loadError || !profile) return <PageShell><p role="alert">{t('profile.error.load')}</p><Button onClick={() => setLoadAttempt(value => value + 1)}>{t('explorer.retry')}</Button></PageShell>;

  const skills = profile.skills || [];
  const teachSkills = skills.filter(s => s.type === 'can_teach');
  const learnSkills = skills.filter(s => s.type === 'wants_to_learn');
  const teachEditorValue = teachSkills.map(s => ({ id: s.id, skill: s.skill, example_project: s.example_project || '' }));

  const firstName = profile.name?.split(' ')[0];
  const skillTitle = isOwnProfile
    ? t('profile.skillLandscape.titleOwn')
    : t('profile.skillLandscape.titleOther', { name: firstName });

  return (
    <PageShell className="profile-page gap-8">
      {fromChat && (
        <div className="-mb-4">
          <Button type="button" variant="ghost" size="sm" className="-ml-2"
            onClick={() => navigate(chatThread ? `/?thread=${encodeURIComponent(chatThread)}` : '/')}>
            <ArrowLeft aria-hidden="true" />
            {t('profile.backToChat')}
          </Button>
        </div>
      )}
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-primary bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
          {toast}
        </div>
      )}

      {validTabs.length > 1 && (
        <nav className="profile-tabs flex min-h-0 flex-wrap items-center gap-1 sm:flex-nowrap" aria-label={t('profile.tabs.label')}>
          {validTabs.map(key => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              data-testid={`profile-tab-${key}`}
              className={`rounded-full px-3.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 ${
                tab === key
                  ? 'bg-[var(--control-surface)] font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-[var(--control-surface)] hover:text-foreground'
              }`}
            >
              {t(`profile.tab.${key}`)}
            </button>
          ))}
        </nav>
      )}

      <div key={tab} className={`profile-tab-content${supportsViewTransitions ? ' profile-tab-view-transition' : ` profile-tab-enter-${tabDirection}`}`}>
      {tab === 'overview' && (
      <>
      <Surface className="profile-overview-header">
        <SurfaceBody className="profile-overview-header-body space-y-3 px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5">
          <div className="profile-identity-row flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="size-12">
                <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
                  {profile.name?.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h1 className="text-title font-medium tracking-[-0.02em]">{profile.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {editing ? null : (
                    <>
                      {profile.role && <span>{t(`profile.persona.${profile.role}`, profile.role)}</span>}
                      <span aria-hidden="true">·</span><span>{profile.department}</span>
                      {profile.program && <><span aria-hidden="true">·</span><span>{profile.program}</span></>}
                      {profile.cohort_year && <><span aria-hidden="true">·</span><span>{t('profile.fields.classOf', { year: profile.cohort_year })}</span></>}
                      {profile.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {profile.location}
                        </span>
                      )}
                      {linkedinHref && <a href={linkedinHref} target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">LinkedIn</a>}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {isOwnProfile ? (
                editing ? (
                  <>
                    <Button variant="ghost" onClick={() => setEditing(false)}>{t('profile.btn.cancel')}</Button>
                    <Button onClick={handleSaveProfile} disabled={saving}>{saving ? t('profile.btn.saving') : t('profile.btn.save')}</Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setEditing(true)}>{t('profile.btn.editProfile')}</Button>
                )
              ) : profile.session_id ? (
                <Link to={sessionPath({ id: profile.session_id, route_token: profile.session_token })} className="inline-flex h-11 items-center rounded-full bg-[var(--control-surface)] px-5 text-sm font-semibold text-foreground hover:bg-[var(--control-surface-hover)]">
                  {t('profile.btn.openChat')}
                </Link>
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
            <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label={t('profile.placeholder.role')}
                value={form.current_role}
                onChange={e => setForm(f => ({ ...f, current_role: e.target.value }))}
              />
              <Field
                label={t('profile.fields.department')}
                as="select"
                value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
              >
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </Field>
              {/* Program is assigned by the school, so it is shown but not offered. */}
              <Field
                label={t('profile.fields.program')}
                value={form.program}
                readOnly
                hint={t('profile.fields.setBySchool')}
              />
              <Field
                label={t('profile.fields.cohortYear')}
                type="number"
                min="1900"
                max="2100"
                value={form.cohort_year}
                onChange={e => setForm(f => ({ ...f, cohort_year: e.target.value }))}
              />
              <Field
                label={t('profile.placeholder.location')}
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              />
              <Field
                label={t('profile.fields.linkedin')}
                type="url"
                value={form.linkedin_url}
                onChange={e => setForm(f => ({ ...f, linkedin_url: e.target.value }))}
              />
              <Field
                label={t('profile.placeholder.bio')}
                as="textarea"
                value={form.bio}
                onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                className="sm:col-span-2 lg:col-span-3"
              />
              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#a95035]" checked={cvConsent} onChange={event => setCvConsent(event.target.checked)} />
                  <span>{t('onboarding.import.consent')}</span>
                </label>
                <input id="profile-cv-upload" className="peer sr-only" aria-label={t('onboarding.import.browse')} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={cvBusy || !cvConsent} onChange={event => { handleCvUpload(event.target.files?.[0]); event.target.value = ''; }} />
                <label htmlFor="profile-cv-upload" className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--input)] bg-muted/40 px-4 py-3 text-center peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${cvBusy || !cvConsent ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted'}`}>
                  <span className="rounded-[var(--control-radius)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{cvBusy ? t('onboarding.import.reading') : t('onboarding.import.browse')}</span>
                  {!cvBusy && <span className="text-xs text-muted-foreground">{t('onboarding.import.hint')}</span>}
                </label>
                {cvError && <p role="alert" className="text-sm text-destructive">{cvError}</p>}
                {cvDraft && <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-muted-foreground">{t('onboarding.import.reviewNotice')}</p><Button type="button" onClick={applyCvDraft} disabled={cvBusy}>{t('profile.btn.applyCv')}</Button></div>}
              </div>
            </div>
          ) : <div className="space-y-1">{headlineSummary && <p className="text-sm text-muted-foreground">{headlineSummary}</p>}{profile.bio && <p className="text-sm text-muted-foreground">{profile.bio}</p>}</div>}
        </SurfaceBody>
      </Surface>

      <div className="flex flex-col gap-12">
      <Surface className="overflow-visible">
        <SurfaceHeader
          title={skillTitle}
          action={isOwnProfile ? <SkillCloudFilters value={skillFilter} onChange={setSkillFilter} /> : null}
        />
        <SurfaceBody className="min-w-0 pt-3">
          {isOwnProfile && !(profile.skillProgress?.length ? profile.skillProgress : profile.skills || []).length ? (
            <div className="rounded-[var(--panel-radius)] bg-[var(--surface)] p-5">
              <p className="text-sm text-muted-foreground">{t('profile.skillLandscape.firstDay')}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setTab('skills')}>{t('profile.skillLandscape.addSkills')}</Button>
            </div>
          ) : (
            <SkillCloud
              skillProgress={profile.skillProgress?.length ? profile.skillProgress : profile.skills || []}
              isOwnProfile={isOwnProfile}
              filter={skillFilter}
              onDeleteSkill={isOwnProfile ? handleDeleteSkillFromBubble : undefined}
            />
          )}

        {/* Expertise signature */}
        {profile.expertiseSignature?.length > 0 && (
          <div className="pt-1">
            <h3 className="mb-2 text-section font-semibold">{isOwnProfile ? t('profile.expertise.titleOwn') : t('profile.expertise.titleOther', { name: firstName })}</h3>
            <div className="flex flex-wrap gap-2">
              {profile.expertiseSignature.map(skill => (
                <Badge key={skill} variant="secondary" className="h-auto rounded-full bg-[var(--control-surface)] px-3 py-1 text-label text-foreground">{skill}</Badge>
              ))}
            </div>
          </div>
        )}
        </SurfaceBody>
      </Surface>

      {isOwnProfile && (
        <Surface className="bg-[var(--surface)] px-1">
          <SurfaceHeader
            className="sm:px-4"
            title={t('profile.reflection.quickTitle')}
            description={t('profile.reflection.quickDesc')}
            action={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setTab('reflections')}>
                  {t('profile.reflection.viewHistory')}
                </Button>
                  <Button ref={reflectionTriggerRef} size="sm" aria-haspopup="dialog" onClick={() => setReflectionOpen(true)}>
                    {t('components.reflection.startCheckIn')}
                  </Button>
              </div>
            }
          />
          <SurfaceBody className="pt-3 sm:px-4">
            <ProfileReflection
              draft={reflectionDraft}
              onDraftChange={setReflectionDraft}
              onSkillsApplied={refreshProfile}
              open={reflectionOpen}
              returnFocus={reflectionTriggerRef}
              onOpenChange={setReflectionOpen}
            />
          </SurfaceBody>
        </Surface>
      )}
      </div>
      </>
      )}

      {isOwnProfile && tab === 'skills' && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <div className="min-w-0 rounded-[var(--panel-radius)] border border-[var(--border-subtle)] bg-[var(--surface)] p-4 sm:p-5">
            <h3 className="mb-3 text-section font-semibold">{t('profile.manageSkills.canTeach')}</h3>
            <TeachSkillsEditor
              tileLayout
              value={teachEditorValue}
              onChange={handleTeachSkillsChange}
              placeholder={t('profile.skillInput.placeholder')}
              ariaLabel={t('profile.skillInput.ariaTeach')}
            />
          </div>

          <div className="min-w-0 rounded-[var(--panel-radius)] border border-[var(--border-subtle)] bg-[var(--surface)] p-4 sm:p-5">
            <h3 className="mb-3 text-section font-semibold">{t('profile.manageSkills.wantsToLearn')}</h3>
            <SkillTagInput
              tileLayout
              value={wantsToLearn}
              onChange={handleWantsToLearnChange}
              placeholder={t('profile.skillInput.placeholder')}
              ariaLabel={t('profile.skillInput.ariaLearn')}
            />
          </div>
        </div>
      )}

      {isOwnProfile && tab === 'availability' && (
        <Surface className="overflow-visible bg-transparent">
          <SurfaceBody className="px-0 pt-0 sm:px-0">
            <div className="mb-5 flex items-center justify-between gap-3">
              <p className="text-sm font-medium" data-testid="availability-status">
                {profile.mentorship_paused
                  ? t('profile.availability.paused')
                  : t('profile.availability.available')}
              </p>
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
            </div>
            {capacityError && <p role="alert" className="mb-4 text-sm text-destructive">{capacityError}</p>}

            {/* Where notifications go. Blank means the address you sign in
                with, which is what most people want. */}
            <section className="mb-6 rounded-[var(--panel-radius)] bg-[var(--surface)] p-4">
              <h3 className="text-section font-semibold">{t('profile.notifyEmail.title')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('profile.notifyEmail.help')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Field
                  label={t('profile.notifyEmail.label')}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={notifyEmail}
                  onChange={e => { setNotifyEmail(e.target.value); setNotifyError(''); }}
                  placeholder={profile.email || ''}
                  className="min-w-0 max-w-md flex-1 basis-72 bg-background"
                />
                <Button size="sm" onClick={handleSaveNotifyEmail} disabled={notifySaving || notifyEmail === (profile.notification_email || '')}>
                  {notifySaving ? t('profile.btn.saving') : t('profile.btn.save')}
                </Button>
              </div>
              {notifyError && <p role="alert" className="mt-2 text-xs text-destructive">{notifyError}</p>}
              {!notifyEmail && profile.email && (
                <p className="mt-2 text-xs text-muted-foreground">{t('profile.notifyEmail.usingLogin', { email: profile.email })}</p>
              )}
            </section>
            {capacity && <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                { period: 'weekly', limit: capacityDraft.weekly_limit, booked: capacity.weekly_booked, max: 50 },
                { period: 'monthly', limit: capacityDraft.monthly_limit, booked: capacity.monthly_booked, max: 200 },
              ].map(item => (
                <section key={item.period} className="rounded-[var(--panel-radius)] bg-[var(--surface)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><h3 className="text-section font-semibold">{t(`profile.availability.${item.period}`)}</h3><p className="mt-0.5 text-xs text-muted-foreground">{t('profile.availability.booked', { booked: item.booked, limit: item.limit })}</p></div>
                    <input type="number" min="1" max={item.max} className="input h-9 min-h-0 w-20 text-center" aria-label={t(`profile.availability.${item.period}Limit`)} value={item.limit} disabled={availabilitySaving} onChange={event => setCapacityDraft(previous => ({ ...previous, [`${item.period}_limit`]: event.target.value }))} />
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background"><div data-testid={`capacity-fill-${item.period}`} className="capacity-fill h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (item.booked / Math.max(1, Number(item.limit))) * 100)}%` }} /></div>
                </section>
              ))}
            </div>}
            {capacity && <div className="mt-4 flex justify-end"><Button type="button" data-testid="save-availability" onClick={saveCapacity} disabled={availabilitySaving || Number(capacityDraft.monthly_limit) < Number(capacityDraft.weekly_limit)}>{availabilitySaving ? t('profile.btn.saving') : t('profile.availability.saveCapacity')}</Button></div>}
          </SurfaceBody>
        </Surface>
      )}

      {tab === 'experience' && (
      <Surface>
        <SurfaceHeader
          title={t('profile.career.title')}
          action={
            isOwnProfile ? (
              <Button
                type="button"
                variant={showAddCareer ? 'outline' : 'default'}
                size="icon"
                className="size-12 rounded-xl"
                aria-label={showAddCareer ? t('profile.btn.cancel') : t('profile.career.addEntry')}
                title={showAddCareer ? t('profile.btn.cancel') : t('profile.career.addEntry')}
                aria-expanded={showAddCareer}
                onClick={() => setShowAddCareer(!showAddCareer)}
              >
                {showAddCareer ? <X className="size-6" /> : <Plus className="size-6" />}
              </Button>
            ) : null
          }
        />
        <SurfaceBody className="pt-5">

        {isOwnProfile && showAddCareer && (
          <div className="career-entry-form mb-5">
            <CareerEntryFields value={newCareer} onChange={setNewCareer} />
              <Button size="sm" disabled={careerBusy} onClick={handleAddCareer}>{t('profile.career.add')}</Button>
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
                <div className={group.entries.length > 1 ? 'space-y-3 pl-4' : 'space-y-3'}>
            {group.entries.map(entry => (
              editingCareerId === entry.id && editCareerDraft ? (
                <div key={entry.id} className="career-entry-form">
                  <CareerEntryFields value={editCareerDraft} onChange={setEditCareerDraft} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={careerBusy} onClick={handleSaveEditedCareer}>{t('profile.btn.save')}</Button>
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
                      <Button variant="ghost" size="sm" disabled={careerBusy} onClick={() => startEditCareer(entry)}>{t('profile.career.edit')}</Button>
                      <Button variant="danger" size="sm" disabled={careerBusy} onClick={() => handleDeleteCareer(entry.id)}>
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
            <ProfileReflection history draft={reflectionDraft} onDraftChange={setReflectionDraft} onSkillsApplied={refreshProfile} open={reflectionOpen} onOpenChange={setReflectionOpen} returnFocus={reflectionTriggerRef} />
          </SurfaceBody>
        </Surface>
      )}
      </div>

      {showModal && (
        <SessionRequestModal
          mentor={profile}
          onClose={() => setShowModal(false)}
          onSuccess={(session) => { setProfile((current) => ({ ...current, session_id: session.id, session_token: session.route_token, relationship_status: session.status })); setShowModal(false); showToast(t('profile.toast.sessionRequestSent')); }}
        />
      )}
    </PageShell>
  );
}
