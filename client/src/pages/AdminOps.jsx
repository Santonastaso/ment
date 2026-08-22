import React, { useState, useEffect } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody, SurfaceHeader } from '../components/Surface.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

function shortId(value) {
  return value ? `${String(value).slice(0, 8)}â€¦` : 'â€”';
}

function formatDate(value) {
  if (!value) return 'â€”';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminOps() {
  const { t } = useT();
  const [ownerStats, setOwnerStats] = useState(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [orgNameDraft, setOrgNameDraft] = useState('');
  const [orgTypeDraft, setOrgTypeDraft] = useState('intra');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [accessRequests, setAccessRequests] = useState([]);
  const [accessRequestTotal, setAccessRequestTotal] = useState(0);
  const [accessRequestsLoading, setAccessRequestsLoading] = useState(false);
  const [updatingRequestId, setUpdatingRequestId] = useState(null);
  const [notice, setNotice] = useState(null);

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

  useEffect(() => { loadOwnerStats(); loadAccessRequests(); }, []);

  async function handleCreateOrganization(e) {
    e.preventDefault();
    const name = orgNameDraft.trim();
    if (!name) return;
    setCreatingOrg(true);
    setNotice(null);
    try {
      const res = await api.post('/admin/organizations', { name, type: orgTypeDraft });
      setOrgNameDraft('');
      setOrgTypeDraft('intra');
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
    const header = ['org_name', 'slug', 'org_id', 'users', 'onboarded', 'onboarding_rate', 'active_30d', 'sessions', 'churned', 'churn_rate'];
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
      org.churnRate ?? 0,
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

  return (
    <PageShell title={t('admin.ops.title')} description={t('admin.ops.description')}>

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
            <div className="space-y-2">
              <Label htmlFor="organization-type">{t('admin.orgs.typeLabel')}</Label>
              <select
                id="organization-type"
                value={orgTypeDraft}
                onChange={e => setOrgTypeDraft(e.target.value)}
                className="input text-sm h-10"
              >
                <option value="intra">{t('admin.privacy.modeIntra')}</option>
                <option value="inter">{t('admin.privacy.modeInter')}</option>
              </select>
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
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">{t('admin.orgs.colOrganization')}</th>
                    <th className="py-2 pr-4">{t('admin.orgs.colOrgId')}</th>
                    <th className="py-2 pr-4">{t('admin.orgs.colUsers')}</th>
                    <th className="py-2 pr-4">{t('admin.orgs.colOnboarded')}</th>
                    <th className="py-2 pr-4">{t('admin.orgs.colActive30d')}</th>
                    <th className="py-2 pr-4">{t('admin.orgs.colSessions')}</th>
                    <th className="py-2 pr-4">{t('admin.orgs.colChurned')}</th>
                    <th className="py-2">{t('admin.orgs.colChurnRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ownerStats.organizations.map(org => (
                    <tr key={org.organizationId} className="border-b border-[var(--border-subtle)]">
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
                      <td className="py-2 pr-4 tabular-nums">{org.churned}</td>
                      <td className="py-2 tabular-nums">{org.churnRate ?? 0}%</td>
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
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">{t('admin.access.colSubmitted')}</th>
                    <th className="py-2 pr-4">{t('admin.access.colContact')}</th>
                    <th className="py-2 pr-4">{t('admin.access.colCompany')}</th>
                    <th className="py-2 pr-4">{t('admin.access.colNote')}</th>
                    <th className="py-2">{t('admin.access.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {accessRequests.map(request => (
                    <tr key={request.id} className="border-b border-[var(--border-subtle)] align-top">
                      <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{formatDate(request.createdAt)}</td>
                      <td className="py-2 pr-4">
                        <p className="font-medium">{request.name}</p>
                        <p className="text-xs text-muted-foreground">{request.email}</p>
                      </td>
                      <td className="py-2 pr-4">
                        <p className="font-medium">{request.company}</p>
                        <p className="text-xs text-muted-foreground">{request.companySize} Â· {request.role}</p>
                      </td>
                      <td className="max-w-sm py-2 pr-4 text-muted-foreground">
                        <p className="line-clamp-3 whitespace-pre-wrap">{request.note || 'â€”'}</p>
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
    </PageShell>
  );
}
