import React, { useEffect, useState } from 'react';
import api from '../../api/index.js';
import { Surface, SurfaceBody, SurfaceHeader } from '../Surface.jsx';
import { Button } from '@/components/ui/button';
import { formatAdminDate } from './adminPm.js';

const FEATURES = ['discovery_match', 'discovery_draft', 'profile_ingest', 'reflection'];

export default function AdminAiRuns({ t }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const { data } = await api.get('/admin/ai-runs?limit=100');
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const failures = runs.filter(run => run.status === 'failed').length;
  const averageLatency = runs.length
    ? Math.round(runs.reduce((sum, run) => sum + (Number(run.latency_ms) || 0), 0) / runs.length)
    : 0;

  return <Surface>
    <SurfaceHeader title={t('admin.ai.title')} description={t('admin.ai.description')} action={
      <Button type="button" variant="outline" onClick={load} disabled={loading}>
        {loading ? t('admin.common.refreshing') : t('admin.common.refresh')}
      </Button>
    } />
    <SurfaceBody className="space-y-5 pt-5">
      {loading ? <p role="status">{t('admin.common.loading')}</p> : error ? <p role="alert">{t('admin.ai.loadFailed')}</p> : <>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [t('admin.ai.runs'), runs.length],
            [t('admin.ai.failures'), failures],
            [t('admin.ai.avgLatency'), `${averageLatency} ms`],
          ].map(([label, value]) => <div key={label} className="rounded-xl bg-muted/60 px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-medium tabular-nums">{value}</p>
          </div>)}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {FEATURES.map(feature => <span key={feature} className="text-muted-foreground">
            {t(`admin.ai.feature.${feature}`)} <strong className="text-foreground">{runs.filter(run => run.feature === feature).length}</strong>
          </span>)}
        </div>
        {runs.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.ai.noRuns')}</p> : <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>{['feature', 'status', 'model', 'latency', 'date'].map(key => <th key={key} className="px-3 py-2 font-medium">{t(`admin.ai.${key}`)}</th>)}</tr>
            </thead>
            <tbody>
              {runs.map((run, index) => <tr key={`${run.created_at}-${index}`} className="border-t border-border/70">
                <td className="px-3 py-2">{t(`admin.ai.feature.${run.feature}`)}</td>
                <td className={`px-3 py-2 ${run.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {run.status === 'failed' ? `${t('admin.ai.failed')}${run.error_code ? ` · ${run.error_code}` : ''}` : t('admin.ai.succeeded')}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{run.model}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{run.latency_ms} ms</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatAdminDate(run.created_at)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      </>}
    </SurfaceBody>
  </Surface>;
}
