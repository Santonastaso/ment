import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUp, Check, Clock3, Pencil, RefreshCw, Search, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import api from '../../api/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useT } from '../../i18n/index.jsx';

const COPY = {
  en: {
    greeting: 'Hi {name}, who would you like to connect with?', placeholder: 'Ask Ment',
    finding: 'Thinking through your request', chooseLead: 'These profiles match your request.', chooseBold: 'Select one to prepare the request.',
    why: 'Why this match', choose: 'Choose', selected: 'Selected', different: 'Ask for different people', browse: 'browse the full directory', notRight: 'Not quite right?', or: 'or',
    to: 'To', intro: "Here's a suggested intro. Edit anything, then send when it feels like you.", suggested: 'Suggested draft', send: 'Send request', regenerate: 'Regenerate',
    sent: 'Request sent to {name}.', sentSubline: "The conversation is ready. Continue there when they reply.", openChat: 'Open chat', again: 'Ask about something else', newChat: 'New chat', recentSearches: 'Recent searches', deleteSearch: 'Delete search', confirmDeleteSearch: 'Delete this search and its saved conversation?', retry: 'Start a new search', error: 'We could not complete that request. Please try again.', aiMissing: 'Matching is not configured yet. Ask an administrator to connect Mistral.', aiBusy: 'Matching is temporarily rate-limited. Please try again in a moment.', aiAdmin: 'Matching needs an administrator to check the Mistral connection.', noMatches: 'There is no relevant professional in the current network for this request.', snapshot: 'Your connections', upcoming: 'Upcoming', pending: 'Pending', completed: 'Completed', viewAll: 'View conversations', viewProfile: 'View profile', back: 'Back to matches', drafting: 'Preparing your request', useful: 'Were these matches useful?', yes: 'Yes', no: 'No', feedbackSaved: 'Thanks — this helps improve matching.',
  },
  it: {
    greeting: 'Ciao {name}, con chi vorresti entrare in contatto?', placeholder: 'Chiedi a Ment',
    finding: 'Sto valutando la richiesta', chooseLead: 'Questi profili corrispondono alla richiesta.', chooseBold: 'Selezionane uno per preparare il messaggio.',
    why: 'Perché è adatto', choose: 'Scegli', selected: 'Scelto', different: 'Mostra altre persone', browse: 'sfoglia la directory', notRight: 'Non è quello che cercavi?', or: 'oppure',
    to: 'A', intro: 'Ecco un messaggio proposto. Modifica tutto quello che vuoi, poi invialo quando ti sembra giusto.', suggested: 'Messaggio proposto', send: 'Invia richiesta', regenerate: 'Rigenera',
    sent: 'Richiesta inviata a {name}.', sentSubline: 'La conversazione è pronta. Continua da lì quando risponderà.', openChat: 'Apri chat', again: "Chiedi qualcos'altro", newChat: 'Nuova chat', recentSearches: 'Ricerche recenti', deleteSearch: 'Elimina ricerca', confirmDeleteSearch: 'Eliminare questa ricerca e la conversazione salvata?', retry: 'Inizia una nuova ricerca', error: 'Non siamo riusciti a completare la richiesta. Riprova.', aiMissing: 'Il matching non è ancora configurato. Chiedi a un amministratore di collegare Mistral.', aiBusy: 'Il matching è temporaneamente limitato. Riprova tra poco.', aiAdmin: 'Un amministratore deve verificare la connessione a Mistral.', noMatches: 'Nella rete attuale non c’è un professionista pertinente per questa richiesta.', snapshot: 'Le tue connessioni', upcoming: 'In programma', pending: 'In attesa', completed: 'Completate', viewAll: 'Vedi conversazioni', viewProfile: 'Vedi profilo', back: 'Torna ai risultati', drafting: 'Preparo la richiesta', useful: 'Questi match sono utili?', yes: 'Sì', no: 'No', feedbackSaved: 'Grazie — ci aiuta a migliorare il matching.',
  },
  fr: {
    greeting: 'Bonjour {name}, avec qui souhaitez-vous entrer en contact ?', placeholder: 'Demandez à Ment',
    finding: 'J’analyse votre demande', chooseLead: 'Ces profils correspondent à votre demande.', chooseBold: 'Sélectionnez-en un pour préparer le message.',
    why: 'Pourquoi ce profil', choose: 'Choisir', selected: 'Sélectionné', different: 'Voir d’autres personnes', browse: 'parcourir l’annuaire', notRight: 'Pas tout à fait ?', or: 'ou',
    to: 'À', intro: 'Voici un message proposé. Modifiez ce que vous voulez, puis envoyez-le lorsqu’il vous convient.', suggested: 'Message proposé', send: 'Envoyer la demande', regenerate: 'Régénérer',
    sent: 'Demande envoyée à {name}.', sentSubline: 'La conversation est prête. Continuez là lorsqu’une réponse arrive.', openChat: 'Ouvrir le chat', again: 'Poser une autre question', newChat: 'Nouveau chat', recentSearches: 'Recherches récentes', deleteSearch: 'Supprimer la recherche', confirmDeleteSearch: 'Supprimer cette recherche et la conversation enregistrée ?', retry: 'Lancer une nouvelle recherche', error: 'Nous n’avons pas pu finaliser cette demande. Réessayez.', aiMissing: 'Le matching n’est pas encore configuré. Demandez à un administrateur de connecter Mistral.', aiBusy: 'Le matching est temporairement limité. Réessayez dans un instant.', aiAdmin: 'Un administrateur doit vérifier la connexion à Mistral.', noMatches: 'Le réseau actuel ne contient aucun professionnel pertinent pour cette demande.', snapshot: 'Vos connexions', upcoming: 'À venir', pending: 'En attente', completed: 'Terminées', viewAll: 'Voir les conversations', viewProfile: 'Voir le profil', back: 'Retour aux résultats', drafting: 'Préparation de la demande', useful: 'Ces profils sont-ils utiles ?', yes: 'Oui', no: 'Non', feedbackSaved: 'Merci — cela nous aide à améliorer les suggestions.',
  },
};

