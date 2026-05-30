import React, { useEffect, useState } from 'react';
import { Lock, Users } from 'lucide-react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody, SurfaceHeader } from '../components/Surface.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export default function TeamSkills() {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/team/skill-gaps');
        setData(res.data);
      } catch (e) {
        setError(e.response?.data?.error || t('team.loadError'));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  if (loading) {
    return (
      <PageShell title={t('team.title')}>
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title={t('team.title')}>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </PageShell>
    );
  }

  const { reportCount, gated, gaps, strengths, message } = data || {};

  return (
    <PageShell
      title={t('team.title')}
      description={t('team.description')}
    >
      <Alert className="border-primary/20 bg-primary/5">
        <AlertTitle>{t('team.privacyTitle')}</AlertTitle>
        <AlertDescription>
          {t('team.privacyBody')}
        </AlertDescription>
      </Alert>

      {reportCount === 0 && (
        <Surface>
          <SurfaceBody className="py-12 text-center">
            <Users className="mx-auto size-10 text-muted-foreground mb-3" />
            <p className="font-semibold">{t('team.noReportsTitle')}</p>
            <p className="text-sm text-muted-foreground mt-1">{message}</p>
          </SurfaceBody>
        </Surface>
      )}

      {gated && (
        <Surface>
          <SurfaceBody className="py-12 text-center">
            <Lock className="mx-auto size-10 text-muted-foreground mb-3" />
            <p className="font-semibold">{t('team.suppressedTitle')}</p>
            <p className="text-sm text-muted-foreground mt-1">{message}</p>
          </SurfaceBody>
        </Surface>
      )}

      {!gated && reportCount > 0 && (
        <>
          <Surface>
            <SurfaceBody>
              <p className="text-sm text-muted-foreground">{t('team.reportingOn')}</p>
              <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight">
                {reportCount}
                <span className="ml-2 text-lg font-medium text-muted-foreground">{t('team.directReports')}</span>
              </p>
            </SurfaceBody>
          </Surface>

          <div className="grid gap-6 lg:grid-cols-2">
            <Surface>
              <SurfaceHeader title={t('team.topGapsTitle')} description={t('team.topGapsDesc')} />
              <SurfaceBody className="pt-5">
                {gaps.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">{t('team.noGapData')}</p>
                ) : (
                  <ul className="space-y-4">
                    {gaps.map((g, i) => (
                      <SkillRow key={g.skill} rank={i + 1} item={g} variant="gap" />
                    ))}
                  </ul>
                )}
              </SurfaceBody>
            </Surface>

            <Surface>
              <SurfaceHeader title={t('team.topStrengthsTitle')} description={t('team.topStrengthsDesc')} />
              <SurfaceBody className="pt-5">
                {strengths.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">{t('team.noStrengthData')}</p>
                ) : (
                  <ul className="space-y-4">
                    {strengths.map((s, i) => (
                      <SkillRow key={s.skill} rank={i + 1} item={s} variant="strength" />
                    ))}
                  </ul>
                )}
              </SurfaceBody>
            </Surface>
          </div>
        </>
      )}
    </PageShell>
  );
}

function SkillRow({ rank, item, variant }) {
  const isGap = variant === 'gap';
  return (
    <li className="grid grid-cols-[2rem_1fr_auto] items-center gap-3">
      <span className="text-right text-sm font-semibold tabular-nums text-muted-foreground">{rank}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug">{item.skill}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${isGap ? 'bg-destructive/80' : 'bg-emerald-600'}`}
            style={{ width: `${Math.min(100, item.share)}%` }}
          />
        </div>
      </div>
      <Badge variant={isGap ? 'destructive' : 'secondary'} className="justify-self-end sm:col-start-3">
        {item.share}%
      </Badge>
    </li>
  );
}
