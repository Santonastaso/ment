import React, { useState, useEffect, useRef } from 'react';
import api from '../api/index.js';

function StatCard({ label, value, sub }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-navy">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
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

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
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
    try {
      const res = await api.post('/admin/rematch');
      setStats(prev => prev ? { ...prev, totalMatches: res.data.matchesGenerated } : prev);
      alert(res.data.message);
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

  async function handleResetPassword(userId) {
    if (!confirm('Generate a new temporary password for this user?')) return;
    const res = await api.post(`/admin/users/${userId}/reset-password`);
    alert(`Temp password for ${res.data.email}:\n\n${res.data.tempPassword}\n\n(User must change it on next login.)`);
  }

  async function handleDeactivate(userId) {
    if (!confirm('Deactivate this user? They will not be able to log in.')) return;
    await api.put(`/admin/users/${userId}`, { deactivate: true });
    loadUsers();
  }

  async function handleSetManager(userId, currentManagerEmail) {
    const email = prompt('Manager email (leave empty to clear):', currentManagerEmail || '');
    if (email === null) return;
    try {
      await api.put(`/admin/users/${userId}`, { manager_email: email.trim() });
      loadUsers();
    } catch (e) {
      alert(e.response?.data?.error || 'Could not update manager');
    }
  }

  const sessionsByStatus = stats?.sessionsByStatus?.reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {}) || {};
  const deptActivityMax = Math.max(...(stats?.deptActivity?.map(x => x.session_count || 0) ?? []), 1);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Admin Dashboard</h1>
          <p className="text-gray-500 mt-1">Platform overview and management</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => setTab('overview')} className={tab === 'overview' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}>Overview</button>
          <button type="button" onClick={() => { setTab('users'); loadUsers(); }} className={tab === 'users' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}>Users</button>
          <button onClick={handleRematch} disabled={rematching} className="btn-secondary text-sm">
            {rematching ? 'Computing…' : '↻ Re-run matching'}
          </button>
        </div>
      </div>

      {tab === 'overview' && (
        <>
          {/* Weekly reflection broadcast — demo trigger */}
          <div className="card p-5 border-l-4 border-l-navy-light">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-navy mb-1">Weekly reflection check-in</h2>
                <p className="text-sm text-gray-600">
                  Sends every employee an in-app banner and (when they've granted permission) a desktop
                  notification asking them to log this week's reflection. In production this fires
                  automatically; trigger it manually here for demos.
                </p>
                {broadcastResult && (
                  <p className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 inline-flex items-center gap-2">
                    <span>✓</span>
                    <span>{broadcastResult.message}</span>
                    <span className="text-emerald-600">Employees with the app open will see it within 30 seconds.</span>
                  </p>
                )}
              </div>
              <button onClick={handleBroadcastCheckin} disabled={broadcasting} className="btn-primary text-sm whitespace-nowrap">
                {broadcasting ? 'Sending…' : '📨 Send reflection notes'}
              </button>
            </div>
          </div>

          {/* Key metrics */}
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => <div key={i} className="card p-5 h-24 animate-pulse bg-gray-100" />)}
            </div>
          ) : stats && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total employees" value={stats.totalUsers} />
                <StatCard label="Onboarding complete" value={`${stats.onboardingRate}%`} sub={`${stats.onboarded} of ${stats.totalUsers} users`} />
                <StatCard label="Sessions requested" value={(sessionsByStatus.pending || 0) + (sessionsByStatus.scheduled || 0) + (sessionsByStatus.completed || 0)} />
                <StatCard label="Match pairs" value={stats.totalMatches} />
              </div>

              <div className="card p-6">
                <h2 className="section-title">Sessions breakdown</h2>
                <div className="grid grid-cols-3 gap-4">
                  <SessionBox count={sessionsByStatus.pending || 0} label="Pending" tone="yellow" />
                  <SessionBox count={sessionsByStatus.scheduled || 0} label="Scheduled" tone="blue" />
                  <SessionBox count={sessionsByStatus.completed || 0} label="Completed" tone="green" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card p-6">
                  <h2 className="section-title">Most active mentors</h2>
                  {stats.topMentors?.length > 0 ? (
                    <div className="space-y-3">
                      {stats.topMentors.map((m, i) => (
                        <div key={m.id} className="flex items-center gap-3">
                          <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                          <div className="w-8 h-8 rounded-full bg-navy-light flex items-center justify-center text-white text-sm font-semibold">
                            {m.name?.charAt(0)}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-navy">{m.name}</p>
                            <p className="text-xs text-gray-400">{m.department}</p>
                          </div>
                          <span className="text-sm font-semibold text-gray-600">{m.session_count} sessions</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-gray-400 text-sm">No completed sessions yet.</p>}
                </div>

                <div className="card p-6">
                  <h2 className="section-title">Department activity</h2>
                  {stats.deptActivity?.length > 0 ? (
                    <div className="space-y-3">
                      {stats.deptActivity.map(d => (
                        <div key={d.department} className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="flex justify-between text-sm mb-1">
                              <span className="font-medium text-navy">{d.department}</span>
                              <span className="text-gray-500">{d.session_count} sessions</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-navy-light rounded-full" style={{ width: `${Math.min(100, (d.session_count / deptActivityMax) * 100)}%` }} />
                            </div>
                          </div>
                          {d.session_count === 0 && (
                            <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">Silo risk</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-gray-400 text-sm">No data yet.</p>}
                </div>
              </div>
            </>
          )}

          {/* Import */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 className="section-title mb-0">Import employees</h2>
                <p className="text-sm text-gray-500 mt-1">Upload a CSV or XLSX file to onboard employees in bulk.</p>
              </div>
              <button onClick={() => downloadBlob('/admin/template', 'ment-import-template.csv')} className="text-sm text-navy-light hover:text-navy font-medium">
                Download template
              </button>
            </div>

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
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${dragOver ? 'border-navy-light bg-blue-50' : 'border-gray-300 hover:border-navy-light hover:bg-gray-50'}`}
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
                  <div className="w-8 h-8 border-2 border-navy-light border-t-transparent rounded-full animate-spin mx-auto" />
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
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{uploadError}</div>
            )}
          </div>

          {/* Audit log */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
              <div>
                <h2 className="section-title mb-0">Audit log</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Recent platform events. Sensitive content (reflection text, profile field values) is never recorded — only actions and counts.
                  {auditTotal > 0 && <span className="text-gray-400 ml-1">{auditTotal} total events.</span>}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setAuditOpen(o => { if (!o) loadAudit(); return !o; }); }}
                  className="text-sm text-navy-light hover:text-navy font-medium whitespace-nowrap"
                >
                  {auditOpen ? 'Hide log' : 'Show recent events'}
                </button>
                <button
                  onClick={() => downloadBlob('/admin/audit/export', 'ment-audit-export.csv')}
                  className="text-sm text-navy-light hover:text-navy font-medium whitespace-nowrap"
                >
                  Export CSV
                </button>
              </div>
            </div>

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
          </div>
        </>
      )}

      {tab === 'users' && (
        <div className="card p-6">
          <h2 className="section-title">Users</h2>
          {usersLoading ? <p className="text-sm text-gray-500 mt-4">Loading…</p> : (
            <div className="overflow-x-auto mt-4">
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
                            <button type="button" className="text-xs text-navy-light hover:underline" onClick={() => handleSetManager(u.id, u.manager_email)}>Set manager</button>
                            <button type="button" className="text-xs text-navy-light hover:underline" onClick={() => handleResetPassword(u.id)}>Reset password</button>
                            <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => handleDeactivate(u.id)}>Deactivate</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionBox({ count, label, tone }) {
  const cls = {
    yellow: 'bg-yellow-50 border-yellow-100 text-yellow-700',
    blue:   'bg-blue-50 border-blue-100 text-blue-700',
    green:  'bg-green-50 border-green-100 text-green-700',
  }[tone];
  return (
    <div className={`text-center p-4 rounded-xl border ${cls}`}>
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
