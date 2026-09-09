import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SessionRequestModal from '../components/SessionRequestModal.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody } from '../components/Surface.jsx';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';

const PAGE_SIZE = 12;

export default function Explorer() {
  const { t } = useT();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL state supports direct links and browser navigation.
  const query = searchParams.get('q') || '';
  const persona = ['student', 'alumnus'].includes(searchParams.get('persona')) ? searchParams.get('persona') : '';
  const program = searchParams.get('program') || '';
  const cohort = searchParams.get('cohort') || '';
  const location = searchParams.get('location') || '';
  const language = searchParams.get('language') || '';
  const page = Number.isSafeInteger(Number(searchParams.get('page'))) && Number(searchParams.get('page')) > 0 ? Number(searchParams.get('page')) : 1;

  const [inputValue, setInputValue] = useState(query);
  const [dirError, setDirError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [dirData, setDirData] = useState(null);
  const [dirLoading, setDirLoading] = useState(true);
  const [requestingMentor, setRequestingMentor] = useState(null);

  function updateParams(mutate) {
    const next = new URLSearchParams(searchParams);
    next.delete('mode');
    mutate(next);
    setSearchParams(next);
  }

  function setParam(key, value) {
    updateParams(next => {
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'page') next.delete('page');
    });
  }

  // Keep the input in sync when ?q= changes externally (top-bar search).
  useEffect(() => { setInputValue(query); }, [query]);

  // Directory-style: filters + pagination, server-side.
  useEffect(() => {
    let cancelled = false;
    setDirLoading(true);
    setDirError(false);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (query) params.set('q', query);
    if (persona) params.set('persona', persona);
    if (program) params.set('program', program);
    if (cohort) params.set('cohort', cohort);
    if (location) params.set('location', location);
    if (language) params.set('language', language);
    api.get(`/directory?${params.toString()}`)
      .then(res => {
        if (cancelled) return;
        setDirData(res.data);
        const lastPage = Math.max(1, Math.ceil(res.data.total / PAGE_SIZE));
        if (page > lastPage) setSearchParams(previous => {
          const next = new URLSearchParams(previous);
          if (lastPage === 1) next.delete('page'); else next.set('page', String(lastPage));
          return next;
        }, { replace: true });
      })
      .catch(() => { if (!cancelled) setDirError(true); })
      .finally(() => { if (!cancelled) setDirLoading(false); });
    return () => { cancelled = true; };
  }, [query, persona, program, cohort, location, language, page, retry]);

  function submitSearch(e) {
    e?.preventDefault();
    updateParams(next => {
      if (inputValue.trim()) next.set('q', inputValue.trim()); else next.delete('q');
      next.delete('page');
    });
  }

  const facets = dirData?.facets || {};
  const total = dirData?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <PageShell title={t('explorer.title')} description={t('explorer.entryTitle')} className="gap-6">

              <Surface className="directory-rail directory-filter-panel rounded-none border-0 bg-transparent">
                <SurfaceBody className="space-y-3 px-0 py-0">
                  <form onSubmit={submitSearch} className="flex gap-2">
                    <Input aria-label={t('explorer.searchLabel')} placeholder={t('explorer.searchLabel')} value={inputValue} onChange={e => setInputValue(e.target.value)} />
                    <Button type="submit">{t('explorer.searchButton')}</Button>
                  </form>
                </SurfaceBody>
                <SurfaceBody className="grid grid-cols-2 gap-2 px-0 pb-0 pt-3 sm:grid-cols-3 lg:grid-cols-5">
                  <select className="input w-full" value={persona} onChange={e => setParam('persona', e.target.value)} aria-label={t('explorer.filterPersona')}>
                    <option value="">{t('explorer.personaAny')}</option>
                    <option value="student">{t('explorer.personaStudent')}</option>
                    <option value="alumnus">{t('explorer.personaAlumnus')}</option>
                  </select>
                  <select className="input w-full" value={program} onChange={e => setParam('program', e.target.value)} aria-label={t('explorer.filterProgram')}>
                    <option value="">{t('explorer.allPrograms')}</option>
                    {(facets.programs || []).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select className="input w-full" value={cohort} onChange={e => setParam('cohort', e.target.value)} aria-label={t('explorer.filterCohort')}>
                    <option value="">{t('explorer.allCohorts')}</option>
                    {(facets.cohortYears || []).map(y => <option key={y} value={String(y)}>{t('explorer.classOf', { year: y })}</option>)}
                  </select>
                  <select className="input w-full" value={location} onChange={e => setParam('location', e.target.value)} aria-label={t('explorer.filterLocation')}>
                    <option value="">{t('explorer.allLocations')}</option>
                    {(facets.locations || []).map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <select className="input w-full" value={language} onChange={e => setParam('language', e.target.value)} aria-label={t('explorer.filterLanguage')}>
                    <option value="">{t('explorer.allLanguages')}</option>
                    {(facets.languages || []).map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                  </select>
                </SurfaceBody>
                <SurfaceBody className="px-0 pb-0 pt-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setInputValue(''); setSearchParams({}); }}>{t('explorer.clearFilters')}</Button>
                </SurfaceBody>
              </Surface>

              {dirError ? (
                <Surface><SurfaceBody className="space-y-3" role="alert">
                  <p role="alert">{t('explorer.directoryError')}</p>
                  <Button onClick={() => setRetry(n => n + 1)}>{t('explorer.retry')}</Button>
                </SurfaceBody></Surface>
              ) : dirLoading ? (
                <div className="grid gap-1">
                  {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="my-3 h-20 rounded-lg" />)}
                </div>
              ) : total === 0 ? (
                <Surface>
                  <SurfaceBody className="py-12 text-center">
                    <p className="font-medium text-foreground">{t('explorer.directoryEmptyTitle')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t('explorer.directoryEmptyBody')}</p>
                  </SurfaceBody>
                </Surface>
              ) : (
                <>
                  <div className="directory-rail flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span>{t('explorer.showing', { from, to, total })}</span>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                        {t('explorer.prev')}
                      </Button>
                      <span className="tabular-nums">{page}/{pageCount}</span>
                      <Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setParam('page', String(page + 1))}>
                        {t('explorer.next')}
                      </Button>
                    </div>
                  </div>
                  <div className="directory-rail grid gap-1">
                    {dirData.people.map(person => (
                      <PersonCard key={person.id} person={person} onRequest={() => setRequestingMentor(person)} />
                    ))}
                  </div>
                </>
              )}

      {requestingMentor && (
        <SessionRequestModal
          mentor={requestingMentor}
          onClose={() => setRequestingMentor(null)}
          onSuccess={(session) => {
            setDirData((current) => current ? {
              ...current,
              people: current.people.map((person) => person.id === requestingMentor.id
                ? { ...person, relationship_status: session.status, session_id: session.id }
                : person),
            } : current);
            setRequestingMentor(null);
          }}
        />
      )}
    </PageShell>
  );
}

