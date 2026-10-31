import React, { useMemo, useState, useEffect, useRef } from 'react';
import { errorMessage } from '../lib/errors.mjs';
import { useSearchParams } from 'react-router-dom';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { PageShell } from '../components/PageShell.jsx';
import PageTabs from '../components/PageTabs.jsx';
import { Surface, SurfaceBody, SurfaceHeader, SurfacePanel } from '../components/Surface.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ActionMenu } from '@/components/ui/action-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Check, ChevronDown, ChevronUp, Eye, Lock, Plus } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { formatAdminDate, pmTranslate } from '../components/admin/adminPm.js';
import { metricEvidence } from '../components/admin/AdminPmKpis.jsx';
import AdminInvitationPanel from '../components/admin/AdminInvitationPanel.jsx';
import AdminProvisionUserPanel from '../components/admin/AdminProvisionUserPanel.jsx';
import AdminAiRuns from '../components/admin/AdminAiRuns.jsx';

function StatCard({ label, value, sub }) {
  return (
    <Surface>
      <SurfaceBody className="py-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-display font-medium tabular-nums tracking-[-0.01em]">{value ?? '—'}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </SurfaceBody>
    </Surface>
  );
}

// Horizontal bar list for KPI breakdowns (most requested/shared skills, etc).
async function downloadBlob(apiPath, filename) {
  const res = await api.get(apiPath, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// How a field of study takes part in a skill, with the colours used across the app.
const SKILL_ROLES = [
  { key: 'offered', dot: 'bg-[var(--status-scheduled-fg)]', chip: 'bg-[var(--status-scheduled-bg)] text-[var(--status-scheduled-fg)]' },
  { key: 'wanted', dot: 'bg-[var(--status-attention-fg)]', chip: 'bg-[var(--status-attention-bg)] text-[var(--status-attention-fg)]' },
  { key: 'sessions', dot: 'bg-[var(--ink)]', chip: 'bg-[var(--control-surface)] text-foreground' },
];

// Field names from privacy-status, mapped to plain labels.
const PRIVACY_FIELD_KEYS = {
  'first name + last initial': 'name', name: 'name', skills: 'teaches', role: 'role', department: 'field', location: 'location', bio: 'bio',
  'teachable skills': 'teaches', reflections: 'reflections', ratings: 'ratings', 'wants-to-learn': 'wants',
  'shadow role': 'goal', shadow_role_response: 'goal', 'session reflections/ratings': 'meetingNotes', email: 'email',
};

const RETENTION_FIELDS = ['conversation_days', 'search_days', 'reflection_days', 'audit_log_days', 'deactivated_account_days'];

// Grid places for the scorecard (literal class names, so the build keeps them).
const SCORE_COLUMNS = ['lg:col-start-1', 'lg:col-start-2', 'lg:col-start-3'];
const SCORE_ROWS = ['lg:row-start-2', 'lg:row-start-3', 'lg:row-start-4'];

// The scorecard as a CSV for reporting: what each number is and how it is counted.
function exportScorecard(groups, t) {
  const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [[t('admin.scorecard.csvGroup'), t('admin.scorecard.csvMetric'), t('admin.scorecard.csvValue'), t('admin.scorecard.csvContext'), t('admin.scorecard.csvCounted')]];
  for (const group of groups) for (const item of group.items) {
    rows.push([t(`admin.scorecard.group.${group.key}`), t(`admin.score.${item.key}.label`), item.value ?? t('admin.scorecard.notEnough'),
      item.sub || t(`admin.score.${item.key}.means`), t(`admin.score.${item.key}.counted`)]);
  }
  const blob = new Blob(['\uFEFF', rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: `ment-scorecard-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Folds a section away; its header stays as the way back in.
function SectionToggle({ open, onToggle, label, testId }) {
  const { t } = useT();
  return (
    <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-label={`${open ? t('admin.common.hide') : t('admin.common.show')} ${label}`} data-testid={testId} onClick={onToggle}>
      {open ? <ChevronUp /> : <ChevronDown />}{open ? t('admin.common.hide') : t('admin.common.show')}
    </Button>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const { t: translate } = useT();
  const t = (key, vars) => pmTranslate(translate, key, vars);
  const [stats, setStats] = useState(null);
  const [fieldsOfStudy, setFieldsOfStudy] = useState(null);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [programme, setProgramme] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const [programmeError, setProgrammeError] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [userFilters, setUserFilters] = useState({ name: '', email: '', field: '', role: '', advisor: '' });
  const [feedback, setFeedback] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState('');
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState(null);
  const [savingOrgPrivacy, setSavingOrgPrivacy] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [requestSettings, setRequestSettings] = useState(null);
  const [savingRequestSettings, setSavingRequestSettings] = useState(false);
  const [retention, setRetention] = useState(null);
  const [savingRetention, setSavingRetention] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilter, setAuditFilter] = useState('');
  const [loadErrors, setLoadErrors] = useState({});
  const requestIds = useRef({});
  // Admin subpages live in the URL (?tab=) so deep links and back/forward work.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'overview';
  // AI runs and the audit log are hidden from school admins; both are still
  // recorded, and their panels stay in the code for the platform team.
  const validTabs = ['overview', 'people', 'feedback', 'settings'];
  // Old links keep working: the KPIs now live on the Overview, Privacy in Settings.
  const tab = { kpis: 'overview', privacy: 'settings' }[rawTab] || (validTabs.includes(rawTab) ? rawTab : 'overview');
  function setTab(next) {
    if (!validTabs.includes(next) || next === tab) return;
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab'); else params.set('tab', next);
    setSearchParams(params);
  }
  const [importMode, setImportMode] = useState('insert');
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tempPasswordDialog, setTempPasswordDialog] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [managerDialog, setManagerDialog] = useState(null);
  const [managerEmailDraft, setManagerEmailDraft] = useState('');
  const [kpis, setKpis] = useState(null);
  const [kpisLoading, setKpisLoading] = useState(false);
  const [outreachSavingId, setOutreachSavingId] = useState(null);
  const [outreachTarget, setOutreachTarget] = useState({ email: '', persona: 'alumnus', cohort_term: 'All' });
  const [outreachTargetSaving, setOutreachTargetSaving] = useState(false);
  const fileRef = useRef(null);

  async function loadKpis() {
    const id = requestIds.current.kpis = (requestIds.current.kpis || 0) + 1;
    setKpisLoading(true);
    setLoadErrors(prev => ({ ...prev, kpis: false }));
    try {
      const res = await api.get('/admin/kpis');
      if (id === requestIds.current.kpis) setKpis(res.data);
    } catch {
      if (id === requestIds.current.kpis) { setKpis(null); setLoadErrors(prev => ({ ...prev, kpis: true })); }
    } finally {
      if (id === requestIds.current.kpis) setKpisLoading(false);
    }
  }

  // Headline, funnel and alumni to recruit: school-wide totals, none under five (0094).
  // The scorecard figures the KPIs do not already cover (0096).
  async function loadScorecard() {
    try {
      const res = await api.get('/admin/scorecard');
      setScorecard(res.data);
    } catch {
      setScorecard(null);
    }
  }

  async function loadProgramme() {
    try {
      const res = await api.get('/admin/programme');
      setProgramme(res.data);
      setProgrammeError(false);
    } catch {
      setProgramme(null);
      setProgrammeError(true);
    }
  }

  // Fields of study and the skills they take part in: groups only, no counts
  // below five and no people (migration 0092).
  async function loadFieldsOfStudy() {
    try {
      const res = await api.get('/admin/fields-of-study');
      setFieldsOfStudy(res.data);
    } catch {
      setFieldsOfStudy(null);
    }
  }

  async function loadStats() {
    setLoading(true);
    try {
      const res = await api.get('/admin/stats');
      setStats(res.data);
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    setUsersLoading(true);
    setLoadErrors(prev => ({ ...prev, people: false }));
    try {
      // Everyone, page by page: the filters below search the whole list.
      const all = [];
      for (let offset = 0; ; offset += 500) {
        const res = await api.get(`/admin/users?limit=500&offset=${offset}`);
        const page = res.data.users || [];
        all.push(...page);
        if (!page.length || all.length >= (res.data.total ?? all.length)) break;
      }
      setUsers(all);
    } catch {
      setLoadErrors(prev => ({ ...prev, people: true }));
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadAudit() {
    setAuditLoading(true);
    setLoadErrors(prev => ({ ...prev, audit: false }));
    try {
      const res = await api.get('/admin/audit?limit=100');
      setAuditEntries(res.data.entries || []);
      setAuditTotal(res.data.total || 0);
    } catch {
      setLoadErrors(prev => ({ ...prev, audit: true }));
    } finally { setAuditLoading(false); }
  }

  async function loadFeedback(status = feedbackFilter) {
    setFeedbackLoading(true);
    try {
      const params = status ? `?status=${encodeURIComponent(status)}` : '';
      const res = await api.get(`/admin/feedback${params}`);
      setFeedback(Array.isArray(res.data) ? res.data : []);
    } catch {
      setFeedback([]);
    } finally {
      setFeedbackLoading(false);
    }
  }

  async function updateFeedbackStatus(id, nextStatus) {
    setUpdatingFeedbackId(id);
    try {
      const res = await api.put(`/admin/feedback/${id}`, { status: nextStatus });
      setFeedback(prev => prev.map(f => f.id === id ? { ...f, ...res.data } : f));
    } finally {
      setUpdatingFeedbackId(null);
    }
  }

  async function updateOrgPrivacy(patch) {
    setSavingOrgPrivacy(true);
    try {
      await api.put('/admin/org-privacy', patch);
      await loadPrivacyStatus();
    } finally {
      setSavingOrgPrivacy(false);
    }
  }

  async function loadRequestSettings() {
    try {
      const res = await api.get('/admin/request-settings');
      setRequestSettings(res.data);
    } catch {
      setRequestSettings(null);
    }
  }

  // How long each kind of data is kept. Empty keeps it; the institution, as
  // data controller, decides the periods (migration 0089).
  async function loadRetention() {
    try {
      const res = await api.get('/admin/retention');
      setRetention(Object.fromEntries(RETENTION_FIELDS.map(field => [field, res.data?.[field] ?? ''])));
    } catch {
      setRetention(null);
    }
  }

  async function saveRetention() {
    if (!retention) return;
    const invalid = RETENTION_FIELDS.find(field => retention[field] !== '' && !(Number(retention[field]) >= 30 && Number(retention[field]) <= 3650 && Number.isInteger(Number(retention[field]))));
    if (invalid) {
      setNotice({ variant: 'destructive', title: t('admin.notice.actionFailedTitle'), message: t('admin.retention.invalid') });
      return;
    }
    setSavingRetention(true);
    try {
      const res = await api.put('/admin/retention', Object.fromEntries(RETENTION_FIELDS.map(field => [field, retention[field] === '' ? null : Number(retention[field])])));
      setRetention(Object.fromEntries(RETENTION_FIELDS.map(field => [field, res.data?.[field] ?? ''])));
      setNotice({ variant: 'default', title: t('admin.retention.saved'), message: t('admin.retention.savedHelp') });
    } catch (e) {
      setNotice({ variant: 'destructive', title: t('admin.notice.actionFailedTitle'), message: errorMessage(e, t, t('admin.common.tryAgain')) });
    } finally {
      setSavingRetention(false);
    }
  }

  async function saveRequestSettings() {
    if (!requestSettings) return;
    setSavingRequestSettings(true);
    try {
      const res = await api.put('/admin/request-settings', {
        weekly: Math.max(1, Number(requestSettings.weekly) || 1),
        pending: Math.max(1, Number(requestSettings.pending) || 1),
        cooldown: Math.max(0, Number(requestSettings.cooldown) || 0),
      });
      setRequestSettings(res.data);
      setNotice({ variant: 'default', title: t('admin.pm.capacitySaved'), message: t('admin.pm.capacitySavedHelp') });
    } catch (e) {
      setNotice({ variant: 'destructive', title: t('admin.notice.actionFailedTitle'), message: errorMessage(e, t, t('admin.common.tryAgain')) });
    } finally {
      setSavingRequestSettings(false);
    }
  }

  async function markOutreachTarget(userRecord) {
    setOutreachSavingId(userRecord.id);
    try {
      await api.post('/admin/outreach-targets', {
        profile_id: userRecord.id,
        email: userRecord.email,
        persona: userRecord.role || 'student',
        cohort_term: 'All',
      });
      setNotice({ variant: 'default', title: t('admin.pm.targetRecorded'), message: t('admin.pm.targetRecordedHelp', { name: userRecord.name }) });
      loadKpis();
    } catch (e) {
      setNotice({ variant: 'destructive', title: t('admin.notice.actionFailedTitle'), message: errorMessage(e, t, t('admin.common.tryAgain')) });
    } finally {
      setOutreachSavingId(null);
    }
  }

  async function addExternalOutreachTarget(event) {
    event.preventDefault();
    if (!outreachTarget.email.trim()) return;
    setOutreachTargetSaving(true);
    try {
      await api.post('/admin/outreach-targets', {
        profile_id: null,
        email: outreachTarget.email.trim(),
        persona: outreachTarget.persona,
        cohort_term: outreachTarget.cohort_term.trim() || 'All',
      });
      setOutreachTarget({ email: '', persona: outreachTarget.persona, cohort_term: outreachTarget.cohort_term || 'All' });
      setNotice({ variant: 'default', title: t('admin.pm.targetRecorded'), message: t('admin.pm.externalTargetRecordedHelp') });
      loadKpis();
    } catch (e) {
      setNotice({ variant: 'destructive', title: t('admin.notice.actionFailedTitle'), message: errorMessage(e, t, t('admin.common.tryAgain')) });
    } finally {
      setOutreachTargetSaving(false);
    }
  }


  async function loadPrivacyStatus() {
    setPrivacyLoading(true);
    try {
      const res = await api.get('/admin/privacy-status');
      setPrivacyStatus(res.data);
    } catch {
      setPrivacyStatus(null);
    } finally {
      setPrivacyLoading(false);
    }
  }

  useEffect(() => { loadStats(); loadFieldsOfStudy(); loadPrivacyStatus(); loadRetention(); loadRequestSettings(); }, []);
  useEffect(() => {
    if (tab === 'overview') { loadProgramme(); loadScorecard(); loadKpis(); }
    if (tab === 'people') loadUsers();
    if (tab === 'audit') loadAudit();
    if (tab === 'settings') loadRequestSettings();
    if (tab === 'feedback') loadFeedback();
  }, [tab]);

  async function handleUpload(file) {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.post(`/admin/upload?mode=${importMode}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadResult(res.data);
      loadStats();
    } catch (e) {
      setUploadError(errorMessage(e, t, t('admin.import.uploadFailed')));
    } finally {
      setUploading(false);
    }
  }

  async function handleRematch() {
    setRematching(true);
    setNotice(null);
    try {
      const res = await api.post('/admin/rematch');
      setNotice({ variant: 'default', title: t('admin.notice.matchingCompleteTitle'), message: res.data.message });
    } catch (e) {
      setNotice({
        variant: 'destructive',
        title: t('admin.notice.matchingFailedTitle'),
        message: errorMessage(e, t, t('admin.notice.matchingFailedMsg')),
      });
    } finally {
      setRematching(false);
    }
  }

  async function handleBroadcastCheckin() {
    setBroadcasting(true);
    setBroadcastResult(null);
    try {
      const res = await api.post('/admin/broadcast-checkin');
      setBroadcastResult(res.data);
      setTimeout(() => setBroadcastResult(null), 8000);
    } finally {
      setBroadcasting(false);
    }
  }

  function openResetPasswordConfirm(user) {
    setConfirmDialog({
      title: t('admin.dialog.resetTitle'),
      description: t('admin.dialog.resetDescription', { name: user.name }),
      confirmLabel: t('admin.dialog.resetConfirm'),
      onConfirm: async () => {
        const res = await api.post(`/admin/users/${user.id}/reset-password`);
        setTempPasswordDialog({
          email: res.data.email,
          tempPassword: res.data.tempPassword,
        });
      },
    });
  }

  // Changing someone between student and alumnus changes who they are matched
  // with, so it is a deliberate step with a confirmation, never a single click.
  function openRoleConfirm(user, role) {
    setConfirmDialog({
      title: t('admin.dialog.roleTitle', { role: t(`admin.users.role.${role}`) }),
      description: t('admin.dialog.roleDescription', { name: user.name, role: t(`admin.users.role.${role}`) }),
      confirmLabel: t('admin.dialog.roleConfirm', { role: t(`admin.users.role.${role}`) }),
      onConfirm: () => handleSetRole(user, role),
    });
  }

  function openDeactivateConfirm(user) {
    setConfirmDialog({
      title: t('admin.dialog.deactivateTitle'),
      description: t('admin.dialog.deactivateDescription', { name: user.name }),
      confirmLabel: t('admin.dialog.deactivateConfirm'),
      destructive: true,
      onConfirm: async () => {
        await api.put(`/admin/users/${user.id}`, { deactivate: true });
        loadUsers();
        setNotice({ variant: 'default', title: t('admin.notice.userDeactivatedTitle'), message: t('admin.notice.userDeactivatedMsg', { name: user.name }) });
      },
    });
  }

  // GDPR erasure on a member's request: their data goes, the other side of
  // shared conversations stays. Irreversible, unlike deactivation.
  function openEraseConfirm(user) {
    setConfirmDialog({
      title: t('admin.dialog.eraseTitle'),
      description: t('admin.dialog.eraseDescription', { name: user.name }),
      confirmLabel: t('admin.dialog.eraseConfirm'),
      destructive: true,
      onConfirm: async () => {
        await api.post(`/admin/users/${user.id}/erase`);
        loadUsers();
        setNotice({ variant: 'default', title: t('admin.notice.userErasedTitle'), message: t('admin.notice.userErasedMsg', { name: user.name }) });
      },
    });
  }

  function openSetManager(user) {
    setManagerEmailDraft(user.manager_email || '');
    setManagerDialog({ userId: user.id, userName: user.name });
  }

  async function handleSaveManager() {
    if (!managerDialog) return;
    try {
      await api.put(`/admin/users/${managerDialog.userId}`, { manager_email: managerEmailDraft.trim() });
      setManagerDialog(null);
      loadUsers();
      setNotice({ variant: 'default', title: t('admin.notice.managerUpdatedTitle'), message: t('admin.notice.managerUpdatedMsg') });
    } catch (e) {
      setNotice({
        variant: 'destructive',
        title: t('admin.notice.managerUpdateFailTitle'),
        message: errorMessage(e, t, t('admin.common.tryAgain')),
      });
    }
  }

  async function handleSetRole(user, role) {
    try {
      await api.put(`/admin/users/${user.id}`, { role });
      loadUsers();
      setNotice({ variant: 'default', title: t('admin.notice.roleUpdatedTitle'), message: t('admin.notice.roleUpdatedMsg', { name: user.name, role: t(`admin.users.role.${role}`) }) });
    } catch (e) {
      setNotice({
        variant: 'destructive',
        title: t('admin.notice.roleUpdateFailTitle'),
        message: errorMessage(e, t, t('admin.common.tryAgain')),
      });
    }
  }

  async function runConfirmDialog() {
    if (!confirmDialog) return;
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } catch (e) {
      setConfirmDialog(null);
      setNotice({
        variant: 'destructive',
        title: t('admin.notice.actionFailedTitle'),
        message: errorMessage(e, t, t('admin.notice.somethingWrong')),
      });
    }
  }

  const sessionsByStatus = stats?.sessionsByStatus?.reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {}) || {};
  // The database pools small groups under one name; it is shown in the reader's language.
  const fieldName = field => (!field || field === 'Other departments' ? t('admin.fields.other') : field);
  // The status lists fields by their technical names; admins read them in plain words.
  const privacyFieldLabels = fields => [...new Set((fields || []).map(field => {
    const key = PRIVACY_FIELD_KEYS[String(field).toLowerCase().replace(/\s*\(column-locked\)/, '').trim()];
    return key ? t(`admin.privacy.field.${key}`) : field;
  }))];
  const visibleSessionStatuses = ['pending', 'scheduled', 'completed'].map(status => sessionsByStatus[status]);
  const sessionsRequested = visibleSessionStatuses.every(Number.isInteger)
    ? visibleSessionStatuses.reduce((sum, count) => sum + count, 0) : null;
  // Without data there is nothing to say about the last 30 days; never imply "fewer than five".
  // Eight numbers in three groups; each carries its own plain explanation.
  const pm = key => metricEvidence(kpis, key);
  const percent = n => (n == null ? null : `${n}%`);
  const replyTime = hours => (hours == null ? null : hours < 24 ? t('admin.score.hours', { count: hours }) : t('admin.score.days', { count: Math.round((hours / 24) * 10) / 10 }));
  const engagement = pm('alumniEngagementRate');
  const reach = pm('connectionCoverageRate');
  const meaningful = pm('meaningfulConnections');
  const intent = pm('intentToContinueRate');
  const scorecardGroups = [
    { key: 'success', items: [
      { key: 'engagement', value: percent(engagement.value), sub: engagement.value != null && engagement.denominator ? t('admin.score.engagement.sub', { engaged: engagement.numerator, total: engagement.denominator }) : null },
      { key: 'acceptance', value: percent(programme?.headline?.acceptance_rate), sub: programme?.headline?.requests != null ? t('admin.headline.acceptanceSub', { count: programme.headline.requests }) : null },
      { key: 'reach', value: percent(reach.value), sub: reach.value != null && reach.denominator ? t('admin.score.reach.sub', { reached: reach.numerator, total: reach.denominator }) : null },
    ] },
    { key: 'impact', items: [
      { key: 'connections', value: meaningful.value, sub: scorecard?.new_connections_30d != null ? t('admin.headline.recent', { count: scorecard.new_connections_30d }) : null },
      { key: 'crossField', value: percent(scorecard?.cross_field_share), sub: scorecard?.cross_field_pairs != null ? t('admin.score.crossField.sub', { count: scorecard.cross_field_pairs }) : null },
      { key: 'benefit', value: percent(scorecard?.benefit_rate), sub: scorecard?.benefit_rate != null
        ? [t('admin.score.benefit.sub', { count: scorecard.benefit_answers }), intent.value != null && t('admin.score.benefit.intent', { rate: intent.value })].filter(Boolean).join(' · ') : null },
    ] },
    { key: 'scale', items: [
      { key: 'capacity', value: percent(scorecard?.capacity_used), sub: programme?.recruit?.length ? t('admin.score.capacity.sub', { count: programme.recruit.length }) : null },
      { key: 'reply', value: replyTime(scorecard?.median_reply_hours), sub: null },
    ] },
  ];

  const recentLine = n => (!programme ? undefined : n == null ? t('admin.headline.recentFew') : t('admin.headline.recent', { count: n }));
  // The step where the most people are lost, measured against the one before.
  const biggestDrop = (() => {
    const steps = programme?.funnel || [];
    let worst = null; let lost = 0;
    for (let i = 1; i < steps.length; i += 1) {
      const before = steps[i - 1].count; const now = steps[i].count;
      if (before && now != null && before - now > lost) { lost = before - now; worst = steps[i].step; }
    }
    return worst;
  })();

  // Each column of the users table can be searched; filters combine.
  const userFieldOptions = useMemo(() => [...new Set(users.map(u => u.department).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [users]);
  const filteredUsers = useMemo(() => {
    const has = (value, needle) => !needle.trim() || String(value || '').toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
    return users.filter(u => has(u.name, userFilters.name) && has(u.email, userFilters.email) && has(u.manager_email, userFilters.advisor)
      && (!userFilters.field || (userFilters.field === '__none' ? !u.department : u.department === userFilters.field))
      && (!userFilters.role || (u.role || 'student') === userFilters.role));
  }, [users, userFilters]);
  const filtering = Object.values(userFilters).some(Boolean);
  const setUserFilter = (key, value) => setUserFilters(current => ({ ...current, [key]: value }));
  const isPlatformAdmin = user?.admin_scope === 'platform';

  return (
    <PageShell className="admin-page gap-0" title={t('admin.pageTitle')} description={t('admin.pageDescription')}
      action={isPlatformAdmin && <ButtonLink to="/admin/ops" variant="outline" size="sm" data-testid="nav-platform-ops">{t('admin.ops.link')} →</ButtonLink>}>

      {notice && (
        <Alert variant={notice.variant} className="relative pr-20">
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2"
            onClick={() => setNotice(null)}
          >
            {t('admin.dismiss')}
          </Button>
        </Alert>
      )}

      <div className="profile-workspace">
      <PageTabs idPrefix="admin" label={t('admin.tabs.label')}
        tabs={validTabs.map(key => ({ key, label: t(`admin.tab.${key}`) }))}
        value={tab} onChange={setTab} />

      <div key={tab} id={`admin-panel-${tab}`} role="tabpanel" aria-labelledby={`admin-tab-${tab}`} tabIndex={0}
        className="profile-tab-content page-frame page-frame-body">
      {tab === 'settings' && (
        <>
          <Surface className="profile-section">
            <SurfaceHeader
              title={t('admin.privacy.title')}
              description={t('admin.privacy.description')}
              action={
                <Button type="button" variant="outline" size="sm" onClick={loadPrivacyStatus} disabled={privacyLoading}>
                  {privacyLoading ? t('admin.privacy.checking') : t('admin.common.refresh')}
                </Button>
              }
            />
            <SurfaceBody className="pt-5">
              {privacyLoading && !privacyStatus ? (
                <p className="text-sm text-muted-foreground">{t('admin.common.loading')}</p>
              ) : privacyStatus ? (
                <div className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <section className="rounded-[var(--panel-radius)] border border-[var(--border)] p-4" data-testid="privacy-visible">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Eye className="size-4 text-[var(--status-scheduled-fg)]" />{t('admin.privacy.peerVisible')}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{t('admin.privacy.peerVisibleHelp')}</p>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {privacyFieldLabels(privacyStatus.peerVisibleFields).map(label => <li key={label}><Badge className="bg-[var(--status-scheduled-bg)] text-[var(--status-scheduled-fg)]">{label}</Badge></li>)}
                      </ul>
                    </section>
                    <section className="rounded-[var(--panel-radius)] border border-[var(--border)] p-4" data-testid="privacy-hidden">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Lock className="size-4 text-[var(--ink)]" />{t('admin.privacy.hidden')}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{t('admin.privacy.hiddenHelp')}</p>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {privacyFieldLabels(privacyStatus.hiddenFields).map(label => <li key={label}><Badge variant="secondary">{label}</Badge></li>)}
                      </ul>
                    </section>
                  </div>
                  <ul className="space-y-2 text-sm text-foreground">
                    <li className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[var(--mint)]" />{t('admin.pm.privacyHelp')}</li>
                    <li className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[var(--mint)]" />{t('admin.pm.consentHelp')}</li>
                  </ul>
                  <div className="grid gap-4 md:grid-cols-2">
                    <section className="rounded-[var(--panel-radius)] border border-[var(--border)] p-4">
                      <h3 className="text-sm font-semibold">{t('admin.pm.schoolControls')}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{t('admin.privacy.minReportsHelp')}</p>
                      <label htmlFor="admin-min-reports" className="mt-3 grid gap-1 text-xs text-muted-foreground">
                        {t('admin.privacy.minReports')}
                        <Input
                          id="admin-min-reports"
                          key={privacyStatus.minTeamDashboardSize}
                          type="number" min={1} max={100}
                          defaultValue={privacyStatus.minTeamDashboardSize ?? 3}
                          data-testid="min-team-size-input"
                          className="input h-9 w-24 text-sm"
                          disabled={savingOrgPrivacy}
                          onBlur={(e) => {
                            const v = Math.max(1, Math.min(100, Number(e.target.value) || 3));
                            if (v !== (privacyStatus.minTeamDashboardSize ?? 3)) {
                              updateOrgPrivacy({ min_team_dashboard_size: v });
                            }
                          }}
                        />
                      </label>
                    </section>
                    <section className="rounded-[var(--panel-radius)] border border-[var(--border)] p-4">
                      <h3 className="text-sm font-semibold">{t('admin.pm.capacityTitle')}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{t('admin.pm.capacityHelp')}</p>
                      {requestSettings && (
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          {[
                            ['weekly', 'admin.pm.weeklyLimit', 1, 100],
                            ['pending', 'admin.pm.pendingLimit', 1, 50],
                            ['cooldown', 'admin.pm.cooldownDays', 0, 365],
                          ].map(([field, label, min, max]) => (
                            <label key={field} className="grid gap-1 text-xs text-muted-foreground">
                              {t(label)}
                              <Input
                                type="number"
                                min={min}
                                max={max}
                                value={requestSettings[field] ?? ''}
                                disabled={savingRequestSettings}
                                onChange={(e) => setRequestSettings((current) => ({ ...current, [field]: e.target.value }))}
                                className="input h-9 w-24 text-sm"
                              />
                            </label>
                          ))}
                          <Button type="button" size="sm" onClick={saveRequestSettings} disabled={savingRequestSettings}>
                            {savingRequestSettings ? t('admin.common.saving') : t('admin.pm.saveCapacity')}
                          </Button>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('admin.privacy.unavailable')}</p>
              )}
            </SurfaceBody>
          </Surface>

          <Surface className="profile-section" data-testid="data-retention">
            <SurfaceHeader title={t('admin.retention.title')} description={t('admin.retention.description')} />
            <SurfaceBody className="pt-5">
              {retention ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {RETENTION_FIELDS.map(field => (
                    <label key={field} className="grid gap-1 text-sm">
                      <span className="font-medium text-foreground">{t(`admin.retention.${field}`)}</span>
                      <span className="text-xs text-muted-foreground">{t(`admin.retention.${field}Help`)}</span>
                      <span className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={30}
                          max={3650}
                          inputMode="numeric"
                          placeholder={t('admin.retention.keep')}
                          value={retention[field]}
                          disabled={savingRetention}
                          data-testid={`retention-${field}`}
                          onChange={e => setRetention(current => ({ ...current, [field]: e.target.value }))}
                          className="input h-9 w-32 text-sm"
                        />
                        <span className="text-xs text-muted-foreground">{t('admin.retention.days')}</span>
                      </span>
                    </label>
                  ))}
                  <div className="sm:col-span-2 flex justify-end">
                    <Button type="button" size="sm" onClick={saveRetention} disabled={savingRetention} data-testid="save-retention">
                      {savingRetention ? t('admin.common.saving') : t('admin.retention.save')}
                    </Button>
                  </div>
                </div>
              ) : <p className="text-sm text-muted-foreground">{t('admin.retention.unavailable')}</p>}
            </SurfaceBody>
          </Surface>

          {/* The weekly reflection reminder: automatic, with a manual send. */}
          <SurfacePanel
            className="profile-section"
            title={t('admin.broadcast.title')}
            description={t('admin.broadcast.description')}
            action={
              <Button onClick={handleBroadcastCheckin} disabled={broadcasting} size="sm" className="shrink-0 whitespace-nowrap">
                {broadcasting ? t('admin.broadcast.sending') : t('admin.broadcast.send')}
              </Button>
            }
          >
            {broadcastResult && (
              <p className="inline-flex flex-wrap items-center gap-2 rounded-[var(--item-radius)] border border-[var(--border)] px-3 py-2 text-sm text-muted-foreground">
                <span>✓“</span>
                <span>{broadcastResult.message}</span>
                <span>{t('admin.broadcast.resultHint')}</span>
              </p>
            )}
          </SurfacePanel>

          {/* Matching is recomputed automatically; a manual run is for the platform team. */}
          {isPlatformAdmin && (
            <SurfacePanel
              className="profile-section"
              title={t('admin.rematch.title')}
              description={t('admin.rematch.description')}
              action={
                <Button type="button" variant="outline" size="sm" onClick={handleRematch} disabled={rematching} data-testid="rematch-btn">
                  {rematching ? t('admin.rematch.computing') : t('admin.rematch.action')}
                </Button>
              }
            />
          )}
          </>
      )}

      {tab === 'overview' && (
        <>
          {/* The programme in one view: a line of totals, then eight numbers in
              three groups (is it working, what ESSEC gains, will it hold). */}
          {loading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {[1, 2, 3].map(i => <div key={i} className="h-64 animate-pulse rounded-[var(--panel-radius)] border border-[var(--border)] bg-muted" />)}
            </div>
          ) : stats && (
            <>
              {programmeError && <p role="status" data-testid="programme-unavailable" className="rounded-[var(--item-radius)] border border-[var(--border)] bg-card px-4 py-3 text-sm text-muted-foreground">{t('admin.programme.unavailable')}</p>}

              <Surface className="profile-section" data-testid="scorecard">
                <SurfaceHeader title={t('admin.scorecard.title')} description={t('admin.scorecard.description')}
                  action={<Button type="button" variant="outline" size="sm" onClick={() => exportScorecard(scorecardGroups, t)} data-testid="scorecard-export">{t('admin.scorecard.export')}</Button>} />
                <SurfaceBody className="pt-5">
                  {/* One grid for all three groups, so tiles line up row by row;
                      on a phone each group simply stacks. */}
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 lg:grid-cols-3">
                    {scorecardGroups.map((group, column) => (
                      <section key={group.key} data-testid={`scorecard-${group.key}`} aria-labelledby={`scorecard-${group.key}-title`} className="mb-4 lg:contents">
                        <div className={`${SCORE_COLUMNS[column]} lg:row-start-1`}>
                          <h3 id={`scorecard-${group.key}-title`} className="text-[11px] font-semibold uppercase leading-4 tracking-wide text-muted-foreground">
                            {t(`admin.scorecard.group.${group.key}`)}<span className="font-normal normal-case tracking-normal"> · {t(`admin.scorecard.group.${group.key}Help`)}</span>
                          </h3>
                        </div>
                        <ul className="mt-2 space-y-2 lg:contents">
                          {group.items.map((item, row) => (
                            <li key={item.key} data-testid={`score-${item.key}`} className={`${SCORE_COLUMNS[column]} ${SCORE_ROWS[row]} flex h-full flex-col rounded-[var(--item-radius)] border border-[var(--border)] bg-card px-3.5 py-3`}>
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="text-sm font-medium text-foreground">{t(`admin.score.${item.key}.label`)}</p>
                                {item.value == null
                                  ? <span className="shrink-0 text-xs text-muted-foreground">{t('admin.scorecard.notEnough')}</span>
                                  : <span className="shrink-0 text-xl font-semibold tabular-nums leading-none text-foreground">{item.value}</span>}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">{item.sub || t(`admin.score.${item.key}.means`)}</p>
                              <details className="mt-1 text-[11px] text-muted-foreground">
                                <summary className="w-fit cursor-pointer">{t('admin.scorecard.howCounted')}</summary>
                                <p className="mt-1">{t(`admin.score.${item.key}.counted`)}</p>
                              </details>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </SurfaceBody>
              </Surface>

              <div className="mt-10 grid grid-cols-1 items-start gap-6 border-t border-[var(--border-subtle)] pt-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <Surface className="profile-section" data-testid="funnel">
                  <SurfaceHeader title={t('admin.funnel.title')} description={t('admin.funnel.description')} />
                  <SurfaceBody className="pt-5">
                    {programme?.funnel?.length ? (
                      <ol className="space-y-3">
                        {programme.funnel.map((step, index) => {
                          const top = programme.funnel[0]?.count;
                          const share = step.count != null && top ? Math.round((step.count / top) * 100) : null;
                          return (
                            <li key={step.step} data-testid="funnel-step" className={step.step === biggestDrop ? '-mx-2 rounded-[var(--item-radius)] bg-[var(--status-attention-bg)] px-2 py-1' : ''}>
                              <div className="mb-1 flex justify-between gap-2 text-sm">
                                <span className="font-medium text-foreground">{index + 1}. {t(`admin.funnel.${step.step}`)}</span>
                                <span className="tabular-nums text-muted-foreground">{step.count == null ? t('admin.funnel.few') : `${step.count}${share != null && index > 0 ? ` · ${share}%` : ''}`}</span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-muted">
                                {share != null && <div className="h-full rounded-full bg-[var(--ink)]" style={{ width: `${share}%` }} />}
                              </div>
                              {step.step === biggestDrop && <p className="mt-1 text-xs text-[var(--status-attention-fg)]" data-testid="funnel-drop">{t('admin.funnel.biggestDrop')}</p>}
                            </li>
                          );
                        })}
                      </ol>
                    ) : <p className="text-sm text-muted-foreground">{t(programme ? 'admin.fields.empty' : 'admin.programme.notLoaded')}</p>}
                  </SurfaceBody>
                </Surface>

                <Surface className="profile-section" data-testid="recruit">
                  <SurfaceHeader title={t('admin.recruit.title')} description={t('admin.recruit.description')} />
                  <SurfaceBody className="pt-5">
                    {programme?.recruit?.length ? (
                      <ul className="divide-y divide-[var(--border-subtle)]">
                        {programme.recruit.map(gap => (
                          <li key={gap.skill} data-testid="recruit-row" className="py-2.5">
                            <p className="text-sm font-semibold text-foreground">{gap.skill}</p>
                            <p className="text-xs text-muted-foreground">
                              {t('admin.recruit.wanted', { count: gap.wanted })} · {gap.offered == null ? t('admin.recruit.offeredFew') : t('admin.recruit.offered', { count: gap.offered })}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted-foreground">{t(programme ? 'admin.recruit.empty' : 'admin.programme.notLoaded')}</p>}
                  </SurfaceBody>
                </Surface>
              </div>

              <div className="mt-10 grid grid-cols-1 items-start gap-6 border-t border-[var(--border-subtle)] pt-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                {/* Groups, never people: each field of study with its size
                    (five or more) and thresholded completed-meeting activity. */}
                <Surface className="profile-section" data-testid="fields-of-study">
                  <SurfaceHeader title={t('admin.fields.title')} description={t('admin.fields.description')}
                    action={<SectionToggle open={fieldsOpen} onToggle={() => setFieldsOpen(open => !open)} label={t('admin.fields.title')} testId="fields-of-study-toggle" />} />
                  {fieldsOpen && <SurfaceBody className="pt-5">
                  {fieldsOfStudy?.fields?.length > 0 ? (
                    <ul className="divide-y divide-[var(--border-subtle)]">
                      {fieldsOfStudy.fields.map(f => (
                        <li key={f.field ?? ''} data-testid="field-of-study-row" className="flex items-center justify-between gap-3 py-2.5 text-sm">
                          <span className="min-w-0 truncate font-medium text-foreground">{fieldName(f.field)}</span>
                          <span className="flex shrink-0 items-center gap-3">
                            <span className="tabular-nums text-muted-foreground">{t('admin.fields.members', { count: f.members })}</span>
                            <Badge variant={f.active ? 'secondary' : 'outline'} className={f.active ? 'bg-[var(--status-scheduled-bg)] text-[var(--status-scheduled-fg)]' : 'text-muted-foreground'}>
                              {f.active ? t('admin.fields.active') : t('admin.fields.quiet')}
                            </Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted-foreground">{t('admin.fields.empty')}</p>}
                  </SurfaceBody>}
                </Surface>

                {/* Which fields of study offer, want and meet on each skill:
                    lists of groups, without counts. */}
                <Surface className="profile-section" data-testid="skills-by-field">
                  <SurfaceHeader title={t('admin.skillsByField.title')} description={t('admin.skillsByField.description')}
                    action={<SectionToggle open={skillsOpen} onToggle={() => setSkillsOpen(open => !open)} label={t('admin.skillsByField.title')} testId="skills-by-field-toggle" />} />
                  {skillsOpen && <SurfaceBody className="pt-5">
                  {fieldsOfStudy?.skills?.length > 0 ? (
                    <>
                      <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {SKILL_ROLES.map(role => <span key={role.key} className="flex items-center gap-1.5"><i className={`inline-block size-2.5 rounded-full ${role.dot}`} />{t(`admin.skillsByField.${role.key}`)}</span>)}
                      </div>
                      <ul className="space-y-4">
                        {fieldsOfStudy.skills.map(skill => (
                          <li key={skill.skill} data-testid="skill-by-field-row">
                            <p className="text-sm font-semibold text-foreground">{skill.skill}</p>
                            <div className="mt-1.5 space-y-1">
                              {SKILL_ROLES.filter(role => skill[role.key]?.length).map(role => (
                                <div key={role.key} className="flex flex-wrap items-center gap-1.5">
                                  <span className="w-20 shrink-0 text-xs text-muted-foreground">{t(`admin.skillsByField.${role.key}`)}</span>
                                  {skill[role.key].map(field => (
                                    <Badge key={field ?? ''} variant="secondary" className={role.chip}>{fieldName(field)}</Badge>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : <p className="text-sm text-muted-foreground">{t('admin.skillsByField.empty')}</p>}
                  </SurfaceBody>}
                </Surface>
              </div>
            </>
          )}

          </>
      )}


      {tab === 'audit' && (
        <Surface className="profile-section">
          <SurfaceHeader
            title={t('admin.audit.title')}
            description={
              <>
                {t('admin.pm.auditHelp')}
                {auditTotal > 0 && <span className="ml-1 text-muted-foreground/80">{t('admin.audit.totalEvents', { count: auditTotal })}</span>}
              </>
            }
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => downloadBlob('/admin/audit/export', 'ment-audit-export.csv')}>
                {t('admin.audit.exportCsv')}
              </Button>
            }
          />
          <SurfaceBody className="pt-5">
            <Label htmlFor="admin-audit-filter">{t('admin.pm.auditFilter')}</Label>
            <Input id="admin-audit-filter" type="search" value={auditFilter} onChange={e => setAuditFilter(e.target.value)} className="my-3" />
            {auditLoading ? <p role="status">{t('admin.common.loading')}</p> : loadErrors.audit ? <p role="alert">{t('admin.pm.loadFailed')} <Button variant="link" onClick={loadAudit}>{t('admin.common.refresh')}</Button></p> : auditEntries.filter(entry => `${entry.action || ''} ${entry.actor?.name || ''} ${entry.actor?.email || ''}`.toLowerCase().includes(auditFilter.toLowerCase())).length === 0 ? (
              <p className="text-sm text-muted-foreground italic">{t('admin.audit.empty')}</p>
            ) : (
              <div className="max-h-96 divide-y divide-[var(--border-subtle)] overflow-y-auto">
                {auditEntries.filter(entry => `${entry.action || ''} ${entry.actor?.name || ''} ${entry.actor?.email || ''}`.toLowerCase().includes(auditFilter.toLowerCase())).map(entry => <AuditRow key={entry.id} entry={entry} />)}
              </div>
            )}
          </SurfaceBody>
        </Surface>
      )}

      {tab === 'ai' && <AdminAiRuns t={t} />}

      {tab === 'people' && (
        <Surface className="profile-section">
          <SurfaceHeader
            title={t('admin.users.title')}
            action={
              <Button type="button" variant="outline" size="sm" aria-expanded={addPeopleOpen} aria-controls="add-people" data-testid="add-people-toggle" onClick={() => setAddPeopleOpen(open => !open)}>
                {addPeopleOpen ? <ChevronUp /> : <Plus />}{addPeopleOpen ? t('admin.users.addPeopleClose') : t('admin.users.addPeople')}
              </Button>
            }
          />
          <SurfaceBody className="pt-5">
          {/* Adding people is occasional; the list is what admins come for. */}
          {addPeopleOpen && (
            <div id="add-people" data-testid="add-people" className="mb-6">
            <AdminProvisionUserPanel />
            <AdminInvitationPanel />
            <form onSubmit={addExternalOutreachTarget} className="mb-5 flex flex-wrap items-end gap-3 rounded-[var(--panel-radius)] border border-border bg-card p-4">
              <div className="min-w-56 flex-1">
                <Label htmlFor="outreach-email">{t('admin.pm.externalTargetEmail')}</Label>
                <Input id="outreach-email" type="email" required value={outreachTarget.email} onChange={(e) => setOutreachTarget((current) => ({ ...current, email: e.target.value }))} placeholder="alumni@example.edu" className="mt-1" />
              </div>
              <label className="grid gap-1 text-sm font-medium">
                {t('admin.pm.externalTargetPersona')}
                <select className="input h-10" value={outreachTarget.persona} onChange={(e) => setOutreachTarget((current) => ({ ...current, persona: e.target.value }))}>
                  <option value="alumnus">{t('admin.users.role.alumnus')}</option>
                  <option value="student">{t('admin.users.role.student')}</option>
                </select>
              </label>
              <div>
                <Label htmlFor="outreach-cohort">{t('admin.pm.externalTargetCohort')}</Label>
                <Input id="outreach-cohort" value={outreachTarget.cohort_term} onChange={(e) => setOutreachTarget((current) => ({ ...current, cohort_term: e.target.value }))} className="mt-1 w-28" />
              </div>
              <Button type="submit" disabled={outreachTargetSaving}>{outreachTargetSaving ? t('admin.common.saving') : t('admin.pm.addExternalTarget')}</Button>
            </form>
            </div>
          )}
          {usersLoading ? <p className="text-sm text-muted-foreground">{t('admin.common.loading')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">{t('admin.users.name')}</th>
                    <th className="py-2 pr-4">{t('admin.users.email')}</th>
                    <th className="py-2 pr-4">{t('admin.users.dept')}</th>
                    <th className="py-2 pr-4">{t('admin.users.role.title')}</th>
                    <th className="py-2 pr-4">{t('admin.users.manager')}</th>
                    <th className="py-2 text-right">{t('admin.users.actions')}</th>
                  </tr>
                  <tr className="border-b" data-testid="user-filters">
                    <th className="py-2 pr-4 font-normal"><Input className="h-8 w-full min-w-28 text-xs" placeholder={t('admin.users.filterSearch')} aria-label={t('admin.users.filterBy', { column: t('admin.users.name') })} value={userFilters.name} onChange={e => setUserFilter('name', e.target.value)} data-testid="filter-name" /></th>
                    <th className="py-2 pr-4 font-normal"><Input className="h-8 w-full min-w-32 text-xs" placeholder={t('admin.users.filterSearch')} aria-label={t('admin.users.filterBy', { column: t('admin.users.email') })} value={userFilters.email} onChange={e => setUserFilter('email', e.target.value)} data-testid="filter-email" /></th>
                    <th className="py-2 pr-4 font-normal">
                      <select className="input h-8 w-full min-w-28 text-xs" aria-label={t('admin.users.filterBy', { column: t('admin.users.dept') })} value={userFilters.field} onChange={e => setUserFilter('field', e.target.value)} data-testid="filter-field">
                        <option value="">{t('admin.users.filterAll')}</option>
                        {userFieldOptions.map(field => <option key={field} value={field}>{field}</option>)}
                        <option value="__none">{t('admin.users.filterNone')}</option>
                      </select>
                    </th>
                    <th className="py-2 pr-4 font-normal">
                      <select className="input h-8 w-full min-w-24 text-xs" aria-label={t('admin.users.filterBy', { column: t('admin.users.role.title') })} value={userFilters.role} onChange={e => setUserFilter('role', e.target.value)} data-testid="filter-role">
                        <option value="">{t('admin.users.filterAll')}</option>
                        <option value="student">{t('admin.users.role.student')}</option>
                        <option value="alumnus">{t('admin.users.role.alumnus')}</option>
                      </select>
                    </th>
                    <th className="py-2 pr-4 font-normal"><Input className="h-8 w-full min-w-24 text-xs" placeholder={t('admin.users.filterSearch')} aria-label={t('admin.users.filterBy', { column: t('admin.users.manager') })} value={userFilters.advisor} onChange={e => setUserFilter('advisor', e.target.value)} data-testid="filter-advisor" /></th>
                    <th className="py-2 text-right font-normal">
                      {filtering && <Button type="button" variant="ghost" size="sm" onClick={() => setUserFilters({ name: '', email: '', field: '', role: '', advisor: '' })} data-testid="filter-clear">{t('admin.users.filterClear')}</Button>}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">{t('admin.users.filterEmpty')}</td></tr>
                  )}
                  {filteredUsers.map(u => (
                    <tr key={u.id} className="border-b border-[var(--border-subtle)]">
                      <td className="py-2 pr-4">{u.name}{u.deactivated_at ? t('admin.users.deactivatedSuffix') : ''}</td>
                      <td className="py-2 pr-4 text-secondary-foreground">{u.email}</td>
                      <td className="py-2 pr-4">{u.department}</td>
                      <td className="py-2 pr-4">
                        {u.deactivated_at ? (
                          <span className="text-muted-foreground">{t(`admin.users.role.${u.role || 'student'}`)}</span>
                        ) : (
                          <Badge data-testid={`role-${u.id}`} variant="secondary" className={u.role === 'alumnus' ? '' : 'bg-[var(--status-scheduled-bg)] text-[var(--status-scheduled-fg)]'}>{t(`admin.users.role.${u.role || 'student'}`)}</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-secondary-foreground">{u.manager_email || <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2 text-right">
                        <ActionMenu label={t('admin.users.actions')} testId={`actions-${u.id}`} items={[
                          ...(!u.deactivated_at ? [
                            { label: t(u.role === 'alumnus' ? 'admin.users.makeStudent' : 'admin.users.makeAlumnus'), onSelect: () => openRoleConfirm(u, u.role === 'alumnus' ? 'student' : 'alumnus'), testId: `change-role-${u.id}` },
                            { label: t('admin.users.setManager'), onSelect: () => openSetManager(u) },
                            { label: outreachSavingId === u.id ? t('admin.common.saving') : t('admin.pm.markInvited'), onSelect: () => markOutreachTarget(u), disabled: outreachSavingId === u.id },
                            { label: t('admin.users.resetPassword'), onSelect: () => openResetPasswordConfirm(u) },
                            { label: t('admin.users.deactivate'), onSelect: () => openDeactivateConfirm(u), destructive: true },
                          ] : []),
                          // An erased login keeps only a placeholder address.
                          ...(!u.email?.endsWith('@erased.invalid') ? [
                            { label: t('admin.users.erase'), onSelect: () => openEraseConfirm(u), destructive: true, testId: `erase-user-${u.id}` },
                          ] : []),
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground" data-testid="users-count">{t('admin.users.showing', { shown: filteredUsers.length, total: users.length })}</p>
            </div>
          )}
          </SurfaceBody>
        </Surface>
      )}

      {tab === 'people' && (
        <>
          {/* Import, below the list: an occasional task. */}
          <Surface className="profile-section">
            <SurfaceHeader
              title={t('admin.import.title')}
              description={t('admin.import.description')}
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => downloadBlob('/admin/template', 'ment-import-template.csv')}>
                  {t('admin.import.downloadTemplate')}
                </Button>
              }
            />
            <SurfaceBody className="space-y-4 pt-5">

            <div className="mb-4 rounded-[var(--item-radius)] bg-muted p-3 font-mono text-xs text-muted-foreground">
              name, email, department, current_role, program, cohort_year, persona (student|alumnus), tenure_years, location, manager_email, can_teach, wants_to_learn
            </div>

            <div className="flex gap-4 mb-4 text-sm">
              {['insert', 'upsert', 'update'].map(m => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="importMode" checked={importMode === m} onChange={() => setImportMode(m)} />
                  <span>{t(`admin.import.mode.${m}`)}</span>
                </label>
              ))}
            </div>

            <div
              className={`cursor-pointer rounded-[var(--panel-radius)] border-2 border-dashed p-10 text-center transition-colors ${dragOver ? 'border-primary bg-accent' : 'border-border hover:border-primary hover:bg-background'}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleUpload(file);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); e.target.value = ''; }}
              />
              {uploading ? (
                <div className="space-y-2">
                  <div className="mx-auto size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <p className="text-sm text-muted-foreground">{t('admin.import.processing')}</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-secondary-foreground">{t('admin.import.dropzone')}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t('admin.import.maxSize')}</p>
                </div>
              )}
            </div>

            {uploadResult && (
              <div className="mt-4 rounded-[var(--item-radius)] border border-[var(--border)] p-4 text-sm">
                <p className="mb-1 font-medium">{t('admin.import.complete')}</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>✓“ {uploadResult.updated
                    ? t('admin.import.importedUpdatedLine', { imported: uploadResult.imported, updated: uploadResult.updated, skipped: uploadResult.skipped })
                    : t('admin.import.importedLine', { imported: uploadResult.imported, skipped: uploadResult.skipped })}</li>
                  <li>✓“ {t('admin.import.matchesLine', { matches: uploadResult.matchesGenerated })}</li>
                  {uploadResult.tempPasswords?.map(({ email, password }) => (
                    <li key={email} className="break-all">{email}: <code className="rounded bg-muted px-1 font-mono text-foreground">{password}</code></li>
                  ))}
                </ul>
                {uploadResult.failures?.length > 0 && <div className="mt-3 border-t border-border pt-3 text-destructive">
                  <p className="font-medium">{uploadResult.failures.length} row(s) need attention</p>
                  <ul className="mt-1 space-y-1">{uploadResult.failures.map((failure, index) => <li key={`${failure.row}-${index}`}>Row {failure.row} ({failure.email || 'no email'}): {failure.error}</li>)}</ul>
                </div>}
                {uploadResult.warnings?.length > 0 && <p role="status" className="mt-3 text-[var(--status-waiting-fg)]">Some secondary tasks need attention: {uploadResult.warnings.join(', ')}</p>}
              </div>
            )}

            {uploadError && (
              <div className="rounded-[var(--item-radius)] border border-[var(--border)] bg-[var(--status-error-bg)] p-4 text-sm text-[var(--status-error-fg)]">{uploadError}</div>
            )}
            </SurfaceBody>
          </Surface>
          </>
      )}

      {tab === 'feedback' && (
        <Surface className="profile-section">
          <SurfaceHeader
            title={t('admin.feedback.title')}
            description={
              feedback.length
                ? (feedback.length === 1
                    ? t('admin.feedback.descriptionOne', { count: feedback.length })
                    : t('admin.feedback.descriptionMany', { count: feedback.length }))
                : t('admin.feedback.descriptionEmpty')
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input filter-control w-44 text-sm"
                  value={feedbackFilter}
                  onChange={e => { setFeedbackFilter(e.target.value); loadFeedback(e.target.value); }}
                >
                  <option value="">{t('admin.feedback.allStatuses')}</option>
                  <option value="new">{t('admin.feedback.statusNew')}</option>
                  <option value="reviewing">{t('admin.feedback.statusReviewing')}</option>
                  <option value="resolved">{t('admin.feedback.statusResolved')}</option>
                </select>
                <Button type="button" variant="outline" size="sm" className="filter-control" onClick={() => loadFeedback(feedbackFilter)} disabled={feedbackLoading}>
                  {feedbackLoading ? t('admin.common.refreshing') : t('admin.common.refresh')}
                </Button>
              </div>
            }
          />
          <SurfaceBody className="pt-5">
            <p className="mb-4 rounded-[var(--item-radius)] border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{t('admin.pm.feedbackInbox')}</p>
            {feedbackLoading ? (
              <p className="text-sm text-muted-foreground">{t('admin.common.loading')}</p>
            ) : feedback.length ? (
              <ul className="space-y-3">
                {feedback.map(item => (
                  <li
                    key={item.id}
                    data-testid="feedback-item"
                    className="rounded-[var(--panel-radius)] border border-border bg-card/40 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium uppercase tracking-wide text-foreground">{item.category}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{item.user?.name || t('admin.feedback.unknownUser')}</span>
                          {item.user?.department && (
                            <>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground">{item.user.department}</span>
                            </>
                          )}
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{formatAdminDate(item.created_at)}</span>
                          <Badge variant="secondary">{t(`admin.pm.delivery.${item.delivery?.status || 'demo'}`)}</Badge>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.message}</p>
                      </div>
                      <select
                        className="input filter-control w-44 text-sm"
                        value={item.status}
                        disabled={updatingFeedbackId === item.id}
                        onChange={e => updateFeedbackStatus(item.id, e.target.value)}
                      >
                        <option value="new">{t('admin.feedback.statusNew')}</option>
                        <option value="reviewing">{t('admin.feedback.statusReviewing')}</option>
                        <option value="resolved">{t('admin.feedback.statusResolved')}</option>
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('admin.feedback.empty')}</p>
            )}
          </SurfaceBody>
        </Surface>
      )}

      <Dialog open={!!confirmDialog} onOpenChange={open => { if (!open) setConfirmDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
            <DialogDescription>{confirmDialog?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDialog(null)}>{t('admin.common.cancel')}</Button>
            <Button
              type="button"
              variant={confirmDialog?.destructive ? 'destructive' : 'default'}
              onClick={runConfirmDialog}
            >
              {confirmDialog?.confirmLabel || t('admin.dialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!tempPasswordDialog} onOpenChange={open => { if (!open) setTempPasswordDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.tempPwd.title')}</DialogTitle>
            <DialogDescription>
              {t('admin.tempPwd.description', { email: tempPasswordDialog?.email })}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[var(--item-radius)] border bg-muted px-3 py-2 font-mono text-sm">{tempPasswordDialog?.tempPassword}</div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(tempPasswordDialog?.tempPassword || '');
              }}
            >
              {t('admin.tempPwd.copy')}
            </Button>
            <Button type="button" onClick={() => setTempPasswordDialog(null)}>{t('admin.tempPwd.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!managerDialog} onOpenChange={open => { if (!open) setManagerDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.manager.title')}</DialogTitle>
            <DialogDescription>{t('admin.manager.description', { name: managerDialog?.userName })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="manager-email">{t('admin.manager.label')}</Label>
            <Input
              id="manager-email"
              type="email"
              value={managerEmailDraft}
              onChange={e => setManagerEmailDraft(e.target.value)}
              placeholder="manager@company.com"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManagerDialog(null)}>{t('admin.common.cancel')}</Button>
            <Button type="button" onClick={handleSaveManager}>{t('admin.manager.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </div>
      </div>
    </PageShell>
  );
}

function AuditRow({ entry }) {
  const { t } = useT();
  const when = formatAdminDate(entry.created_at, pmTranslate(t, 'admin.pm.noData'));
  const tone = entry.action?.startsWith('admin.') ? 'bg-muted text-foreground'
             : entry.action?.startsWith('auth.login_failed') ? 'bg-destructive/10 text-destructive'
             : entry.action?.startsWith('auth.') ? 'bg-muted text-muted-foreground'
             : 'bg-muted text-muted-foreground';
  const meta = entry.metadata && Object.keys(entry.metadata).length > 0
    ? Object.entries(entry.metadata).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' · ')
    : '';
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
      <span className={`text-caption font-mono rounded px-1.5 py-0.5 whitespace-nowrap ${tone}`}>
        {entry.action}
      </span>
      <span className="text-foreground flex-1 min-w-0 truncate">
        {entry.actor ? (
          <>
            <span className="font-medium">{entry.actor.name}</span>
            <span className="text-muted-foreground ml-1">({entry.actor.email})</span>
          </>
        ) : <span className="text-muted-foreground">{t('admin.audit.system')}</span>}
        {entry.target_type && (
          <span className="text-muted-foreground ml-2">→ {entry.target_type}{entry.target_id ? `#${entry.target_id}` : ''}</span>
        )}
        {meta && <span className="text-muted-foreground ml-2 text-xs">[{meta}]</span>}
      </span>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{when}</span>
    </div>
  );
}
