import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import api from '../../api/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Surface, SurfaceBody, SurfaceHeader } from '../Surface.jsx';
import { useT } from '../../i18n/index.jsx';

export default function AdminProvisionUserPanel() {
  const { t } = useT();
  const { user } = useAuth();
  const isPlatformAdmin = user?.admin_scope === 'platform';
  const [accountType, setAccountType] = useState('member');
  const [form, setForm] = useState({ email: '', name: '', organizationId: '' });
  const [organizations, setOrganizations] = useState([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [organizationsError, setOrganizationsError] = useState(false);
  const [adminReady, setAdminReady] = useState(null);
  const [adminReadinessError, setAdminReadinessError] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isPlatformAdmin || accountType !== 'admin') return undefined;
    let active = true;
    setOrganizationsLoading(true);
    setOrganizationsError(false);
    api.get('/admin/owner-stats').then(({ data }) => {
      if (active) setOrganizations(data?.organizations || []);
    }).catch(() => {
      if (active) setOrganizationsError(true);
    }).finally(() => {
      if (active) setOrganizationsLoading(false);
    });
    return () => { active = false; };
  }, [isPlatformAdmin, accountType]);

  useEffect(() => {
    if (!isPlatformAdmin || accountType !== 'admin') return undefined;
    let active = true;
    setAdminReady(null);
    setAdminReadinessError('');
    supabase.functions.invoke('admin-create-user', { body: { action: 'capabilities' } })
      .then(async ({ data, error: invokeError }) => {
        if (!active) return;
        if (!invokeError && data?.create_org_admin === true) {
          setAdminReady(true);
          return;
        }
        const details = await invokeError?.context?.json?.().catch(() => null);
        setAdminReady(false);
        setAdminReadinessError(details?.error === 'storage_path_required'
          ? 'admin.provision.featureUnavailable' : 'admin.provision.readinessFailed');
      })
      .catch(() => {
        if (active) {
          setAdminReady(false);
          setAdminReadinessError('admin.provision.readinessFailed');
        }
      });
    return () => { active = false; };
  }, [isPlatformAdmin, accountType]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setResult(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-create-user', {
        body: {
          action: accountType === 'admin' ? 'create_org_admin' : 'create_single',
          email: form.email,
          name: form.name,
          ...(accountType === 'admin' ? { organization_id: form.organizationId } : {}),
        },
      });
      if (invokeError) {
        const details = await invokeError.context?.json?.().catch(() => null);
        throw new Error(details?.error || invokeError.message);
      }
      if (data?.error) throw new Error(data.error);
      setResult(data);
      setForm(current => ({ ...current, email: '', name: '' }));
    } catch (requestError) {
      const messages = {
        storage_path_required: 'admin.provision.featureUnavailable',
        account_already_exists: 'admin.provision.accountExists',
        account_not_attachable: 'admin.provision.accountNotAttachable',
        member_already_provisioned: 'admin.provision.accountExists',
        organization_not_found: 'admin.provision.organizationMissing',
        organization_required: 'admin.provision.chooseOrganization',
        platform_admin_required: 'admin.provision.notAllowed',
        admin_profile_create_failed: 'admin.provision.createFailed',
      };
      setError(t(messages[requestError.message] || 'admin.provision.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function copyCredentials() {
    await navigator.clipboard.writeText(`${t('admin.users.email')}: ${result.email}\n${t('admin.provision.temporaryPassword')}: ${result.temp_password}`);
  }

  return (
    <Surface className="mb-5">
      <SurfaceHeader title={t('admin.provision.title')} description={t('admin.provision.description')} />
      <SurfaceBody className="pt-3">
      <form onSubmit={submit} className="grid gap-3">
        <div className="max-w-xs">
          <Label htmlFor="provision-account-type">{t('admin.provision.accountType')}</Label>
          <select id="provision-account-type" className="input filter-control mt-1 w-full" value={accountType}
            onChange={event => { setAccountType(event.target.value); setResult(null); setError(''); }}>
            <option value="member">{t('admin.provision.memberOption')}</option>
            {isPlatformAdmin && <option value="admin">{t('admin.provision.adminOption')}</option>}
          </select>
        </div>
        {accountType === 'admin' && isPlatformAdmin && (
          <div className="max-w-md">
            <Label htmlFor="provision-organization">{t('admin.provision.organization')}</Label>
            <select id="provision-organization" className="input filter-control mt-1 w-full" required
              value={form.organizationId} disabled={organizationsLoading || organizationsError}
              onChange={event => setForm(current => ({ ...current, organizationId: event.target.value }))}>
              <option value="">{t('admin.provision.chooseOrganization')}</option>
              {organizations.map(organization => <option key={organization.organizationId} value={organization.organizationId}>{organization.organizationName}</option>)}
            </select>
            {organizationsError && <p role="alert" className="mt-1 text-sm text-destructive">{t('admin.provision.organizationsLoadFailed')}</p>}
            {adminReady === null && <p role="status" className="mt-1 text-sm text-muted-foreground">{t('admin.provision.checkingAvailability')}</p>}
            {adminReadinessError && <p role="alert" className="mt-1 text-sm text-destructive">{t(adminReadinessError)}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{t('admin.provision.adminAccessHelp')}</p>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Label htmlFor="provision-email">{t('admin.users.email')}</Label>
          <Input id="provision-email" type="email" autoComplete="off" required value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
        </div>
        <div className="min-w-56 flex-1">
          <Label htmlFor="provision-name">{t('admin.provision.fullName')}</Label>
          <Input id="provision-name" autoComplete="off" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </div>
        <Button type="submit" disabled={saving || (accountType === 'admin' && (adminReady !== true || organizationsLoading || organizationsError || !form.organizationId))}>
          {saving ? t('admin.provision.creating') : t(accountType === 'admin' ? 'admin.provision.createAdmin' : 'admin.provision.create')}
        </Button>
        </div>
      </form>
      {result && <div role="status" className="mt-4 rounded-[var(--item-radius)] bg-muted p-3 text-sm">
        {result.created ? <>
          <p className="font-medium">{t(result.scope === 'org' ? 'admin.provision.adminCreated' : 'admin.provision.created')}</p>
          <p className="mt-1">{result.email} · {t('admin.provision.temporaryPassword')}: <code className="select-all font-mono">{result.temp_password}</code></p>
          <Button className="mt-2" type="button" size="sm" variant="outline" onClick={copyCredentials}>{t('admin.provision.copyCredentials')}</Button>
        </> : <p>{t('admin.provision.existing')}</p>}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </SurfaceBody>
    </Surface>
  );
}