function PersonCard({ person, onRequest }) {
  const { t } = useT();
  const initials = (person.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const isAlumnus = person.role === 'alumnus';

  return (
    <article className="directory-person-row grid max-w-full gap-3 rounded-[var(--panel-radius)] py-3 pl-3 hover:bg-[var(--control-surface)] md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] md:items-center xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto]">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar className="size-10">
            <AvatarFallback className="bg-accent text-sm font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <Link to={`/profile/${person.id}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline">
              {person.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {[
                person.program,
                person.cohort_year ? t('explorer.classOf', { year: person.cohort_year }) : null,
                person.current_role,
                person.location,
              ].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-1 text-[11px] font-medium text-muted-foreground">
              {isAlumnus ? t('explorer.personaAlumnusSingular') : t('explorer.personaStudentSingular')}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          {(person.skills || []).length > 0 && (
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            {person.skills.slice(0, 4).map(s => (
              <span key={s.skill} className="text-xs text-muted-foreground">
                {s.skill}
              </span>
            ))}
            {person.skills.length > 4 && (
              <span className="rounded-full px-1 py-0.5 text-xs text-muted-foreground">+{person.skills.length - 4}</span>
            )}
          </div>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 md:col-span-2 xl:col-span-1 xl:flex-nowrap">
          {person.session_id ? (
            <Link to={`/conversations?session=${person.session_id}`} className={buttonVariants({ variant: 'outline', size: 'default' })}>
              {t('explorer.openChat')}
            </Link>
          ) : (
            <Button variant="outline" onClick={onRequest}>{t('explorer.requestSession')}</Button>
          )}
          <Link to={`/profile/${person.id}`} className={buttonVariants({ variant: 'ghost', size: 'default' })}>
            {t('explorer.viewProfile')}
          </Link>
        </div>
    </article>
  );
}
