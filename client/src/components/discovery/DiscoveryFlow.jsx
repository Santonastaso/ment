import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Pencil, RefreshCw, Send, Sparkles } from 'lucide-react';
import api from '../../api/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { createDiscoveryDraft, getDiscoveryMatches, loadConversationCandidates } from '../demo/homeDemo.js';

const COPY = {
  en: {
    greeting: 'What are you working on, {name}?', subline: 'Describe it in a sentence. Ment finds the right people for you.',
    placeholder: 'Help me prepare for an internship interview in consulting...', starters: ['Prep for a case interview', 'Find a mentor in strategy', 'Review my CV.'],
    addContext: 'Add context', directory: 'Directory', finding: 'Finding people who can help', chooseLead: 'Three people stood out for this. Pick who you would like to reach.', chooseBold: "I'll draft a warm intro for you.",
    why: 'Why this match', available: 'Available', choose: 'Choose', selected: 'Selected', different: 'Ask for different people', browse: 'browse the full directory', notRight: 'Not quite right?',
    to: 'To', intro: "Here's a suggested intro. Edit anything, then send when it feels like you.", suggested: 'Suggested draft', send: 'Send request', regenerate: 'Regenerate', edit: 'Edit', remaining: '{count} requests left this month',
    sent: 'Request sent to {name}.', sentSubline: "We'll let you know as soon as they reply.", again: 'Ask about something else', retry: 'Try again', error: 'We could not complete that request. Please try again.', noMatches: 'No available matches yet. Try a different angle or browse the directory.',
  },
  it: {
    greeting: 'Su cosa stai lavorando, {name}?', subline: 'Descrivilo in una frase. Ment trova le persone giuste per te.',
    placeholder: 'Aiutami a preparare un colloquio per un tirocinio in consulenza...', starters: ['Preparare un case interview', 'Trovare un mentor nella strategia', 'Rivedere il mio CV'],
    addContext: 'Aggiungi contesto', directory: 'Directory', finding: 'Cerco persone che possono aiutarti', chooseLead: 'Tre persone si distinguono per questa richiesta. Scegli chi contattare.', chooseBold: 'Preparerò un messaggio per te.',
    why: 'Perché questa persona', available: 'Disponibile', choose: 'Scegli', selected: 'Scelto', different: 'Mostra altre persone', browse: 'sfoglia la directory', notRight: 'Non è quello che cercavi?',
    to: 'A', intro: 'Ecco un messaggio proposto. Modifica tutto quello che vuoi, poi invialo quando ti sembra giusto.', suggested: 'Messaggio proposto', send: 'Invia richiesta', regenerate: 'Rigenera', edit: 'Modifica', remaining: '{count} richieste rimaste questo mese',
    sent: 'Richiesta inviata a {name}.', sentSubline: 'Ti avviseremo non appena riceverai una risposta.', again: 'Chiedi qualcos altro', retry: 'Riprova', error: 'Non siamo riusciti a completare la richiesta. Riprova.', noMatches: 'Non ci sono ancora corrispondenze disponibili. Prova un altro approccio o sfoglia la directory.',
  },
  fr: {
    greeting: 'Sur quoi travaillez-vous, {name} ?', subline: 'Decrivez-le en une phrase. Ment trouve les bonnes personnes pour vous.',
    placeholder: 'Aidez-moi a preparer un entretien de stage en conseil...', starters: ['Preparer une etude de cas', 'Trouver un mentor en strategie', 'Relire mon CV'],
    addContext: 'Ajouter du contexte', directory: 'Annuaire', finding: 'Je cherche des personnes qui peuvent vous aider', chooseLead: 'Trois personnes se distinguent pour cette demande. Choisissez qui contacter.', chooseBold: 'Je preparerai un message pour vous.',
    why: 'Pourquoi cette personne', available: 'Disponible', choose: 'Choisir', selected: 'Selectionne', different: 'Voir d autres personnes', browse: 'parcourir l annuaire', notRight: 'Pas tout a fait ?',
    to: 'A', intro: 'Voici un message propose. Modifiez ce que vous voulez, puis envoyez-le lorsque cela vous convient.', suggested: 'Message propose', send: 'Envoyer la demande', regenerate: 'Regenerer', edit: 'Modifier', remaining: '{count} demandes restantes ce mois-ci',
    sent: 'Demande envoyee a {name}.', sentSubline: 'Nous vous previendrons des qu une reponse arrivera.', again: 'Poser une autre question', retry: 'Reessayer', error: 'Nous n avons pas pu finaliser cette demande. Reessayez.', noMatches: 'Aucune correspondance disponible pour le moment. Essayez un autre angle ou parcourez l annuaire.',
  },
};