const avatarTints = ['#fbeee6', '#eef0e7', '#e9eef7'];
const pause = (ms) => new Promise(resolve => window.setTimeout(resolve, ms));
const text = (copy, key, vars = {}) => copy[key].replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');

function requestErrorMessage(error, copy) {
  const code = error.response?.data?.error;
  if (code === 'ai_not_configured') return copy.aiMissing;
  if (code === 'ai_rate_limited' || code === 'ai_temporarily_unavailable' || code === 'ai_provider_unreachable') return copy.aiBusy;
  if (code === 'ai_provider_auth_failed' || code === 'ai_model_not_found') return copy.aiAdmin;
  return copy.error;
}

function initials(name) {
  return String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

// The model answers in light markdown. Render **bold** and *italic* as real
// emphasis instead of printing the asterisks; everything else stays literal.
export function renderInline(value) {
  const source = String(value ?? '');
  const nodes = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
  let cursor = 0;
  let match = pattern.exec(source);
  let index = 0;
  while (match) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index));
    nodes.push(match[1]
      ? <strong key={`b${index}`}>{match[1]}</strong>
      : <em key={`i${index}`}>{match[2]}</em>);
    cursor = match.index + match[0].length;
    index += 1;
    match = pattern.exec(source);
  }
  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes.length ? nodes : source;
}

function visibleTurns(storedTurns) {
  let previousUserMessage = '';
  return (Array.isArray(storedTurns) ? storedTurns : []).map(turn => {
    if (turn?.role !== 'user') return turn;
    const content = String(turn.content || '');
    const legacyPrefix = previousUserMessage ? `${previousUserMessage}\nAdditional detail: ` : '';
    const visibleContent = legacyPrefix && content.startsWith(legacyPrefix)
      ? content.slice(legacyPrefix.length)
      : content;
    previousUserMessage = content;
    return { ...turn, content: visibleContent };
  });
}

