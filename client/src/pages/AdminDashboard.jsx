import React, { useState, useEffect, useRef } from 'react';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody, SurfaceHeader, SurfacePanel } from '../components/Surface.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function StatCard({ label, value, sub }) {
  return (
    <Surface>
      <SurfaceBody className="py-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </SurfaceBody>
    </Surface>
  );
}

async function downloadBlob(apiPath, filename) {
  const res = await api.get(apiPath, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTextFile(text, filename, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortId(value) {
  return value ? `${String(value).slice(0, 8)}…` : '—';
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const { t } = useT();
  const [stats, setStats] = useState(null);
  const [mostActiveUsers, setMostActiveUsers] = useState([]);
  const [ownerStats, setOwnerStats] = useState(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [orgNameDraft, setOrgNameDraft] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [accessRequests, setAccessRequests] = useState([]);
  const [accessRequestTotal, setAccessRequestTotal] = useState(0);
  const [accessRequestsLoading, setAccessRequestsLoading] = useState(false);
  const [updatingRequestId, setUpdatingRequestId] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState('');
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState(null);
  const [savingOrgPrivacy, setSavingOrgPrivacy] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
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
  const [auditOpen, setAuditOpen] = useState(false);
  const [tab, setTab] = useState('overview');
  const [importMode, setImportMode] = useState('insert');
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tempPasswordDialog, setTempPasswordDialog] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [managerDialog, setManagerDialog] = useState(null);
  const [managerEmailDraft, setManagerEmailDraft] = useState('');
  const fileRef = useRef(null);

  async function loadStats() {
    setLoading(true);
    try {
      const res = await api.get('/admin/stats');
      setStats(res.data);
    } finally {
      setLoading(false);
    }
  }

  async function loadMostActiveUsers() {
    try {
      const res = await api.get('/admin/most-active-users?limit=10');
      setMostActiveUsers(Array.isArray(res.data) ? res.data : []);
    } catch {
      setMostActiveUsers([]);
    }
  }

  async function loadUsers() {
    setUsersLoading(true);
    try {
      const res = await api.get('/admin/users?limit=200');
      setUsers(res.data.users || []);
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadAudit() {
    try {
      const res = await api.get('/admin/audit?limit=100');
      setAuditEntries(res.data.entries || []);
      setAuditTotal(res.data.total || 0);
    } catch { /* ignore */ }
  }

  async function loadOwnerStats() {
    setOwnerLoading(true);
    try {
      const res = await api.get('/admin/owner-stats');
      setOwnerStats(res.data);
    } finally {
      setOwnerLoading(false);
    }
  }

  async function loadAccessRequests() {
    setAccessRequestsLoading(true);
    try {
      const res = await api.get('/admin/access-requests?limit=100');
      setAccessRequests(res.data.requests || []);
      setAccessRequestTotal(res.data.total || 0);
    } finally {
      setAccessRequestsLoading(false);
    }
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

  useEffect(() => { loadStats(); loadMostActiveUsers(); loadPrivacyStatus(); }, []);

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
      setUploadError(e.response?.data?.error || t('admin.import.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function handleRematch() {
    setRematching(true);
    setNotice(null);
    try {
      const res = await api.post('/admin/rematch');
      setStats(prev => prev ? { ...prev, totalMatches: res.data.matchesGenerated } : prev);
      setNotice({ variant: 'default', title: t('admin.notice.matchingCompleteTitle'), message: res.data.message });
    } catch (e) {
      setNotice({
        variant: 'destructive',
        title: t('admin.notice.matchingFailedTitle'),
        message: e.response?.data?.error || t('admin.notice.matchingFailedMsg'),
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

  async function handleCreateOrganization(e) {
    e.preventDefault();
    const name = orgNameDraft.trim();
    if (!name) return;
    setCreatingOrg(true);
    setNotice(null);
    try {
      const res = await api.post('/admin/organizations', { name });
      setOrgNameDraft('');
      setOwnerStats(prev => prev ? {
        ...prev,
        organizations: [...(prev.organizations || []), res.data].sort((a, b) =>
          (a.organizationName || '').localeCompare(b.organizationName || '')
        ),
      } : prev);
      loadOwnerStats();
      setNotice({ variant: 'default', title: t('admin.notice.orgCreatedTitle'), message: t('admin.notice.orgCreatedMsg', { name: res.data.organizationName }) });
    } catch (e) {
      setNotice({
        variant: 'destructive',
        title: t('admin.notice.orgCreateFailTitle'),
        message: e.response?.data?.error || t('admin.common.tryAgain'),
      });
    } finally {
      setCreatingOrg(false);
    }
  }

  function downloadOwnerCsv() {
    const rows = ownerStats?.organizations || [];
    const header = ['org_name', 'slug', 'org_id', 'users', 'onboarded', 'onboarding_rate', 'active_30d', 'sessions', 'churned'];
    const body = rows.map(org => [
      org.organizationName,
      org.slug,
      org.organizationId,
      org.totalUsers,
      org.onboarded,
      org.onboardingRate,
      org.activeMembers,
      org.sessions,
      org.churned,
    ].map(csvEscape).join(',')).join('\n');
    downloadTextFile(`${header.join(',')}\n${body}\n`, 'ment-owner-organizations.csv');
  }

  async function copyOrgId(org) {
    await navigator.clipboard?.writeText(org.organizationId || '');
    setNotice({ variant: 'default', title: t('admin.notice.orgIdCopied'), message: org.organizationName });
  }

  async function updateAccessRequestStatus(request, status) {
    setUpdatingRequestId(request.id);
    setNotice(null);
    try {
      const res = await api.put(`/admin/access-requests/${request.id}`, { status });
      setAccessRequests(prev => prev.map(item => item.id === request.id ? res.data : item));
    } catch (e) {
      setNotice({
        variant: 'destructive',
        title: t('admin.notice.requestUpdateFailTitle'),
        message: e.response?.data?.error || t('admin.common.tryAgain'),
      });
    } finally {
      setUpdatingRequestId(null);
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
        message: e.response?.data?.error || t('admin.common.tryAgain'),
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
        message: e.response?.data?.error || t('admin.notice.somethingWrong'),
      });
    }
  }

  const sessionsByStatus = stats?.sessionsByStatus?.reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {}) || {};
  const deptActivityMax = Math.max(...(stats?.deptActivity?.map(x => x.session_count || 0) ?? []), 1);
  const isPlatformAdmin = user?.admin_scope === 'platform';

  return (
    <PageShell title={t('admin.pageTitle')} description={t('admin.pageDescription')}>

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

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={tab === 'overview' ? 'default' : 'outline'} size="sm" onClick={() => setTab('overview')}>{t('admin.tab.overview')}</Button>
        <Button type="button" variant={tab === 'users' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('users'); loadUsers(); }}>{t('admin.tab.users')}</Button>
        <Button type="button" variant={tab === 'feedback' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('feedback'); loadFeedback(); }}>{t('admin.tab.feedback')}</Button>
        {isPlatformAdmin && (
          <>
            <Button type="button" variant={tab === 'organizations' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('organizations'); loadOwnerStats(); }}>{t('admin.tab.organizations')}</Button>
            <Button type="button" variant={tab === 'access-requests' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('access-requests'); loadAccessRequests(); }}>{t('admin.tab.accessRequests')}</Button>
          </>
        )}
        <Button type="button" variant="outline" size="sm" onClick={handleRematch} disabled={rematching}>
          {rematching ? t('admin.rematch.computing') : t('admin.rematch.action')}
        </Button>
      </div>

      {tab === 'overview' && (
        <>
          {/* Weekly reflection broadcast — demo trigger */}
          <SurfacePanel
            title={t('admin.broadcast.title')}
            description={t('admin.broadcast.description')}
            action={
              <Button onClick={handleBroadcastCheckin} disabled={broadcasting} size="sm" className="shrink-0 whitespace-nowrap">
                {broadcasting ? t('admin.broadcast.sending') : t('admin.broadcast.send')}
              </Button>
            }
          >
            {broadcastResult && (
              <p className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <span>✓</span>
                <span>{broadcastResult.message}</span>
                <span className="text-emerald-600">{t('admin.broadcast.resultHint')}</span>
              </p>
            )}
          </SurfacePanel>

          <Surface>
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
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('admin.privacy.aiClassification')}</p>
                      <p className="mt-1 font-medium text-foreground">{privacyStatus.aiClassification?.label || t('admin.privacy.offByDefault')}</p>
                      <p className="text-xs text-muted-foreground">{privacyStatus.aiClassification?.source}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('admin.privacy.supabaseRegion')}</p>
                      <p className="mt-1 font-medium text-foreground">{privacyStatus.supabaseRegion || 'eu-central-1'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('admin.privacy.edgeFunctions')}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(privacyStatus.edgeFunctions || []).map(fn => (
                          <span key={fn.name} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            {fn.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('admin.privacy.peerVisible')}</p>
                      <ul className="mt-2 space-y-1 text-sm text-foreground">
                        {(privacyStatus.peerVisibleFields || []).map(field => <li key={field}>{field}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('admin.privacy.hidden')}</p>
                      <ul className="mt-2 space-y-1 text-sm text-foreground">
                        {(privacyStatus.hiddenFields || []).map(field => <li key={field}>{field}</li>)}
                      </ul>
                    </div>
                    <div className="sm:col-span-2 rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('admin.privacy.orgMode')}</p>
                        <p className="mt-1 text-sm text-foreground">
                          {t('admin.privacy.currentMode', { mode: '' })}<span className="font-semibold">{privacyStatus.orgType === 'inter' ? t('admin.privacy.modeInter') : t('admin.privacy.modeIntra')}</span>
                        </p>
                        {Array.isArray(privacyStatus.interExtraRedactions) && privacyStatus.interExtraRedactions.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('admin.privacy.interHides', { fields: privacyStatus.interExtraRedactions.join(', ') })}
                          </p>
                        )}
                      </div>
                      {isPlatformAdmin && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button" size="sm"
                            variant={privacyStatus.orgType === 'intra' ? 'default' : 'outline'}
                            onClick={() => updateOrgPrivacy({ type: 'intra' })}
                            disabled={savingOrgPrivacy}
                            data-testid="org-mode-intra"
                          >{t('admin.privacy.intra')}</Button>
                          <Button
                            type="button" size="sm"
                            variant={privacyStatus.orgType === 'inter' ? 'default' : 'outline'}
                            onClick={() => updateOrgPrivacy({ type: 'inter' })}
                            disabled={savingOrgPrivacy}
                            data-testid="org-mode-inter"
                          >{t('admin.privacy.inter')}</Button>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-muted-foreground">{t('admin.privacy.minReports')}</label>
                        <input
                          type="number" min={1} max={100}
                          defaultValue={privacyStatus.minTeamDashboardSize ?? 3}
                          data-testid="min-team-size-input"
                          className="input w-20 text-sm"
                          disabled={savingOrgPrivacy}
                          onBlur={(e) => {
                            const v = Math.max(1, Math.min(100, Number(e.target.value) || 3));
                            if (v !== (privacyStatus.minTeamDashboardSize ?? 3)) {
                              updateOrgPrivacy({ min_team_dashboard_size: v });
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('admin.privacy.unavailable')}</p>
              )}
            </SurfaceBody>
          </Surface>

          {/* Key metrics */}
          {loading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-24 animate-pulse rounded-xl border border-[var(--border)] bg-muted" />)}
            </div>
          ) : stats && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label={t('admin.stats.totalEmployees')} value={stats.totalUsers} />
                <StatCard label={t('admin.stats.onboardingComplete')} value={`${stats.onboardingRate}%`} sub={t('admin.stats.onboardedOf', { onboarded: stats.onboarded, total: stats.totalUsers })} />
                <StatCard label={t('admin.stats.sessionsRequested')} value={(sessionsByStatus.pending || 0) + (sessionsByStatus.scheduled || 0) + (sessionsByStatus.completed || 0)} />
                <StatCard label={t('admin.stats.matchPairs')} value={stats.totalMatches} />
              </div>

              <Surface>
                <SurfaceHeader title={t('admin.sessions.breakdown')} />
                <SurfaceBody className="pt-5">
                  <div className="grid grid-cols-3 gap-3">
                    <SessionBox count={sessionsByStatus.pending || 0} label={t('admin.sessions.pending')} tone="yellow" />
                    <SessionBox count={sessionsByStatus.scheduled || 0} label={t('admin.sessions.scheduled')} tone="blue" />
                    <SessionBox count={sessionsByStatus.completed || 0} label={t('admin.sessions.completed')} tone="green" />
                  </div>
                </SurfaceBody>
              </Surface>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Surface>
                  <SurfaceHeader title={t('admin.mentors.title')} />
                  <SurfaceBody className="pt-5">
                  {stats.topMentors?.length > 0 ? (
                    <div className="space-y-3">
                      {stats.topMentors.map((m, i) => (
                        <div key={m.id} className="flex items-center gap-3">
                          <span className="w-5 text-sm font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                            {m.name?.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                            <p className="text-xs text-muted-foreground">{m.department}</p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{t('admin.common.sessionsCount', { count: m.session_count })}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">{t('admin.mentors.empty')}</p>}
                  </SurfaceBody>
                </Surface>

                <Surface data-testid="most-active-users">
                  <SurfaceHeader title={t('admin.activeUsers.title')} />
                  <SurfaceBody className="pt-5">
                  {mostActiveUsers.length > 0 ? (
                    <div className="space-y-3">
                      {mostActiveUsers.map((u, i) => (
                        <div key={u.id} data-testid="most-active-users-row" className="flex items-center gap-3">
                          <span className="w-5 text-sm font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                            {u.name?.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{u.name}</p>
                            <p className="text-xs text-muted-foreground">{u.department}</p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{t('admin.common.sessionsCount', { count: u.sessions })}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">{t('admin.activeUsers.empty')}</p>}
                  </SurfaceBody>
                </Surface>

                <Surface>
                  <SurfaceHeader title={t('admin.dept.title')} />
                  <SurfaceBody className="pt-5">
                  {stats.deptActivity?.length > 0 ? (
                    <div className="space-y-3">
                      {stats.deptActivity.map(d => (
                        <div key={d.department} className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex justify-between gap-2 text-sm">
                              <span className="font-medium text-foreground">{d.department}</span>
                              <span className="tabular-nums text-muted-foreground">{t('admin.common.sessionsCount', { count: d.session_count })}</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (d.session_count / deptActivityMax) * 100)}%` }} />
                            </div>
                          </div>
                          {d.session_count === 0 && (
                            <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">{t('admin.dept.siloRisk')}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">{t('admin.dept.empty')}</p>}
                  </SurfaceBody>
                </Surface>
              </div>
            </>
          )}

          {/* Import */}
          <Surface>
            <SurfaceHeader
              title={t('admin.import.title')}
              description={t('admin.import.description')}
              action={
                <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => downloadBlob('/admin/template', 'ment-import-template.csv')}>
                  {t('admin.import.downloadTemplate')}
                </Button>
              }
            />
            <SurfaceBody className="space-y-4 pt-5">

            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-500 font-mono">
              name, email, department, current_role, tenure_years, location, manager_email, can_teach, wants_to_learn
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
              className={`cursor-pointer rounded border-2 border-dashed p-10 text-center transition-colors ${dragOver ? 'border-[#1264a3] bg-[#f0f7fc]' : 'border-[#dddddd] hover:border-[#1264a3] hover:bg-[#f8f8f8]'}`}
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
                  <div className="mx-auto size-8 animate-spin rounded-full border-2 border-[#1264a3] border-t-transparent" />
                  <p className="text-sm text-gray-500">{t('admin.import.processing')}</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-gray-600">{t('admin.import.dropzone')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t('admin.import.maxSize')}</p>
                </div>
              )}
            </div>

            {uploadResult && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">
                <p className="font-semibold mb-1">{t('admin.import.complete')}</p>
                <ul className="space-y-0.5 text-green-600">
                  <li>✓ {uploadResult.updated
                    ? t('admin.import.importedUpdatedLine', { imported: uploadResult.imported, updated: uploadResult.updated, skipped: uploadResult.skipped })
                    : t('admin.import.importedLine', { imported: uploadResult.imported, skipped: uploadResult.skipped })}</li>
                  <li>✓ {t('admin.import.matchesLine', { matches: uploadResult.matchesGenerated })}</li>
                  {uploadResult.imported > 0 && (
                    <li>✓ {t('admin.import.tempPassword')} <code className="bg-green-100 px-1 rounded font-mono">{uploadResult.tempPassword}</code></li>
                  )}
                </ul>
              </div>
            )}

            {uploadError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{uploadError}</div>
            )}
            </SurfaceBody>
          </Surface>

          <Surface>
            <SurfaceHeader
              title={t('admin.audit.title')}
              description={
                <>
                  {t('admin.audit.description')}
                  {auditTotal > 0 && <span className="ml-1 text-muted-foreground/80">{t('admin.audit.totalEvents', { count: auditTotal })}</span>}
                </>
              }
              action={
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => { setAuditOpen(o => { if (!o) loadAudit(); return !o; }); }}
                  >
                    {auditOpen ? t('admin.audit.hide') : t('admin.audit.show')}
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => downloadBlob('/admin/audit/export', 'ment-audit-export.csv')}
                  >
                    {t('admin.audit.exportCsv')}
                  </Button>
                </div>
              }
            />
            <SurfaceBody className="pt-5">

            {auditOpen && (
              <div className="mt-4 border border-gray-100 rounded-lg overflow-hidden">
                {auditEntries.length === 0 ? (
                  <p className="text-sm text-gray-400 italic p-4">{t('admin.audit.empty')}</p>
                ) : (
                  <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                    {auditEntries.map(entry => <AuditRow key={entry.id} entry={entry} />)}
                  </div>
                )}
              </div>
            )}
            </SurfaceBody>
          </Surface>
        </>
      )}

      {tab === 'users' && (
        <Surface>
          <SurfaceHeader title={t('admin.users.title')} />
          <SurfaceBody className="pt-5">
          {usersLoading ? <p className="text-sm text-muted-foreground">{t('admin.common.loading')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">{t('admin.users.name')}</th>
                    <th className="py-2 pr-4">{t('admin.users.email')}</th>
                    <th className="py-2 pr-4">{t('admin.users.dept')}</th>
                    <th className="py-2 pr-4">{t('admin.users.manager')}</th>
                    <th className="py-2">{t('admin.users.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-gray-100">
                      <td className="py-2 pr-4">{u.name}{u.deactivated_at ? t('admin.users.deactivatedSuffix') : ''}</td>
                      <td className="py-2 pr-4 text-gray-600">{u.email}</td>
                      <td className="py-2 pr-4">{u.department}</td>
                      <td className="py-2 pr-4 text-gray-600">{u.manager_email || <span className="text-gray-300">—</span>}</td>
                      <td className="py-2 space-x-2 whitespace-nowrap">
                        {!u.deactivated_at && (
                          <>
                            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => openSetManager(u)}>{t('admin.users.setManager')}</Button>
                            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => openResetPasswordConfirm(u)}>{t('admin.users.resetPassword')}</Button>
                            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs text-destructive" onClick={() => openDeactivateConfirm(u)}>{t('admin.users.deactivate')}</Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </SurfaceBody>
        </Surface>
      )}

      {tab === 'organizations' && isPlatformAdmin && (
        <Surface>
          <SurfaceHeader
            title={t('admin.orgs.title')}
            description={t('admin.orgs.description')}
            action={
              <Button type="button" variant="outline" size="sm" onClick={downloadOwnerCsv} disabled={!ownerStats?.organizations?.length}>
                {t('admin.orgs.downloadCsv')}
              </Button>
            }
          />
          <SurfaceBody className="space-y-5 pt-5">
            <form onSubmit={handleCreateOrganization} className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-muted/30 p-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="organization-name">{t('admin.orgs.createLabel')}</Label>
                <Input
                  id="organization-name"
                  value={orgNameDraft}
                  onChange={e => setOrgNameDraft(e.target.value)}
                  placeholder={t('admin.orgs.placeholder')}
                />
              </div>
              <Button type="submit" disabled={creatingOrg || !orgNameDraft.trim()}>
                {creatingOrg ? t('admin.orgs.creating') : t('admin.orgs.create')}
              </Button>
            </form>

            {ownerLoading ? (
              <p className="text-sm text-muted-foreground">{t('admin.common.loading')}</p>
            ) : ownerStats?.organizations?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-4">{t('admin.orgs.colOrganization')}</th>
                      <th className="py-2 pr-4">{t('admin.orgs.colOrgId')}</th>
                      <th className="py-2 pr-4">{t('admin.orgs.colUsers')}</th>
                      <th className="py-2 pr-4">{t('admin.orgs.colOnboarded')}</th>
                      <th className="py-2 pr-4">{t('admin.orgs.colActive30d')}</th>
                      <th className="py-2 pr-4">{t('admin.orgs.colSessions')}</th>
                      <th className="py-2">{t('admin.orgs.colChurned')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ownerStats.organizations.map(org => (
                      <tr key={org.organizationId} className="border-b border-gray-100">
                        <td className="py-2 pr-4">
                          <p className="font-medium">{org.organizationName}</p>
                          <p className="text-xs text-muted-foreground">{org.slug}</p>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{shortId(org.organizationId)}</code>
                            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => copyOrgId(org)}>
                              {t('admin.orgs.copy')}
                            </Button>
                          </div>
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{org.totalUsers}</td>
                        <td className="py-2 pr-4 tabular-nums">{org.onboardingRate}% <span className="text-muted-foreground">({org.onboarded})</span></td>
                        <td className="py-2 pr-4 tabular-nums">{org.activeMembers}</td>
                        <td className="py-2 pr-4 tabular-nums">{org.sessions}</td>
                        <td className="py-2 tabular-nums">{org.churned}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('admin.orgs.empty')}</p>
            )}
          </SurfaceBody>
        </Surface>
      )}

      {tab === 'access-requests' && isPlatformAdmin && (
        <Surface>
          <SurfaceHeader
            title={t('admin.access.title')}
            description={accessRequestTotal ? t('admin.access.descriptionTotal', { count: accessRequestTotal }) : t('admin.access.descriptionEmpty')}
            action={
              <Button type="button" variant="outline" size="sm" onClick={loadAccessRequests} disabled={accessRequestsLoading}>
                {accessRequestsLoading ? t('admin.common.refreshing') : t('admin.common.refresh')}
              </Button>
            }
          />
          <SurfaceBody className="pt-5">
            {accessRequestsLoading ? (
              <p className="text-sm text-muted-foreground">{t('admin.common.loading')}</p>
            ) : accessRequests.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-4">{t('admin.access.colSubmitted')}</th>
                      <th className="py-2 pr-4">{t('admin.access.colContact')}</th>
                      <th className="py-2 pr-4">{t('admin.access.colCompany')}</th>
                      <th className="py-2 pr-4">{t('admin.access.colNote')}</th>
                      <th className="py-2">{t('admin.access.colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessRequests.map(request => (
                      <tr key={request.id} className="border-b border-gray-100 align-top">
                        <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{formatDate(request.createdAt)}</td>
                        <td className="py-2 pr-4">
                          <p className="font-medium">{request.name}</p>
                          <p className="text-xs text-muted-foreground">{request.email}</p>
                        </td>
                        <td className="py-2 pr-4">
                          <p className="font-medium">{request.company}</p>
                          <p className="text-xs text-muted-foreground">{request.companySize} · {request.role}</p>
                        </td>
                        <td className="max-w-sm py-2 pr-4 text-muted-foreground">
                          <p className="line-clamp-3 whitespace-pre-wrap">{request.note || '—'}</p>
                        </td>
                        <td className="py-2">
                          <select
                            className="input h-8 min-w-28"
                            value={request.status}
                            disabled={updatingRequestId === request.id}
                            onChange={e => updateAccessRequestStatus(request, e.target.value)}
                          >
                            <option value="new">{t('admin.access.statusNew')}</option>
                            <option value="contacted">{t('admin.access.statusContacted')}</option>
                            <option value="closed">{t('admin.access.statusClosed')}</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('admin.access.empty')}</p>
            )}
          </SurfaceBody>
        </Surface>
      )}

      {tab === 'feedback' && (
        <Surface>
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
                  className="input h-8 min-w-32 text-sm"
                  value={feedbackFilter}
                  onChange={e => { setFeedbackFilter(e.target.value); loadFeedback(e.target.value); }}
                >
                  <option value="">{t('admin.feedback.allStatuses')}</option>
                  <option value="new">{t('admin.feedback.statusNew')}</option>
                  <option value="reviewing">{t('admin.feedback.statusReviewing')}</option>
                  <option value="resolved">{t('admin.feedback.statusResolved')}</option>
                </select>
                <Button type="button" variant="outline" size="sm" onClick={() => loadFeedback(feedbackFilter)} disabled={feedbackLoading}>
                  {feedbackLoading ? t('admin.common.refreshing') : t('admin.common.refresh')}
                </Button>
              </div>
            }
          />
          <SurfaceBody className="pt-5">
            {feedbackLoading ? (
              <p className="text-sm text-muted-foreground">{t('admin.common.loading')}</p>
            ) : feedback.length ? (
              <ul className="space-y-3">
                {feedback.map(item => (
                  <li
                    key={item.id}
                    data-testid="feedback-item"
                    className="rounded-lg border border-border bg-card/40 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold uppercase tracking-wide text-foreground">{item.category}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{item.user?.name || t('admin.feedback.unknownUser')}</span>
                          {item.user?.department && (
                            <>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground">{item.user.department}</span>
                            </>
                          )}
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{formatDate(item.created_at)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.message}</p>
                      </div>
                      <select
                        className="input h-8 min-w-28 text-sm"
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
          <div className="rounded-lg border bg-muted px-3 py-2 font-mono text-sm">{tempPasswordDialog?.tempPassword}</div>
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
    </PageShell>
  );
}

function SessionBox({ count, label, tone }) {
  const cls = {
    yellow: 'bg-[#fcf4de] border-[#e8d99a] text-[#9b6b00]',
    blue:   'bg-[#f0f7fc] border-[#c5d9eb] text-[#1264a3]',
    green:  'bg-[#e8f5e9] border-[#a5d6a7] text-[#2e7d32]',
  }[tone];
  return (
    <div className={`rounded border p-3 text-center ${cls}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-sm mt-1 opacity-80">{label}</p>
    </div>
  );
}

function AuditRow({ entry }) {
  const { t } = useT();
  const when = new Date(entry.created_at + 'Z').toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const tone = entry.action.startsWith('admin.') ? 'bg-amber-50 text-amber-800'
             : entry.action.startsWith('auth.login_failed') ? 'bg-rose-50 text-rose-700'
             : entry.action.startsWith('auth.') ? 'bg-blue-50 text-blue-700'
             : 'bg-gray-50 text-gray-700';
  const meta = entry.metadata && Object.keys(entry.metadata).length > 0
    ? Object.entries(entry.metadata).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' · ')
    : '';
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50/50">
      <span className={`text-[11px] font-mono rounded px-1.5 py-0.5 whitespace-nowrap ${tone}`}>
        {entry.action}
      </span>
      <span className="text-gray-700 flex-1 min-w-0 truncate">
        {entry.actor ? (
          <>
            <span className="font-medium">{entry.actor.name}</span>
            <span className="text-gray-400 ml-1">({entry.actor.email})</span>
          </>
        ) : <span className="text-gray-400">{t('admin.audit.system')}</span>}
        {entry.target_type && (
          <span className="text-gray-400 ml-2">→ {entry.target_type}{entry.target_id ? `#${entry.target_id}` : ''}</span>
        )}
        {meta && <span className="text-gray-400 ml-2 text-xs">[{meta}]</span>}
      </span>
      <span className="text-xs text-gray-400 whitespace-nowrap">{when}</span>
    </div>
  );
}