const avatarTints = ['#fbeee6', '#eef0e7', '#e9eef7'];
const pause = (ms) => new Promise(resolve => window.setTimeout(resolve, ms));
const text = (copy, key, vars = {}) => copy[key].replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');

function initials(name) {
  return String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function MatchCard({ match, index, selected, onSelect, copy }) {
  const role = [match.person.job_title || match.person.current_role, match.person.department].filter(Boolean).join(' · ');
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={`${copy.choose} ${match.person.name}`} onClick={() => onSelect(match)} className={`discovery-match-card ${selected ? 'is-selected' : ''}`}>
      <span className="discovery-person-head"><span className="discovery-avatar" style={{ backgroundColor: avatarTints[index % avatarTints.length] }}>{initials(match.person.name)}{selected && <span className="discovery-selected-mark"><Check /></span>}</span><span className="min-w-0 text-left"><span className="block truncate text-[15.5px] font-semibold">{match.person.name}</span>{role && <span className="block truncate text-[12.5px] text-[var(--ment-muted)]">{role}</span>}</span></span>
      <span className="discovery-reason"><span className="discovery-micro">{copy.why}</span>{match.reason}</span>
      <span className="mt-4 flex items-center justify-between gap-3"><span className="discovery-available"><i />{copy.available}</span><span className={`discovery-choose ${selected ? 'is-selected' : ''}`}>{selected ? copy.selected : copy.choose}</span></span>
    </button>
  );
}

