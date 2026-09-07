import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/index.js';
import { supabase } from '../../lib/supabase.js';
import { useT } from '../../i18n/index.jsx';
import { Button } from '../ui/button.jsx';
import { Surface, SurfaceBody } from '../Surface.jsx';
import { classifyNeed, discoveryReply, loadConversationCandidates, suggestPeople } from './homeDemo.js';
import { homeCopy } from './homeCopy.js';
import { threadStore } from './homeThreads.js';

export default function HomeConversation({ userId, sessions, onRequest }) {
  const { lang } = useT();
  const copy = homeCopy(lang);
  const [threads, setThreads] = useState([]);
  const [thread, setThread] = useState(null);
  const [input, setInput] = useState('');
  const [intent, setIntent] = useState('one_off');
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [unsaved, setUnsaved] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const locked = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const token = ++generation.current;
    setThread(null); setThreads([]); setPeople([]); setInput(''); setUnsaved(null);
    setBusy(true); setError(''); setLoadFailed(false);
    if (!userId) { setBusy(false); return; }
    threadStore(supabase, userId).list().then(async rows => {
      if (generation.current !== token) return;
      setThreads(rows); setThread(rows[0] || null); setIntent(rows[0]?.intent || 'one_off');
      if (rows.length) {
        try {
          const directory = await loadConversationCandidates(api);
          if (generation.current === token) setPeople(directory);
        } catch { if (generation.current === token) setError('error'); }
      }
    }).catch(() => {
      if (generation.current === token) { setError('loadError'); setLoadFailed(true); }
    }).finally(() => { if (generation.current === token) setBusy(false); });
    return () => { generation.current++; };
  }, [userId, reload]);

  async function persist(next) {
    setThread(next.archived ? null : next);
    setThreads(prev => next.archived ? prev.filter(t => t.id !== next.id) : [next, ...prev.filter(t => t.id !== next.id)]);
    try {
      await threadStore(supabase, userId).save(next);
      setUnsaved(null); setError('');
    } catch { setUnsaved(next); setError('saveError'); }
  }

  async function send(event) {
    event.preventDefault();
    if (!input.trim() || locked.current || unsaved || !userId) return;
    locked.current = true; setBusy(true); setError('');
    const token = generation.current;
    try {
      const question = input.trim();
      const previousQuestion = (thread?.turns || []).filter(t => t.role === 'user').map(t => t.text).join('\n');
      const directory = classifyNeed(question) || classifyNeed(previousQuestion) ? await loadConversationCandidates(api) : [];
      if (generation.current !== token) return;
      setPeople(directory);
      const reply = discoveryReply({ question, previousQuestion, people: directory, userId, intent });
      const next = {
        ...(thread || { id: crypto.randomUUID(), user_id: userId, title: question.slice(0, 80), archived: false, selected_person_id: null }),
        intent: reply.intent,
        turns: [...(thread?.turns || []), { role: 'user', text: question }, { role: 'assistant', kind: reply.kind, scenario: reply.scenario || null, person_ids: reply.suggestions.map(s => s.person.id), demo: true }],
      };
      setIntent(reply.intent); setInput(''); await persist(next);
    } catch { if (generation.current === token) setError('error'); }
    finally { locked.current = false; if (generation.current === token) setBusy(false); }
  }

  async function selectPerson(person) {
    if (busy || unsaved || locked.current) return;
    locked.current = true; setBusy(true);
    try {
      await persist({ ...thread, selected_person_id: person.id, intent });
      onRequest(person, { question: thread.turns.filter(t => t.role === 'user').map(t => t.text).join('\n'), intent });
    } finally { locked.current = false; setBusy(false); }
  }

  const question = (thread?.turns || []).filter(t => t.role === 'user').map(t => t.text).join('\n');
  const relationships = [...new Map(sessions.filter(s => s.status !== 'cancelled').map(s => {
    const person = s.mentor?.id === userId ? s.mentee : s.mentor;
    return [person?.id, { person, session: s }];
  })).values()].filter(r => r.person?.id);
  const selectedRelationship = relationships.find(r => r.person.id === thread?.selected_person_id);
  return <Surface><SurfaceBody className="space-y-5 py-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><span className="text-xs font-medium text-primary">{copy.badge}</span><h2 className="mt-1 text-lg font-medium">{copy.title}</h2><p className="mt-1 max-w-xl text-sm text-muted-foreground">{copy.intro}</p></div>
      <Link className="text-sm text-primary underline underline-offset-4" to={`/explorer?mode=directory${classifyNeed(question) === 'mentorship' ? '&persona=alumnus' : ''}`}>{copy.browse}</Link>
    </div>
    {relationships.length > 0 && <div className="space-y-2"><h3 className="text-sm font-medium">{copy.relationships}</h3><div className="flex flex-wrap gap-2">{relationships.map(({ person, session }) => <a className="rounded-lg border px-3 py-2 text-sm hover:bg-muted" key={person.id} href={`#home-session-${session.id}`}>{person.name} · {copy.resume}</a>)}</div></div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={busy || !!unsaved} onClick={() => { setThread(null); setInput(''); setIntent('one_off'); setError(''); }}>{copy.newSearch}</Button>
      {threads.length > 0 && <label className="text-sm">{copy.recent}<select className="ml-2 max-w-full rounded border bg-background p-2" value={thread?.id || ''} disabled={busy || !!unsaved} onChange={e => { const selected = threads.find(t => t.id === e.target.value); setThread(selected || null); setIntent(selected?.intent || 'one_off'); setInput(''); }}><option value="">{copy.continue}</option>{threads.map(t => <option value={t.id} key={t.id}>{t.title}</option>)}</select></label>}
      {thread && <Button variant="ghost" disabled={busy || !!unsaved} onClick={async () => { setBusy(true); await persist({ ...thread, archived: true }); setBusy(false); }}>{copy.archive}</Button>}
    </div>
    <div role="log" aria-live="polite" aria-label={copy.badge} className="max-h-[32rem] space-y-4 overflow-y-auto">
      {!thread?.turns?.length && <p className="rounded-xl bg-muted/40 p-4 text-sm">{copy.clarify}</p>}
      {thread?.turns?.map((turn, index) => <div key={index} className={`rounded-xl p-4 text-sm ${turn.role === 'user' ? 'ml-4 bg-muted' : 'border border-border'}`}>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{turn.role === 'user' ? copy.you : copy.badge}</p>
        <p className="whitespace-pre-wrap break-words">{turn.role === 'user' ? turn.text : copy[turn.kind] || copy.clarify}</p>
        {turn.kind === 'results' && suggestPeople({ question, scenario: turn.scenario, people, userId }).filter(s => turn.person_ids?.includes(s.person.id)).map(({ person, evidence }) => {
          const existing = relationships.find(r => r.person.id === person.id);
          const role = [person.job_title || person.current_role, person.department].filter(Boolean).join(' · ');
          const availability = person.mentorship_available === false ? copy.unavailable : copy.available;
          return <div key={person.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3"><div className="min-w-0 space-y-1"><p className="font-medium">{person.name}</p>{role && <p className="text-xs text-muted-foreground">{role}</p>}<p className="break-words text-xs text-muted-foreground">{copy.evidence}: {evidence.join(', ')}</p><p className="text-xs font-medium text-emerald-700">{availability}</p></div>{existing ? <a className="text-primary underline" href={`#home-session-${existing.session.id}`}>{copy.resume}</a> : <Button size="sm" variant="outline" disabled={busy || !!unsaved} onClick={() => selectPerson(person)}>{copy.request}</Button>}</div>;
        })}
      </div>)}
    </div>
    {selectedRelationship && <a className="block text-sm text-primary underline" href={`#home-session-${selectedRelationship.session.id}`}>{copy.selected}: {selectedRelationship.person.name} · {copy.resume}</a>}
    {error && <div role="alert" className="text-sm text-destructive">{copy[error]} {unsaved && <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); await persist(unsaved); setBusy(false); }}>{copy.retry}</Button>}{loadFailed && <Button variant="outline" onClick={() => setReload(n => n + 1)}>{copy.retry}</Button>}{error === 'error' && !input && <Button variant="outline" onClick={() => setReload(n => n + 1)}>{copy.retry}</Button>}</div>}
    <form onSubmit={send} className="space-y-3">
      <label className="block text-sm">{copy.intent}<select className="ml-2 rounded border bg-background p-2" value={intent} disabled={busy} onChange={e => setIntent(e.target.value)}><option value="one_off">{copy.oneOff}</option><option value="ongoing">{copy.ongoing}</option></select></label>
      <label className="sr-only" htmlFor="home-question">{copy.title}</label>
      <textarea id="home-question" className="input min-h-24 w-full resize-y" maxLength={2000} value={input} onChange={e => setInput(e.target.value)} placeholder={copy.placeholder} disabled={busy || !!unsaved} />
      <div className="flex justify-end"><Button type="submit" disabled={busy || !!unsaved || !input.trim() || !userId}>{busy ? copy.busy : copy.send}</Button></div>
    </form>
  </SurfaceBody></Surface>;
}
