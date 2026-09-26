import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SessionRequestModal from '../components/SessionRequestModal.jsx';
import { PageShell } from '../components/PageShell.jsx';
import { Surface, SurfaceBody } from '../components/Surface.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { languageOptions } from '../lib/languages.js';

const PAGE_SIZE = 12;

export default function Explorer() {
  const { t, lang } = useT();
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

              <div className="directory-rail grid min-w-0 gap-3">
                  <form onSubmit={submitSearch} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input aria-label={t('explorer.searchLabel')} placeholder={t('explorer.searchLabel')} value={inputValue} onChange={e => setInputValue(e.target.value)} />
                    <Button type="submit">{t('explorer.searchButton')}</Button>
                  </form>
                <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
                    {languageOptions(facets.languages, lang).map(option => (
                      <option key={option.code} value={option.code}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setInputValue(''); setSearchParams({}); }}>{t('explorer.clearFilters')}</Button>
                </div>
              </div>

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
    <article className="person-row">
      <Avatar className="person-row-avatar size-10">
        <AvatarFallback className="bg-accent text-sm font-semibold text-primary">{initials}</AvatarFallback>
      </Avatar>

      <span className="person-row-identity">
        <Link to={`/profile/${person.id}`} className="person-row-name">{person.name}</Link>
        <span className="person-row-role">
          {[
            isAlumnus ? t('explorer.personaAlumnusSingular') : t('explorer.personaStudentSingular'),
            person.current_role,
            person.program,
            person.cohort_year ? t('explorer.classOf', { year: person.cohort_year }) : null,
            person.location,
          ].filter(Boolean).join(' · ')}
        </span>
      </span>

      <span className="person-row-actions">
        <Link to={`/profile/${person.id}`} className="person-row-link">{t('explorer.viewProfile')}</Link>
        {person.session_id ? (
          <Link to={`/conversations?session=${person.session_id}`} className="person-row-action">
            {t('explorer.openChat')}
          </Link>
        ) : (
          <button type="button" className="person-row-action" onClick={onRequest}>{t('explorer.requestSession')}</button>
        )}
      </span>

      {(person.skills || []).length > 0 && (
        <span className="person-row-meta">
          {person.skills.slice(0, 4).map(s => (
            <span key={s.skill} className="person-row-chip">{s.skill}</span>
          ))}
          {person.skills.length > 4 && (
            <span className="person-row-note">+{person.skills.length - 4}</span>
          )}
        </span>
      )}
    </article>
  );
}