function MatchCard({ match, index, selected, onSelect, copy }) {
  const person = match.person;
  const jobTitle = person.job_title || person.current_role;
  const role = [jobTitle, person.department].filter(Boolean).join(' · ');

  // The subtitle already names the role and department, and the server falls
  // back to exactly those when it has no matched expertise — so drop anything
  // that would just repeat it and show only what adds information.
  const shown = new Set([jobTitle, person.department].filter(Boolean).map(value => value.toLowerCase()));
  const expertise = (match.expertise || []).filter(item => item && !shown.has(String(item).toLowerCase()));

  // Academic background is the part the subtitle doesn't carry.
  const background = [person.program, person.cohort_year].filter(Boolean).join(' · ') || '';

  return (
    <article role="radio" aria-checked={selected} className={`discovery-match-card ${selected ? 'is-selected' : ''}`}>
      <span className="discovery-avatar" style={{ backgroundColor: avatarTints[index % avatarTints.length] }}>
        {initials(person.name)}
        {selected && <span className="discovery-selected-mark"><Check /></span>}
      </span>

      <span className="discovery-match-identity">
        <span className="discovery-match-name">{person.name}</span>
        {role && <span className="discovery-match-role">{role}</span>}
      </span>

      <span className="discovery-match-actions">
        <Link className="discovery-text-button" to={`/profile/${person.id}`}>{copy.viewProfile}</Link>
        <button
          type="button"
          aria-label={`${copy.choose} ${person.name}`}
          onClick={() => onSelect(match)}
          className={`discovery-choose ${selected ? 'is-selected' : ''}`}
        >
          {selected ? copy.selected : copy.choose}
        </button>
      </span>

      {match.reasons?.length > 0 && (
        <p className="discovery-match-why">{match.reasons.join(' ')}</p>
      )}

      {(expertise.length > 0 || background) && (
        <span className="discovery-match-meta">
          {expertise.map(item => <span className="discovery-match-chip" key={item}>{item}</span>)}
          {background && <span className="discovery-match-background">{background}</span>}
        </span>
      )}
    </article>
  );
}

