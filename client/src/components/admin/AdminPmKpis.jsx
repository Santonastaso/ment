import React from 'react';
import { useT } from '../../i18n/index.jsx';
import { Surface, SurfaceBody, SurfaceHeader } from '../Surface.jsx';
import { Button } from '@/components/ui/button';
import { formatAdminDate, pmTranslate } from './adminPm.js';

export const PM_METRICS = [
  ['studentActivationRate', 'admin.kpis.studentActivation', true, 'Unique invited students with a completed profile / unique students invited in the selected cohort.'],
  ['alumniActivationRate', 'admin.kpis.alumniActivation', true, 'Unique targeted alumni with a completed profile / unique alumni targeted in the selected cohort.'],
  ['alumniEngagementRate', 'admin.kpis.alumniEngagement', true, 'Activated alumni with a human reply, completed meeting or confirmed mentoring activity / activated alumni. Acceptance alone does not qualify.'],
  ['meaningfulConnections', 'admin.kpis.meaningfulConnections', false, 'Distinct unordered pairs with messages from both humans or a completed/logged meeting. Scheduled meetings and accepted requests alone do not qualify.'],
  ['connectionCoverageRate', 'admin.kpis.connectionCoverage', true, 'Activated students with at least one meaningful connection / activated students.'],
  ['acceptanceRate', 'admin.kpis.acceptanceRate', true, 'Requests with recorded acceptance / requests sent in the same cohort. Deduplicate retries and retain acceptance after cancellation.'],
  ['replyRate', 'admin.kpis.replyRate', true, 'Accepted connections with a real human reply after acceptance / accepted connections. Excludes initial requests, assistant drafts and automated messages.'],
  ['mentorshipsFormed', 'admin.kpis.mentorshipsFormed', false, 'Distinct relationships explicitly confirmed as mentorships by both participants.'],
  ['careerConversations', 'admin.kpis.careerConversations', false, 'Explicitly logged completed career conversations, deduplicated by session/event.'],
  ['referrals', 'admin.pm.referrals', false, 'Explicit referral events, deduplicated by event identity.'],
  ['intentToContinueRate', 'admin.kpis.intentToContinue', true, 'Yes responses / all valid yes, no and unsure responses to the explicit next-term question. No responses means No data.'],
];

export function metricEvidence(data, key) {
  const definition = data?.definitions?.[key];
  const meta = data?.metadata?.[key] ?? data?.metricMetadata?.[key] ?? data?.metrics?.[key] ?? (typeof definition === 'object' ? definition : null);
  const raw = meta?.value ?? data?.[key];
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  // Legacy proxy values lack the PM evidence contract and must not look verified.
  const available = !!meta && meta.available !== false && meta.status !== 'unavailable' && value !== null;
  return { ...meta, value: available ? value : null, definition: meta?.definition ?? (typeof definition === 'string' ? definition : null) };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export default function AdminPmKpis({ data, loading, error, onRefresh }) {
  const { t: translate } = useT();
  const t = (key, vars) => pmTranslate(translate, key, vars);
  const missing = t('admin.pm.noData');
  const reporting = data?.reporting ?? data?.meta ?? {};
  const period = reporting.period ?? data?.period;
  const displayPeriod = typeof period === 'string' ? period : period ? [period.start, period.end].filter(Boolean).join(' / ') || missing : missing;
  const cohort = reporting.cohort ?? reporting.term ?? data?.cohort ?? data?.term;
  const displayCohort = typeof cohort === 'object' ? cohort?.label ?? cohort?.name ?? missing : cohort ?? missing;
  const asOf = reporting.asOf ?? reporting.as_of ?? data?.asOf ?? data?.as_of;
  const rows = PM_METRICS.map(([key, label, percent, fallback]) => {
    const meta = metricEvidence(data, key);
    const definitionKey = `admin.pm.definition.${key}`;
    const localized = translate(definitionKey);
    const definition = localized === definitionKey ? meta.definition || fallback : localized;
    const value = percent && meta.denominator === 0 ? null : meta.value;
    return { key, label: t(label), percent, ...meta, value, definition };
  });
  function exportCsv() {
    const header = ['metric', 'value', 'unit', 'numerator', 'denominator', 'period', 'cohort_term', 'as_of', 'definition', 'availability_reason', 'response_rate'];
    const records = rows.map(row => [row.label, row.value ?? missing, row.percent ? '%' : 'count', row.numerator ?? missing, row.denominator ?? missing,
      displayPeriod, displayCohort, asOf ?? missing, row.definition, row.reason ?? '', row.responseRate ?? missing]);
    const blob = new Blob(['\uFEFF', [header, ...records].map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ment-pm-kpis.csv'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Surface>
    <SurfaceHeader title={t('admin.kpis.title')} description={t('admin.kpis.desc')} action={<div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={onRefresh} disabled={loading}>{t('admin.common.refresh')}</Button>
      <Button variant="outline" onClick={exportCsv} disabled={loading || error || !data}>{t('admin.pm.export')}</Button>
    </div>} />
    <SurfaceBody className="space-y-4 pt-5">
      {loading ? <p role="status">{t('admin.common.loading')}</p> : error ? <p role="alert">{t('admin.pm.loadFailed')}</p> : <>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <p>{t('admin.pm.period')}: {displayPeriod}</p><p>{t('admin.pm.cohort')}: {displayCohort}</p><p>{t('admin.pm.asOf')}: {formatAdminDate(asOf, missing)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(row => <article key={row.key} className="min-w-0 rounded-xl border border-border p-4" data-testid={`kpi-${row.key}`}>
            <h3 className="text-sm font-medium" title={row.definition}>{row.label}</h3>
            <p className="mt-2 text-3xl font-medium tabular-nums">{row.value == null ? missing : `${row.value}${row.percent ? '%' : ''}`}</p>
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t('admin.pm.definition')}</summary>
              <p className="mt-2">{row.definition}</p>
              <p className="mt-2">{t('admin.pm.numerator')}: {row.numerator ?? missing}</p>
              {row.percent && <p>{t('admin.pm.denominator')}: {row.denominator ?? missing}</p>}
              {row.key === 'intentToContinueRate' && <p>{t('admin.pm.responseRate')}: {row.responseRate == null ? missing : `${row.responseRate}%`}</p>}
              {row.reason && <p className="mt-2">{row.reason}</p>}
            </details>
          </article>)}
        </div>
      </>}
    </SurfaceBody>
  </Surface>;
}
