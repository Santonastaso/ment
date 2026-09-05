import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, LayoutGrid } from 'lucide-react';
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

  // All view state lives in the URL so the top-bar search (?q=) and
  // back/forward behave. No mode chosen yet → entry prompt.
  const modeParam = searchParams.get('mode');
  const query = searchParams.get('q') || '';
  const persona = ['student', 'alumnus'].includes(searchParams.get('persona')) ? searchParams.get('persona') : '';
  const program = searchParams.get('program') || '';
  const cohort = searchParams.get('cohort') || '';
  const location = searchParams.get('location') || '';
  const language = searchParams.get('language') || '';
  const page = Math.max(Number(searchParams.get('page')) || 1, 1);
  const mode = modeParam === 'directory' ? 'directory' : 'chat';

  const [inputValue, setInputValue] = useState(query);
  const [chatResults, setChatResults] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [dirData, setDirData] = useState(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [requestingMentor, setRequestingMentor] = useState(null);

  function updateParams(mutate) {
    const next = new URLSearchParams(searchParams);
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

  // Chat-style: keyword search → top 3.
  useEffect(() => {
    if (mode !== 'chat') return;
    let cancelled = false;
    setChatLoading(true);
    const params = new URLSearchParams({ limit: '3' });
    if (query) params.set('q', query);
    if (persona) params.set('persona', persona);
    api.get(`/directory?${params.toString()}`)
      .then(res => { if (!cancelled) setChatResults(res.data); })
      .catch(() => { if (!cancelled) setChatResults({ total: 0, people: [] }); })
      .finally(() => { if (!cancelled) setChatLoading(false); });
    return () => { cancelled = true; };
  }, [mode, query, persona]);

  // Directory-style: filters + pagination, server-side.
  useEffect(() => {
    if (mode !== 'directory') return;
    let cancelled = false;
    setDirLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (persona) params.set('persona', persona);
    if (program) params.set('program', program);
    if (cohort) params.set('cohort', cohort);
    if (location) params.set('location', location);
    if (language) params.set('language', language);
    api.get(`/directory?${params.toString()}`)
      .then(res => { if (!cancelled) setDirData(res.data); })
      .catch(() => { if (!cancelled) setDirData({ total: 0, people: [], facets: {} }); })
      .finally(() => { if (!cancelled) setDirLoading(false); });
    return () => { cancelled = true; };
  }, [mode, persona, program, cohort, location, language, page]);

  function removeFromResults(personId) {
    setChatResults(prev => prev ? { ...prev, people: prev.people.filter(p => p.id !== personId) } : prev);
    setDirData(prev => prev ? { ...prev, people: prev.people.filter(p => p.id !== personId), total: Math.max(0, prev.total - 1) } : prev);
  }

  function submitChat(e) {
    e?.preventDefault();
    updateParams(next => {
      next.set('mode', 'chat');
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
    <PageShell title={t('explorer.title')} className="gap-4">

      <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'chat' ? 'default' : 'outline'}
              data-testid="mode-chat"
              onClick={() => updateParams(n => { n.set('mode', 'chat'); })}
            >
              <Search className="size-3.5" />{t('explorer.modeChat')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'directory' ? 'default' : 'outline'}
              data-testid="mode-directory"
              onClick={() => updateParams(n => { n.set('mode', 'directory'); })}
            >
              <LayoutGrid className="size-3.5" />{t('explorer.modeDirectory')}
            </Button>
          </div>

          {mode === 'chat' && (
            <>
              <Surface>
                <SurfaceBody className="space-y-3">
                  <form onSubmit={submitChat} className="flex gap-2">
                    <Input
                      autoFocus
                      placeholder={t('explorer.askPlaceholder')}
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                    />
                    <Button type="submit" disabled={chatLoading}>{t('explorer.searchButton')}</Button>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    {[['', t('explorer.personaAny')], ['student', t('explorer.personaStudent')], ['alumnus', t('explorer.personaAlumnus')]].map(([value, label]) => (
                      <Button
                        key={value || 'any'}
                        type="button"
                        size="xs"
                        variant={persona === value ? 'default' : 'outline'}
                        onClick={() => setParam('persona', value)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('explorer.chatHint')}</p>
                </SurfaceBody>
              </Surface>

              {chatLoading ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-xl" />)}
                </div>
              ) : (chatResults?.people?.length ?? 0) === 0 ? (
                <Surface>
                  <SurfaceBody className="py-12 text-center">
                    <p className="font-medium text-foreground">{t('explorer.emptyChatTitle')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t('explorer.emptyChatBody')}</p>
                  </SurfaceBody>
                </Surface>
              ) : (
                <>
                  <p className="text-sm font-medium text-muted-foreground">{t('explorer.topResultsTitle')}</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {chatResults.people.map(person => (
                      <PersonCard key={person.id} person={person} onRequest={() => setRequestingMentor(person)} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {mode === 'directory' && (
            <>
              <Surface>
                <SurfaceBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
              </Surface>

              {dirLoading ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-44 rounded-xl" />)}
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
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
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
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {dirData.people.map(person => (
                      <PersonCard key={person.id} person={person} onRequest={() => setRequestingMentor(person)} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
      </>

      {requestingMentor && (
        <SessionRequestModal
          mentor={requestingMentor}
          onClose={() => setRequestingMentor(null)}
          onSuccess={() => {
            removeFromResults(requestingMentor.id);
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
    <Surface>
      <SurfaceBody className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Avatar className="size-10">
            <AvatarFallback className="bg-muted text-sm font-medium text-foreground">{initials}</AvatarFallback>
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
            <span className="mt-1 inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {isAlumnus ? t('explorer.personaAlumnusSingular') : t('explorer.personaStudentSingular')}
            </span>
          </div>
        </div>
        {(person.skills || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {person.skills.slice(0, 4).map(s => (
              <span key={s.skill} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground">
                {s.skill}
              </span>
            ))}
            {person.skills.length > 4 && (
              <span className="rounded-full px-1 py-0.5 text-xs text-muted-foreground">+{person.skills.length - 4}</span>
            )}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2">
          <Button variant="outline" className="flex-1" onClick={onRequest}>{t('explorer.requestSession')}</Button>
          <Link to={`/profile/${person.id}`} className={buttonVariants({ variant: 'ghost', size: 'default' })}>
            {t('explorer.viewProfile')}
          </Link>
        </div>
      </SurfaceBody>
    </Surface>
  );
}