export default function DiscoveryFlow() {
  const { user } = useAuth();
  const { lang } = useT();
  const copy = COPY[lang] || COPY.en;
  const [stage, setStage] = useState('ask');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [turns, setTurns] = useState([]);
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draftVariant, setDraftVariant] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [threadId, setThreadId] = useState(null);
  const [clarification, setClarification] = useState('');
  const [noMatchReason, setNoMatchReason] = useState('');
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [matchFeedback, setMatchFeedback] = useState(null);
  const threadEndRef = useRef(null);
  const idempotencyKey = useRef(null);
  const flowVersion = useRef(0);

  async function refreshHistory() {
    const { data } = await api.get('/discovery/threads?limit=8');
    setHistory(data || []);
  }

  useEffect(() => { if (stage !== 'ask') threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [stage, selected, turns.length]);
  useEffect(() => {
    if (!user?.id) return;
    api.get('/discovery/threads/latest').then(({ data }) => {
      if (!data?.id || !Array.isArray(data.turns) || !data.turns.length) return;
      const lastAssistant = [...data.turns].reverse().find(turn => turn?.role === 'assistant');
      const lastUser = [...data.turns].reverse().find(turn => turn?.role === 'user');
      if (!lastAssistant || !lastUser?.content) return;
      setThreadId(data.id);
      setTurns(visibleTurns(data.turns));
      setSubmittedQuery(lastAssistant.search_request || lastUser.content);
      if (lastAssistant.kind === 'matches' && Array.isArray(lastAssistant.matches)) {
        setMatches(lastAssistant.matches.map(person => ({ person, expertise: person.expertise || [], background: person.background || '', reasons: person.reasons || [] })));
        setStage('choose');
      } else if (lastAssistant.kind === 'clarification' && lastAssistant.content) {
        setClarification(lastAssistant.content);
        setStage('clarify');
      } else if (lastAssistant.kind === 'no_match') {
        setNoMatchReason(lastAssistant.content || '');
        setStage('empty');
      } else if (lastAssistant.kind === 'draft' && lastAssistant.person && lastAssistant.content) {
        const person = lastAssistant.person;
        setSelected({ person, expertise: person.expertise || [], background: person.background || '', reasons: person.reasons || [] });
        setDraft(lastAssistant.content);
        setStage('reachout');
      }
    }).catch(() => {});
    refreshHistory().catch(() => {});
  }, [user?.id]);
  useEffect(() => { if (!user?.id || stage !== 'ask') return; api.get('/sessions').then(({ data }) => setConnections(data || [])).catch(() => {}); }, [stage, user?.id]);

  async function findMatches(nextQuery) {
    const version = flowVersion.current;
    const message = nextQuery.trim();
    if (!message) return;
    setTurns(current => [...current, { role: 'user', content: message, at: new Date().toISOString() }]);
    setError(''); setStage('matching'); setClarification(''); setNoMatchReason(''); setMatchFeedback(null);
    setSelected(null); setDraft('');
    try {
      const [{ data }] = await Promise.all([api.post('/discovery/matches', { query: message, thread_id: threadId }), pause(350)]);
      if (version !== flowVersion.current) return;
      setThreadId(data.thread_id || threadId);
      refreshHistory().catch(() => {});
      const nextMatches = (data.matches || []).map((person) => ({ person, expertise: person.expertise || [], background: person.background || '', reasons: person.reasons || [] }));
      setMatches(nextMatches);
      if (data.clarification) {
        setClarification(data.clarification);
        setTurns(current => [...current, { role: 'assistant', kind: 'clarification', content: data.clarification, at: new Date().toISOString() }]);
        setStage('clarify');
      } else {
        setSubmittedQuery(data.resolved_request || message);
        setNoMatchReason(data.no_match_reason || '');
        setTurns(current => [...current, {
          role: 'assistant',
          kind: nextMatches.length ? 'matches' : 'no_match',
          content: nextMatches.length ? 'matches_ready' : (data.no_match_reason || copy.noMatches),
          at: new Date().toISOString(),
        }]);
        setStage(nextMatches.length ? 'choose' : 'empty');
      }
    } catch (requestError) {
      if (version === flowVersion.current) {
        const message = requestErrorMessage(requestError, copy);
        setError(message);
        setTurns(current => [...current, { role: 'assistant', kind: 'error', content: message, at: new Date().toISOString() }]);
        setStage('clarify');
      }
    }
  }

  function submit(event) {
    event?.preventDefault();
    const nextQuery = query.trim();
    if (!nextQuery) return;
    setQuery('');
    findMatches(nextQuery);
  }

  async function choose(match) {
    const version = flowVersion.current;
    setSelected(match); setDraftVariant(0);
    setStage('drafting'); setError('');
    try {
      const { data } = await api.post('/discovery/draft', { query: submittedQuery, person_id: match.person.id, variant: 0, thread_id: threadId });
      if (version !== flowVersion.current) return;
      setThreadId(data.thread_id || threadId); setDraft(data.draft || ''); setStage('reachout');
      refreshHistory().catch(() => {});
    } catch (requestError) {
      if (version !== flowVersion.current) return;
      setStage('choose'); setError(requestErrorMessage(requestError, copy));
    }
  }

  async function regenerate() {
    const variant = draftVariant === 0 ? 1 : 0;
    setDraftVariant(variant); setSending(true); setError('');
    try {
      const { data } = await api.post('/discovery/draft', { query: submittedQuery, person_id: selected.person.id, variant, thread_id: threadId });
      setThreadId(data.thread_id || threadId);
      setDraft(data.draft || '');
    } catch (requestError) { setError(requestErrorMessage(requestError, copy)); }
    finally { setSending(false); }
  }

  async function sendRequest() {
    if (!selected || !draft.trim() || sending) return;
    setSending(true); setError('');
    try {
      idempotencyKey.current ||= crypto.randomUUID();
      const response = await api.post('/sessions', { mentor_id: selected.person.id, title: submittedQuery.slice(0, 80), pre_session_question: submittedQuery, message: draft.trim(), duration_minutes: 60, follow_up_intent: 'one_off', idempotency_key: idempotencyKey.current });
      setSessionId(response.data.id);
      setStage('sent');
      if (threadId) await api.put(`/discovery/threads/${threadId}`, { archived: true, selected_person_id: selected.person.id });
      refreshHistory().catch(() => {});
    } catch (requestError) { setError(requestError.response?.data?.error || copy.error); }
    finally { setSending(false); }
  }

  async function saveMatchFeedback(helpful) {
    if (!threadId) return;
    setMatchFeedback(helpful);
    try {
      await api.post('/discovery/feedback', { thread_id: threadId, helpful });
    } catch {
      setMatchFeedback(null);
    }
  }

  async function resumeSearch(id) {
    setError('');
    try {
      const { data } = await api.get(`/discovery/threads/${id}`);
      const lastAssistant = [...(data.turns || [])].reverse().find(turn => turn?.role === 'assistant');
      const lastUser = [...(data.turns || [])].reverse().find(turn => turn?.role === 'user');
      if (!lastAssistant || !lastUser?.content) return;
      setTurns(visibleTurns(data.turns));
      if (lastAssistant.kind === 'draft' && lastAssistant.person) {
        const { data: sessions } = await api.get('/sessions');
        const sentSession = (sessions || []).find(session =>
          session.mentee_id === user?.id &&
          session.mentor_id === lastAssistant.person.id &&
          session.title === (lastAssistant.search_request || lastUser.content).slice(0, 80),
        );
        if (sentSession) {
          setSelected({ person: lastAssistant.person, expertise: lastAssistant.person.expertise || [], background: lastAssistant.person.background || '', reasons: lastAssistant.person.reasons || [] });
          setDraft(lastAssistant.content || '');
          setSubmittedQuery(lastAssistant.search_request || lastUser.content);
          setSessionId(sentSession.id);
          setThreadId(id);
          setStage('sent');
          return;
        }
      }
      await api.put(`/discovery/threads/${id}`, { archived: false });
      setThreadId(id);
      setSubmittedQuery(lastAssistant.search_request || lastUser.content);
      setQuery(''); setMatches([]); setSelected(null); setDraft(''); setClarification(''); setNoMatchReason('');
      if (lastAssistant.kind === 'matches' && Array.isArray(lastAssistant.matches)) {
        setMatches(lastAssistant.matches.map(person => ({ person, expertise: person.expertise || [], background: person.background || '', reasons: person.reasons || [] })));
        setStage('choose');
      } else if (lastAssistant.kind === 'clarification') {
        setClarification(lastAssistant.content || '');
        setStage('clarify');
      } else if (lastAssistant.kind === 'no_match') {
        setNoMatchReason(lastAssistant.content || '');
        setStage('empty');
      } else if (lastAssistant.kind === 'draft' && lastAssistant.person) {
        const person = lastAssistant.person;
        setSelected({ person, expertise: person.expertise || [], background: person.background || '', reasons: person.reasons || [] });
        setDraft(lastAssistant.content || '');
        setStage('reachout');
      }
    } catch {
      setHistoryError(copy.error);
    }
  }

  async function deleteSearch(id) {
    if (!window.confirm(copy.confirmDeleteSearch)) return;
    try {
      await api.delete(`/discovery/threads/${id}`);
      setHistory(items => items.filter(item => item.id !== id));
      if (threadId === id) reset();
    } catch {
      setHistoryError(copy.error);
    }
  }

  async function reset() {
    flowVersion.current += 1;
    const currentThread = threadId;
    setStage('ask'); setQuery(''); setSubmittedQuery(''); setTurns([]); setMatches([]); setSelected(null); setDraft(''); setSending(false); setError(''); setSessionId(null); setThreadId(null); setClarification(''); setNoMatchReason(''); setMatchFeedback(null); idempotencyKey.current = null;
    if (currentThread) api.put(`/discovery/threads/${currentThread}`, { archived: true }).then(refreshHistory).catch(() => {});
  }

  function composer() {
    return <form className="discovery-composer" onSubmit={submit}><textarea value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={2000} rows={1} placeholder={copy.placeholder} aria-label={copy.placeholder} disabled={stage === 'matching' || sending} /><button className="discovery-send" type="submit" disabled={!query.trim() || stage === 'matching'} aria-label="Send message"><ArrowUp /></button></form>;
  }

  const firstName = user?.name?.split(' ')[0] || '';
  const isConversation = stage !== 'ask';
  // The opening question names the thread, so the header says which search you are in.
  const threadTitle = turns.find(turn => turn.role === 'user')?.content || submittedQuery || copy.placeholder;

  // The draft is persisted as a turn so a reload can restore it, but the
  // reach-out panel below already renders it in an editable field — leaving it
  // in the transcript too prints the same letter twice. Drop it here, and
  // collapse any bubble that exactly repeats the one before it.
  const renderedTurns = useMemo(() => {
    const out = [];
    for (const turn of turns) {
      if (turn.role === 'assistant' && turn.kind === 'draft') continue;
      const previous = out[out.length - 1];
      if (previous && previous.role === turn.role && previous.content === turn.content) continue;
      out.push(turn);
    }
    return out;
  }, [turns]);
  return <section className={`discovery-flow ${isConversation ? 'is-conversation' : ''}`} aria-label="Ment discovery"><div className="discovery-thread">
    {stage === 'ask' && <div className="discovery-ask-block"><h1>{text(copy, 'greeting', { name: firstName })}</h1>{composer()}{history.length > 0 && <details className="discovery-history"><summary aria-label={copy.recentSearches} title={copy.recentSearches}><Clock3 aria-hidden="true" /></summary><div>{history.map(item => { const title = [...(item.turns || [])].reverse().find(turn => turn?.role === 'user')?.content || item.title || ''; return <div className="discovery-history-row" key={item.id}><button type="button" onClick={() => resumeSearch(item.id)}>{title}</button><button type="button" aria-label={copy.deleteSearch} onClick={() => deleteSearch(item.id)}>×</button></div>; })}</div>{historyError && <p role="alert">{historyError}</p>}</details>}{connections.length > 0 && <div className="discovery-connections"><div className="discovery-connection-people"><span className="discovery-connections-label">{copy.snapshot}</span><span className="discovery-avatars">{connections.slice(0, 3).map((session, index) => { const peer = session.mentor_id === user?.id ? session.mentee : session.mentor; return <span key={session.id} className="discovery-avatar" style={{ backgroundColor: avatarTints[index % avatarTints.length] }}>{initials(peer?.name)}</span>; })}</span></div><div className="discovery-connection-counts"><span>{copy.upcoming} <strong>{connections.filter(session => session.status === 'scheduled').length}</strong></span><span>{copy.pending} <strong>{connections.filter(session => session.status === 'pending').length}</strong></span><span>{copy.completed} <strong>{connections.filter(session => session.status === 'completed').length}</strong></span></div><Link to="/conversations" className="discovery-connections-link">{copy.viewAll}</Link></div>}{error && <p className="discovery-error" role="alert">{error}</p>}</div>}
    {isConversation && <div className="discovery-conversation"><div className="discovery-conversation-toolbar"><span className="discovery-thread-title"><strong>{threadTitle}</strong></span><button type="button" onClick={reset} disabled={sending}><Pencil />{copy.newChat}</button></div><div className="discovery-header-fade" aria-hidden="true" /><div className="discovery-chat-transcript">{renderedTurns.map((turn, index) => {
      if (turn.role === 'user') return <div className="discovery-chat-turn is-user" key={`${turn.at || index}-${index}`}><div className="discovery-user-bubble">{turn.content}</div></div>;
      if (turn.role !== 'assistant') return null;
      const response = turn.kind === 'matches' && turn.content === 'matches_ready'
        ? `${copy.chooseLead} ${copy.chooseBold}`
        : turn.content;
      // One agent mark per run of assistant turns.
      const continues = renderedTurns[index - 1]?.role === 'assistant';
      return <div className={`discovery-chat-turn is-assistant ${turn.kind === 'error' ? 'is-error' : ''}`} key={`${turn.at || index}-${index}`}>{continues ? <span className="discovery-agent-mark-spacer" aria-hidden="true" /> : <span className="discovery-agent-mark" aria-label="Ment">M</span>}<p className="discovery-assistant-bubble">{renderInline(response)}</p></div>;
    })}</div>
    {stage === 'matching' && <div className="discovery-chat-turn is-assistant is-working"><span className="discovery-agent-mark" aria-label="Ment">M</span><p className="discovery-assistant-bubble">{copy.finding}<span className="discovery-ellipsis">...</span></p></div>}
    {stage === 'drafting' && <div className="discovery-chat-turn is-assistant is-working"><span className="discovery-agent-mark" aria-label="Ment">M</span><p className="discovery-assistant-bubble">{copy.drafting}<span className="discovery-ellipsis">...</span></p></div>}
    {stage === 'choose' && <div className="discovery-reveal"><div className="discovery-match-grid" role="radiogroup" aria-label="Choose a person">{matches.map((match, index) => <MatchCard key={match.person.id} match={match} index={index} selected={selected?.person.id === match.person.id} onSelect={choose} copy={copy} />)}</div><div className="discovery-result-actions" role="group" aria-label={copy.useful}>
      <button type="button" className="discovery-result-icon" aria-label={`${copy.useful} ${copy.yes}`} title={copy.yes} aria-pressed={matchFeedback === true} onClick={() => saveMatchFeedback(true)}><ThumbsUp /></button>
      <button type="button" className="discovery-result-icon" aria-label={`${copy.useful} ${copy.no}`} title={copy.no} aria-pressed={matchFeedback === false} onClick={() => saveMatchFeedback(false)}><ThumbsDown /></button>
      <span className="discovery-result-separator" aria-hidden="true" />
      <button type="button" className="discovery-result-icon" aria-label={copy.different} title={copy.different} onClick={() => findMatches(submittedQuery)}><RefreshCw /></button>
      <Link to="/explorer?mode=directory" className="discovery-result-icon" aria-label={copy.browse} title={copy.browse}><Search /></Link>
      {matchFeedback !== null && <span className="sr-only" role="status">{copy.feedbackSaved}</span>}
    </div></div>}
    {stage === 'empty' && <div className="discovery-empty"><button type="button" onClick={reset}>{copy.retry}</button></div>}
    {(stage === 'reachout' || stage === 'sent') && selected && (
      <div className="discovery-reachout discovery-reveal">
        <div className="discovery-assistant-message">
          <span className="discovery-agent-mark" aria-hidden="true">M</span>
          <div className="discovery-message-body">
            <p>{copy.intro}</p>
            <div className="discovery-to-row">
              <span className="discovery-avatar size-10" style={{ backgroundColor: avatarTints[0] }}>{initials(selected.person.name)}</span>
              <span>
                <span className="discovery-micro">{copy.to}</span>
                <strong>{selected.person.name}</strong>
                <small>{[selected.person.job_title || selected.person.current_role, selected.person.department].filter(Boolean).join(' · ')}</small>
              </span>
            </div>
            <div className={`discovery-draft ${stage === 'sent' ? 'is-sent' : ''}`}>
              <span className="discovery-draft-tag">{copy.suggested}</span>
              <textarea value={draft} onChange={event => setDraft(event.target.value)} disabled={stage === 'sent' || sending} aria-label={copy.suggested} />
            </div>
            {stage === 'reachout' ? (
              <div className="discovery-actions">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="discovery-text-button" onClick={() => setStage('choose')}><ArrowLeft />{copy.back}</button>
                  <button type="button" className="discovery-primary" onClick={sendRequest} disabled={sending || !draft.trim()}>{sending ? <RefreshCw className="animate-spin" /> : <Send />}{copy.send}</button>
                  <button type="button" className="discovery-ghost" onClick={regenerate}><RefreshCw />{copy.regenerate}</button>
                </div>
              </div>
            ) : (
              <>
                <div className="discovery-confirmation"><Check /><div><strong>{text(copy, 'sent', { name: selected.person.name.split(' ')[0] })}</strong><p>{copy.sentSubline}</p></div></div>
                {sessionId && <Link className="discovery-ghost mt-4" to={`/conversations?session=${sessionId}`}>{copy.openChat}</Link>}
                <button type="button" className="discovery-again" onClick={reset}>{copy.again}</button>
              </>
            )}
            {error && <p className="discovery-error" role="alert">{error}</p>}
          </div>
        </div>
      </div>
    )}
    <div ref={threadEndRef} /></div>}
  </div>{isConversation && <div className="discovery-composer-dock">{composer()}</div>}</section>;
}
