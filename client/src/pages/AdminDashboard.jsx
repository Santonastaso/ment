import React, { useState, useEffect, useRef } from 'react';
import api from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
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

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [ownerStats, setOwnerStats] = useState(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
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

  useEffect(() => { loadStats(); }, []);

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
      setUploadError(e.response?.data?.error || 'Upload failed. Check the file format and try again.');
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
      setNotice({ variant: 'default', title: 'Matching complete', message: res.data.message });
    } catch (e) {
      setNotice({
        variant: 'destructive',
        title: 'Matching failed',
        message: e.response?.data?.error || 'Could not re-run matching.',
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
      title: 'Reset password?',
      description: `Generate a new temporary password for ${user.name}. They must change it on next login.`,
      confirmLabel: 'Generate password',
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
      title: 'Deactivate user?',
      description: `${user.name} will not be able to log in.`,
      confirmLabel: 'Deactivate',
      destructive: true,
      onConfirm: async () => {
        await api.put(`/admin/users/${user.id}`, { deactivate: true });
        loadUsers();
        setNotice({ variant: 'default', title: 'User deactivated', message: `${user.name} has been deactivated.` });
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
      setNotice({ variant: 'default', title: 'Manager updated', message: 'Reporting line saved.' });
    } catch (e) {
      setNotice({
        variant: 'destructive',
        title: 'Could not update manager',
        message: e.response?.data?.error || 'Try again.',
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
        title: 'Action failed',
        message: e.response?.data?.error || 'Something went wrong.',
      });
    }
  }

  const sessionsByStatus = stats?.sessionsByStatus?.reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {}) || {};
  const deptActivityMax = Math.max(...(stats?.deptActivity?.map(x => x.session_count || 0) ?? []), 1);
  const isPlatformAdmin = user?.admin_scope === 'platform';

  return (
    <PageShell title="Admin" description="Usage, matching, imports, and weekly check-in broadcasts.">

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
            Dismiss
          </Button>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={tab === 'overview' ? 'default' : 'outline'} size="sm" onClick={() => setTab('overview')}>Overview</Button>
        <Button type="button" variant={tab === 'users' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('users'); loadUsers(); }}>Users</Button>
        {isPlatformAdmin && (
          <Button type="button" variant={tab === 'owner' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('owner'); loadOwnerStats(); }}>Owner</Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={handleRematch} disabled={rematching}>
          {rematching ? 'Computing…' : 'Re-run matching'}
        </Button>
      </div>

      {tab === 'overview' && (
        <>
          {/* Weekly reflection broadcast — demo trigger */}
          <SurfacePanel
            title="Weekly reflection check-in"
            description="Sends every employee an in-app banner and (when they've granted permission) a desktop notification asking them to log this week's reflection. In production this fires automatically; trigger it manually here for demos."
            action={
              <Button onClick={handleBroadcastCheckin} disabled={broadcasting} size="sm" className="shrink-0 whitespace-nowrap">
                {broadcasting ? 'Sending…' : 'Send reflection notes'}
              </Button>
            }
          >
            {broadcastResult && (
              <p className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <span>✓</span>
                <span>{broadcastResult.message}</span>
                <span className="text-emerald-600">Employees with the app open will see it within 30 seconds.</span>
              </p>
            )}
          </SurfacePanel>

          {/* Key metrics */}
          {loading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-24 animate-pulse rounded-xl border border-[var(--border)] bg-muted" />)}
            </div>
          ) : stats && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total employees" value={stats.totalUsers} />
                <StatCard label="Onboarding complete" value={`${stats.onboardingRate}%`} sub={`${stats.onboarded} of ${stats.totalUsers} users`} />
                <StatCard label="Sessions requested" value={(sessionsByStatus.pending || 0) + (sessionsByStatus.scheduled || 0) + (sessionsByStatus.completed || 0)} />
                <StatCard label="Match pairs" value={stats.totalMatches} />
              </div>

              <Surface>
                <SurfaceHeader title="Sessions breakdown" />
                <SurfaceBody className="pt-5">
                  <div className="grid grid-cols-3 gap-3">
                    <SessionBox count={sessionsByStatus.pending || 0} label="Pending" tone="yellow" />
                    <SessionBox count={sessionsByStatus.scheduled || 0} label="Scheduled" tone="blue" />
                    <SessionBox count={sessionsByStatus.completed || 0} label="Completed" tone="green" />
                  </div>
                </SurfaceBody>
              </Surface>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Surface>
                  <SurfaceHeader title="Most active mentors" />
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
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{m.session_count} sessions</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No completed sessions yet.</p>}
                  </SurfaceBody>
                </Surface>

                <Surface>
                  <SurfaceHeader title="Department activity" />
                  <SurfaceBody className="pt-5">
                  {stats.deptActivity?.length > 0 ? (
                    <div className="space-y-3">
                      {stats.deptActivity.map(d => (
                        <div key={d.department} className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex justify-between gap-2 text-sm">
                              <span className="font-medium text-foreground">{d.department}</span>
                              <span className="tabular-nums text-muted-foreground">{d.session_count} sessions</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (d.session_count / deptActivityMax) * 100)}%` }} />
                            </div>
                          </div>
                          {d.session_count === 0 && (
                            <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">Silo risk</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No data yet.</p>}
                  </SurfaceBody>
                </Surface>
              </div>
            </>
          )}

          {/* Import */}
          <Surface>
            <SurfaceHeader
              title="Import employees"
              description="Upload a CSV or XLSX file to onboard employees in bulk."
              action={
                <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => downloadBlob('/admin/template', 'ment-import-template.csv')}>
                  Download template
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
                  <span className="capitalize">{m}</span>
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
                  <p className="text-sm text-gray-500">Processing file…</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-gray-600">Drop a CSV or XLSX file here, or click to browse</p>
                  <p className="text-xs text-gray-400 mt-1">Max file size: 10MB</p>
                </div>
              )}
            </div>

            {uploadResult && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">
                <p className="font-semibold mb-1">Import complete</p>
                <ul className="space-y-0.5 text-green-600">
                  <li>✓ {uploadResult.imported} imported{uploadResult.updated ? `, ${uploadResult.updated} updated` : ''} ({uploadResult.skipped} skipped)</li>
                  <li>✓ {uploadResult.matchesGenerated} match pairs generated</li>
                  {uploadResult.imported > 0 && (
                    <li>✓ Temp password (new users): <code className="bg-green-100 px-1 rounded font-mono">{uploadResult.tempPassword}</code></li>
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
              title="Audit log"
              description={
                <>
                  Recent platform events. Sensitive content (reflection text, profile field values) is never recorded — only actions and counts.
                  {auditTotal > 0 && <span className="ml-1 text-muted-foreground/80">{auditTotal} total events.</span>}
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
                    {auditOpen ? 'Hide log' : 'Show recent events'}
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => downloadBlob('/admin/audit/export', 'ment-audit-export.csv')}
                  >
                    Export CSV
                  </Button>
                </div>
              }
            />
            <SurfaceBody className="pt-5">

            {auditOpen && (
              <div className="mt-4 border border-gray-100 rounded-lg overflow-hidden">
                {auditEntries.length === 0 ? (
                  <p className="text-sm text-gray-400 italic p-4">No events recorded yet.</p>
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
          <SurfaceHeader title="Users" />
          <SurfaceBody className="pt-5">
          {usersLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Dept</th>
                    <th className="py-2 pr-4">Manager</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-gray-100">
                      <td className="py-2 pr-4">{u.name}{u.deactivated_at ? ' (deactivated)' : ''}</td>
                      <td className="py-2 pr-4 text-gray-600">{u.email}</td>
                      <td className="py-2 pr-4">{u.department}</td>
                      <td className="py-2 pr-4 text-gray-600">{u.manager_email || <span className="text-gray-300">—</span>}</td>
                      <td className="py-2 space-x-2 whitespace-nowrap">
                        {!u.deactivated_at && (
                          <>
                            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => openSetManager(u)}>Set manager</Button>
                            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => openResetPasswordConfirm(u)}>Reset password</Button>
                            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs text-destructive" onClick={() => openDeactivateConfirm(u)}>Deactivate</Button>
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

      {tab === 'owner' && isPlatformAdmin && (
        <Surface>
          <SurfaceHeader
            title="Owner dashboard"
            description="Cross-organization activity for platform reporting."
          />
          <SurfaceBody className="pt-5">
            {ownerLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : ownerStats?.organizations?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-4">Organization</th>
                      <th className="py-2 pr-4">Users</th>
                      <th className="py-2 pr-4">Onboarded</th>
                      <th className="py-2 pr-4">Active 30d</th>
                      <th className="py-2 pr-4">Sessions</th>
                      <th className="py-2">Churned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ownerStats.organizations.map(org => (
                      <tr key={org.organizationId} className="border-b border-gray-100">
                        <td className="py-2 pr-4">
                          <p className="font-medium">{org.organizationName}</p>
                          <p className="text-xs text-muted-foreground">{org.slug}</p>
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
              <p className="text-sm text-muted-foreground">No organizations yet.</p>
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
            <Button type="button" variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button
              type="button"
              variant={confirmDialog?.destructive ? 'destructive' : 'default'}
              onClick={runConfirmDialog}
            >
              {confirmDialog?.confirmLabel || 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!tempPasswordDialog} onOpenChange={open => { if (!open) setTempPasswordDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
            <DialogDescription>
              Share this with {tempPasswordDialog?.email}. They must change it on next login.
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
              Copy password
            </Button>
            <Button type="button" onClick={() => setTempPasswordDialog(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!managerDialog} onOpenChange={open => { if (!open) setManagerDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set manager</DialogTitle>
            <DialogDescription>Reporting line for {managerDialog?.userName}. Leave empty to clear.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="manager-email">Manager email</Label>
            <Input
              id="manager-email"
              type="email"
              value={managerEmailDraft}
              onChange={e => setManagerEmailDraft(e.target.value)}
              placeholder="manager@company.com"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManagerDialog(null)}>Cancel</Button>
            <Button type="button" onClick={handleSaveManager}>Save</Button>
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
        ) : <span className="text-gray-400">system</span>}
        {entry.target_type && (
          <span className="text-gray-400 ml-2">→ {entry.target_type}{entry.target_id ? `#${entry.target_id}` : ''}</span>
        )}
        {meta && <span className="text-gray-400 ml-2 text-xs">[{meta}]</span>}
      </span>
      <span className="text-xs text-gray-400 whitespace-nowrap">{when}</span>
    </div>
  );
}