export default function DiscoveryFlow() {
  const { user } = useAuth();
  const lang = localStorage.getItem('ment.lang') || 'en';
  const copy = COPY[lang] || COPY.en;
  const [stage, setStage] = useState('ask');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draftVariant, setDraftVariant] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const threadEndRef = useRef(null);
  const idempotencyKey = useRef(null);

  useEffect(() => { if (stage !== 'ask') threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [stage, selected]);

  async function submit(event) {
    event?.preventDefault();
    const nextQuery = query.trim();
    if (!nextQuery) return;
    setError(''); setSubmittedQuery(nextQuery); setStage('matching');
    try {
      const [people] = await Promise.all([loadConversationCandidates(api), pause(900)]);
      const nextMatches = getDiscoveryMatches({ query: nextQuery, people, userId: user?.id });
      setMatches(nextMatches); setStage(nextMatches.length ? 'choose' : 'empty');
    } catch { setStage('ask'); setError(copy.error); }
  }

  function choose(match) {
    setSelected(match); setDraftVariant(0);
    setDraft(createDiscoveryDraft({ userName: user?.name, person: match.person, query: submittedQuery, reason: match.reason, variant: 0 }));
    setStage('reachout');
  }

  function regenerate() {
    const variant = draftVariant === 0 ? 1 : 0;
    setDraftVariant(variant);
    setDraft(createDiscoveryDraft({ userName: user?.name, person: selected.person, query: submittedQuery, reason: selected.reason, variant }));
  }

  async function sendRequest() {
    if (!selected || !draft.trim() || sending) return;
    setSending(true); setError('');
    try {
      idempotencyKey.current ||= crypto.randomUUID();
      await api.post('/sessions', { mentor_id: selected.person.id, title: submittedQuery.slice(0, 80), pre_session_question: submittedQuery, message: draft.trim(), duration_minutes: 60, follow_up_intent: 'one_off', idempotency_key: idempotencyKey.current });
      setStage('sent');
    } catch (requestError) { setError(requestError.response?.data?.error || copy.error); }
    finally { setSending(false); }
  }

  function reset() {
    setStage('ask'); setQuery(''); setSubmittedQuery(''); setMatches([]); setSelected(null); setDraft(''); setError(''); idempotencyKey.current = null;
  }

  const firstName = user?.name?.split(' ')[0] || '';
  return <section className="discovery-flow" aria-label="Ment discovery"><div className="discovery-thread">
    <div className="discovery-ask-block"><h1>{text(copy, 'greeting', { name: firstName })}</h1><p>{copy.subline}</p><form className="discovery-composer" onSubmit={submit}><textarea value={query} onChange={event => setQuery(event.target.value)} maxLength={2000} rows={3} placeholder={copy.placeholder} aria-label={copy.placeholder} disabled={stage === 'matching' || sending} /><div className="flex items-center justify-between gap-4"><div className="flex gap-2"><span className="discovery-tool-pill">{copy.addContext}</span><span className="discovery-tool-pill">{copy.directory}</span></div><button className="discovery-send" type="submit" disabled={!query.trim() || stage === 'matching'} aria-label="Send message"><ArrowUp /></button></div></form><div className="discovery-starters">{copy.starters.map(starter => <button type="button" key={starter} onClick={() => setQuery(starter)}>{starter}</button>)}</div>{error && stage === 'ask' && <p className="discovery-error" role="alert">{error}</p>}</div>
    {submittedQuery && <div className="discovery-user-bubble">{submittedQuery}</div>}
    {stage === 'matching' && <><div className="discovery-assistant-line"><span className="discovery-sparkle"><Sparkles /></span><span>{copy.finding}<span className="discovery-ellipsis">...</span></span></div><div className="discovery-skeletons" aria-hidden="true">{[1, 2, 3].map(item => <span key={item} />)}</div></>}
    {stage === 'choose' && <div className="discovery-reveal"><div className="discovery-assistant-line"><span className="discovery-sparkle"><Sparkles /></span><p>{copy.chooseLead} <strong>{copy.chooseBold}</strong></p></div><div className="discovery-match-grid" role="radiogroup" aria-label="Choose a person">{matches.map((match, index) => <MatchCard key={match.person.id} match={match} index={index} selected={selected?.person.id === match.person.id} onSelect={choose} copy={copy} />)}</div><p className="discovery-escape">{copy.notRight} <button type="button" onClick={submit}>{copy.different}</button>, or <a href="/explorer?mode=directory">{copy.browse}</a>.</p></div>}
    {stage === 'empty' && <div className="discovery-empty"><p>{copy.noMatches}</p><button type="button" onClick={reset}>{copy.retry}</button></div>}
    {(stage === 'reachout' || stage === 'sent') && selected && <div className="discovery-reachout discovery-reveal"><div className="discovery-to-row"><span className="discovery-avatar size-10" style={{ backgroundColor: avatarTints[0] }}>{initials(selected.person.name)}</span><span><span className="discovery-micro">{copy.to}</span><strong>{selected.person.name}</strong><small>{[selected.person.job_title || selected.person.current_role, selected.person.department].filter(Boolean).join(' · ')}</small></span></div><div className="discovery-assistant-line"><span className="discovery-sparkle"><Sparkles /></span><p>{copy.intro}</p></div><div className={`discovery-draft ${stage === 'sent' ? 'is-sent' : ''}`}><span className="discovery-draft-tag">{copy.suggested}</span><textarea value={draft} onChange={event => setDraft(event.target.value)} disabled={stage === 'sent' || sending} aria-label={copy.suggested} /></div>{stage === 'reachout' ? <div className="discovery-actions"><div className="flex flex-wrap items-center gap-2"><button type="button" className="discovery-primary" onClick={sendRequest} disabled={sending || !draft.trim()}>{sending ? <RefreshCw className="animate-spin" /> : <Send />}{copy.send}</button><button type="button" className="discovery-ghost" onClick={regenerate}><RefreshCw />{copy.regenerate}</button><button type="button" className="discovery-text-button" onClick={() => document.querySelector('.discovery-draft textarea')?.focus()}><Pencil />{copy.edit}</button></div><span>{text(copy, 'remaining', { count: 3 })}</span></div> : <><div className="discovery-confirmation"><Check /><div><strong>{text(copy, 'sent', { name: selected.person.name.split(' ')[0] })}</strong><p>{copy.sentSubline}</p></div></div><button type="button" className="discovery-again" onClick={reset}>{copy.again}</button></>}{error && <p className="discovery-error" role="alert">{error}</p>}</div>}
    <div ref={threadEndRef} />
  </div></section>;
}
