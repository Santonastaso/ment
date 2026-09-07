import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { formatAdminDate, pmTranslate } from '../components/admin/adminPm.js';
import AdminPmKpis from '../components/admin/AdminPmKpis.jsx';

function StatCard({ label, value, sub }) {
  return (
    <Surface>
      <SurfaceBody className="py-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-medium tabular-nums tracking-[-0.01em]">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </SurfaceBody>
    </Surface>
  );
}

// Horizontal bar list for KPI breakdowns (most requested/shared skills, etc).
function KpiBars({ title, items, valueKey = 'count', labelKey = 'skill', emptyLabel, suffix }) {
  const max = Math.max(1, ...items.map((i) => Number(i[valueKey]) || 0));
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{emptyLabel}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((it, idx) => {
            const v = Number(it[valueKey]) || 0;
            return (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-xs text-foreground" title={it[labelKey]}>{it[labelKey]}</span>
                <div className="h-3 flex-1 rounded-full bg-muted">
                  <div className="h-3 rounded-full bg-primary" style={{ width: `${(v / max) * 100}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{v}{suffix || ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
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

function formatDate(value) {
  return formatAdminDate(value);
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const { t: translate } = useT();
  const t = (key, vars) => pmTranslate(translate, key, vars);
  const [stats, setStats] = useState(null);
  const [mostActiveUsers, setMostActiveUsers] = useState([]);
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
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilter, setAuditFilter] = useState('');
  const [loadErrors, setLoadErrors] = useState({});
  const requestIds = useRef({});
  // Admin subpages live in the URL (?tab=) so deep links and back/forward work.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'overview';
  const validTabs = ['overview', 'kpis', 'people', 'privacy', 'audit', 'feedback'];
  const tab = validTabs.includes(rawTab) ? rawTab : 'overview';
  function setTab(next) {
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
    setLoadErrors(prev => ({ ...prev, people: false }));
    try {
      const res = await api.get('/admin/users?limit=200');
      setUsers(res.data.users || []);
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
  useEffect(() => {
    if (tab === 'kpis') loadKpis();
    if (tab === 'people') loadUsers();
    if (tab === 'privacy' || tab === 'audit') loadAudit();
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

  async function handleSetRole(user, role) {
    try {
      await api.put(`/admin/users/${user.id}`, { role });
      loadUsers();
      setNotice({ variant: 'default', title: t('admin.notice.roleUpdatedTitle'), message: t('admin.notice.roleUpdatedMsg', { name: user.name, role: t(`admin.users.role.${role}`) }) });
    } catch (e) {
      setNotice({
        variant: 'destructive',
        title: t('admin.notice.roleUpdateFailTitle'),
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

      <nav className="flex flex-wrap items-center gap-6 border-b border-[var(--border)]" aria-label={t('admin.tabs.label')}>
        {validTabs.map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            data-testid={`admin-tab-${key}`}
            aria-current={tab === key ? 'page' : undefined}
            className={`-mb-px border-b-2 px-0.5 pb-2.5 pt-1 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-[var(--foreground)] text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`admin.tab.${key}`)}
          </button>
        ))}
        {isPlatformAdmin && (
          <Link to="/admin/ops" data-testid="nav-platform-ops" className="-mb-px border-b-2 border-transparent px-0.5 pb-2.5 pt-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            {t('admin.ops.link')} →
          </Link>
        )}
      </nav>

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
              <p className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-muted-foreground">
                <span>✓“</span>
                <span>{broadcastResult.message}</span>
                <span>{t('admin.broadcast.resultHint')}</span>
              </p>
            )}
          </SurfacePanel>
          </>
      )}

      {tab === 'privacy' && (
        <>
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
                    <p>{t('admin.pm.privacyHelp')}</p>
                    <h3 className="font-semibold">{t('admin.pm.consent')}</h3>
                    <p className="text-muted-foreground">{t('admin.pm.consentHelp')}</p>
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
                      <h3 className="text-sm font-semibold">{t('admin.pm.schoolControls')}</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor="admin-min-reports" className="text-xs text-muted-foreground">{t('admin.privacy.minReports')}</label>
                        <input
                          id="admin-min-reports"
                          key={privacyStatus.minTeamDashboardSize}
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
          </>
      )}

      {tab === 'overview' && (
        <>
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
                <SurfaceHeader
                  title={t('admin.sessions.breakdown')}
                  action={
                    <Button type="button" variant="outline" size="sm" onClick={handleRematch} disabled={rematching} data-testid="rematch-btn">
                      {rematching ? t('admin.rematch.computing') : t('admin.rematch.action')}
                    </Button>
                  }
                />
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
                          <span className="w-5 text-sm font-medium tabular-nums text-muted-foreground">{i + 1}</span>
                          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                            {m.name?.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                            <p className="text-xs text-muted-foreground">{m.department}</p>
                          </div>
                          <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">{t('admin.common.sessionsCount', { count: m.session_count })}</span>
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
                          <span className="w-5 text-sm font-medium tabular-nums text-muted-foreground">{i + 1}</span>
                          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                            {u.name?.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{u.name}</p>
                            <p className="text-xs text-muted-foreground">{u.department}</p>
                          </div>
                          <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">{t('admin.common.sessionsCount', { count: u.sessions })}</span>
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
                            <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-muted-foreground">{t('admin.dept.siloRisk')}</span>
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

          </>
      )}

      {tab === 'people' && (
        <>
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

            <div className="bg-muted rounded-lg p-3 mb-4 text-xs text-muted-foreground font-mono">
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
              <div className="mt-4 rounded-lg border border-[var(--border)] p-4 text-sm">
                <p className="mb-1 font-medium">{t('admin.import.complete')}</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>✓“ {uploadResult.updated
                    ? t('admin.import.importedUpdatedLine', { imported: uploadResult.imported, updated: uploadResult.updated, skipped: uploadResult.skipped })
                    : t('admin.import.importedLine', { imported: uploadResult.imported, skipped: uploadResult.skipped })}</li>
                  <li>✓“ {t('admin.import.matchesLine', { matches: uploadResult.matchesGenerated })}</li>
                  {uploadResult.imported > 0 && (
                    <li>✓“ {t('admin.import.tempPassword')} <code className="rounded bg-muted px-1 font-mono text-foreground">{uploadResult.tempPassword}</code></li>
                  )}
                </ul>
              </div>
            )}

            {uploadError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{uploadError}</div>
            )}
            </SurfaceBody>
          </Surface>
          </>
      )}

      {(tab === 'privacy' || tab === 'audit') && (
        <Surface>
          <SurfaceHeader
            title={t('admin.audit.title')}
            description={
              <>
                {t('admin.pm.auditHelp')}
                {auditTotal > 0 && <span className="ml-1 text-muted-foreground/80">{t('admin.audit.totalEvents', { count: auditTotal })}</span>}
              </>
            }
            action={
              <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => downloadBlob('/admin/audit/export', 'ment-audit-export.csv')}>
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
              <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                {auditEntries.filter(entry => `${entry.action || ''} ${entry.actor?.name || ''} ${entry.actor?.email || ''}`.toLowerCase().includes(auditFilter.toLowerCase())).map(entry => <AuditRow key={entry.id} entry={entry} />)}
              </div>
            )}
          </SurfaceBody>
        </Surface>
      )}

      {tab === 'kpis' && <AdminPmKpis data={kpis} loading={kpisLoading} error={loadErrors.kpis} onRefresh={loadKpis} />}

      {tab === 'people' && (
        <Surface>
          <SurfaceHeader title={t('admin.users.title')} />
          <SurfaceBody className="pt-5">
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
                    <th className="py-2">{t('admin.users.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-[var(--border-subtle)]">
                      <td className="py-2 pr-4">{u.name}{u.deactivated_at ? t('admin.users.deactivatedSuffix') : ''}</td>
                      <td className="py-2 pr-4 text-secondary-foreground">{u.email}</td>
                      <td className="py-2 pr-4">{u.department}</td>
                      <td className="py-2 pr-4">
                        {u.deactivated_at ? (
                          <span className="text-muted-foreground">{t(`admin.users.role.${u.role || 'student'}`)}</span>
                        ) : (
                          <select
                            value={u.role || 'student'}
                            onChange={e => handleSetRole(u, e.target.value)}
                            className="input h-8 text-xs py-0"
                            aria-label={t('admin.users.role.title')}
                          >
                            <option value="student">{t('admin.users.role.student')}</option>
                            <option value="alumnus">{t('admin.users.role.alumnus')}</option>
                          </select>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-secondary-foreground">{u.manager_email || <span className="text-gray-300">—</span>}</td>
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
  const dot = { yellow: 'bg-amber-500', blue: 'bg-blue-500', green: 'bg-emerald-500' }[tone] || 'bg-zinc-400';
  return (
    <div className="rounded-lg border border-[var(--border)] p-3 text-center">
      <p className="text-2xl font-medium tabular-nums tracking-[-0.01em]">{count}</p>
      <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
        {label}
      </p>
    </div>
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
      <span className={`text-[11px] font-mono rounded px-1.5 py-0.5 whitespace-nowrap ${tone}`}>
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
