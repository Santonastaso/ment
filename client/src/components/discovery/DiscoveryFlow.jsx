import { errorMessage } from '../../lib/errors.mjs';
import { formatDay } from '../../lib/utils.js';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowUpRight, Check, Clock3, Pencil, RefreshCw, Search, Send, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import api from '../../api/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useT } from '../../i18n/index.jsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.jsx';
import { Button, ButtonLink } from '../ui/button.jsx';
import { Skeleton } from '../ui/skeleton.jsx';
import DirectoryFilter from '../DirectoryFilter.jsx';
import { CONVERSATION_FILTERS, conversationState, requestText, resumableSearch, isExpired } from '../../lib/conversations.mjs';
import { sessionPath } from '../../lib/conversationLinks.mjs';
import { homeCopy } from '../demo/homeCopy.js';
import { avatarTint } from '../../lib/avatarTint.js';

const COPY = {
  en: {
    history: 'History',
    greeting: 'Hey {name}, would you like to meet today?', placeholder: 'Describe who could help', examples: ['Someone to help me prepare for consulting interviews', 'A finance professional who has worked in M&A', 'Alumni working in marketing in Paris'], resume: 'Resume search',
    finding: 'Having a look', chooseLead: 'Here are the people who fit.', chooseBold: 'Pick one and I will write the message.',
    why: 'Why this match', choose: 'Choose', selected: 'Selected', different: 'Ask for different people', browse: 'browse the full directory', notRight: 'Not quite right?', or: 'or',
    to: 'To', intro: "Here's a suggested intro. Edit anything, then send when it feels like you.", aiNote: 'Ment is an AI assistant and can make mistakes. You choose who to contact and what to send.', draftNote: 'Drafted by AI. Read it and make it yours before sending.', suggested: 'Suggested draft', send: 'Send request', regenerate: 'Regenerate',
    sent: 'Request sent to {name}.', sentSubline: "The conversation is ready. Continue there when they reply.", openChat: 'Open chat', again: 'Ask about something else', newChat: 'New chat', recentSearches: 'Recent searches', deleteSearch: 'Delete search', confirmDeleteSearch: 'Delete this search and its saved conversation?', cancel: 'Keep search', retry: 'Start a new search', error: 'We could not complete that request. Please try again.', aiMissing: 'Matching is not configured yet. Ask an administrator to connect Mistral.', aiBusy: 'Matching is temporarily rate-limited. Please try again in a moment.', aiAdmin: 'Matching needs an administrator to check the Mistral connection.', noMatches: 'There is no relevant professional in the current network for this request.', nearestLead: 'These are the closest I could find \u2014 pick one and I will write the message.', snapshot: 'Your connections', upcoming: 'Upcoming', pending: 'Pending', completed: 'Completed', viewAll: 'View conversations', viewProfile: 'View profile', showEarlier: 'Show these {count} people again', showEarlierOne: 'Show this person again', hideEarlier: 'Hide these people', roleAt: '{role} at {company}', shownBefore: 'Shown before', back: 'Back to matches', progressReading: 'Reading your request', progressSearching: 'Searching the network', progressCandidates: 'Looking through {count} profiles', progressRanking: 'Comparing the closest ones', progressConsidering: 'Considering {name}: {reason}', progressWriting: 'Writing it up', motivateQuestion: 'Before I write to {name}: what would you like to ask, and why them?', motivateLabel: 'In your own words', motivatePlaceholder: 'e.g. I am choosing between banking and venture capital, and you have worked in both.', motivateHelp: 'One or two lines are enough. They make the message yours, not a template.', motivateWrite: 'Write my message', motivateSkip: 'Skip, write it for me', drafting: 'Preparing your request', useful: 'Were these matches useful?', yes: 'Yes', no: 'No', feedbackSaved: 'Thanks — this helps improve matching.',
  },
  it: {
    history: 'Cronologia',
    greeting: 'Ehi {name}, ti va di incontrare qualcuno oggi?', placeholder: 'Descrivi chi potrebbe aiutarti', examples: ['Qualcuno che mi aiuti a preparare i colloqui in consulenza', 'Un professionista della finanza con esperienza in M&A', 'Alumni che lavorano nel marketing a Parigi'], resume: 'Riprendi la ricerca',
    finding: 'Do un’occhiata', chooseLead: 'Ecco le persone adatte.', chooseBold: 'Scegline una e scrivo io il messaggio.',
    why: 'Perché è adatto', choose: 'Scegli', selected: 'Scelto', different: 'Mostra altre persone', browse: 'sfoglia la directory', notRight: 'Non è quello che cercavi?', or: 'oppure',
    to: 'A', intro: 'Ecco un messaggio proposto. Modifica tutto quello che vuoi, poi invialo quando ti sembra giusto.', aiNote: 'Ment è un assistente basato sull’IA e può sbagliare. Sei tu a scegliere chi contattare e cosa inviare.', draftNote: 'Scritto dall’IA. Rileggilo e rendilo tuo prima di inviarlo.', suggested: 'Messaggio proposto', send: 'Invia richiesta', regenerate: 'Rigenera',
    sent: 'Richiesta inviata a {name}.', sentSubline: 'La conversazione è pronta. Continua da lì quando risponderà.', openChat: 'Apri chat', again: "Chiedi qualcos'altro", newChat: 'Nuova chat', recentSearches: 'Ricerche recenti', deleteSearch: 'Elimina ricerca', confirmDeleteSearch: 'Eliminare questa ricerca e la conversazione salvata?', cancel: 'Mantieni la ricerca', retry: 'Inizia una nuova ricerca', error: 'Non siamo riusciti a completare la richiesta. Riprova.', aiMissing: 'Il matching non è ancora configurato. Chiedi a un amministratore di collegare Mistral.', aiBusy: 'Il matching è temporaneamente limitato. Riprova tra poco.', aiAdmin: 'Un amministratore deve verificare la connessione a Mistral.', noMatches: 'Nella rete attuale non c’è un professionista pertinente per questa richiesta.', nearestLead: 'Queste sono le più vicine che ho trovato: scegline una e scrivo io il messaggio.', snapshot: 'Le tue connessioni', upcoming: 'In programma', pending: 'In attesa', completed: 'Completate', viewAll: 'Vedi conversazioni', viewProfile: 'Vedi profilo', showEarlier: 'Mostra di nuovo queste {count} persone', showEarlierOne: 'Mostra di nuovo questa persona', hideEarlier: 'Nascondi', roleAt: '{role} presso {company}', shownBefore: 'Già mostrato', back: 'Torna ai risultati', progressReading: 'Leggo la tua richiesta', progressSearching: 'Cerco nella rete', progressCandidates: 'Scorro {count} profili', progressRanking: 'Confronto le più vicine', progressConsidering: 'Valuto {name}: {reason}', progressWriting: 'Preparo la risposta', motivateQuestion: 'Prima di scrivere a {name}: cosa vorresti chiedere, e perché proprio a questa persona?', motivateLabel: 'Con parole tue', motivatePlaceholder: 'es. Sto scegliendo tra banca d’affari e venture capital e tu hai lavorato in entrambi.', motivateHelp: 'Bastano una o due righe. Rendono il messaggio tuo, non un modello.', motivateWrite: 'Scrivi il mio messaggio', motivateSkip: 'Salta, scrivilo tu', drafting: 'Preparo la richiesta', useful: 'Questi match sono utili?', yes: 'Sì', no: 'No', feedbackSaved: 'Grazie — ci aiuta a migliorare il matching.',
  },
  fr: {
    history: 'Historique',
    greeting: 'Salut {name}, on fait une rencontre aujourd’hui ?', placeholder: 'Décrivez qui pourrait vous aider', examples: ['Quelqu’un pour m’aider à préparer des entretiens en conseil', 'Un professionnel de la finance passé par le M&A', 'Des alumni qui travaillent en marketing à Paris'], resume: 'Reprendre la recherche',
    finding: 'Je regarde', chooseLead: 'Voici les personnes qui conviennent.', chooseBold: 'Choisissez-en une et j’écris le message.',
    why: 'Pourquoi ce profil', choose: 'Choisir', selected: 'Sélectionné', different: 'Voir d’autres personnes', browse: 'parcourir l’annuaire', notRight: 'Pas tout à fait ?', or: 'ou',
    to: 'À', intro: 'Voici un message proposé. Modifiez ce que vous voulez, puis envoyez-le lorsqu’il vous convient.', aiNote: 'Ment est un assistant fondé sur l’IA et peut se tromper. C’est vous qui choisissez qui contacter et quoi envoyer.', draftNote: 'Rédigé par l’IA. Relisez-le et adaptez-le avant de l’envoyer.', suggested: 'Message proposé', send: 'Envoyer la demande', regenerate: 'Régénérer',
    sent: 'Demande envoyée à {name}.', sentSubline: 'La conversation est prête. Continuez là lorsqu’une réponse arrive.', openChat: 'Ouvrir le chat', again: 'Poser une autre question', newChat: 'Nouveau chat', recentSearches: 'Recherches récentes', deleteSearch: 'Supprimer la recherche', confirmDeleteSearch: 'Supprimer cette recherche et la conversation enregistrée ?', cancel: 'Garder la recherche', retry: 'Lancer une nouvelle recherche', error: 'Nous n’avons pas pu finaliser cette demande. Réessayez.', aiMissing: 'Le matching n’est pas encore configuré. Demandez à un administrateur de connecter Mistral.', aiBusy: 'Le matching est temporairement limité. Réessayez dans un instant.', aiAdmin: 'Un administrateur doit vérifier la connexion à Mistral.', noMatches: 'Le réseau actuel ne contient aucun professionnel pertinent pour cette demande.', nearestLead: 'Voici les plus proches que j’ai trouvées : choisissez-en une et j’écris le message.', snapshot: 'Vos connexions', upcoming: 'À venir', pending: 'En attente', completed: 'Terminées', viewAll: 'Voir les conversations', viewProfile: 'Voir le profil', showEarlier: 'Revoir ces {count} personnes', showEarlierOne: 'Revoir cette personne', hideEarlier: 'Masquer', roleAt: '{role} chez {company}', shownBefore: 'Déjà proposé', back: 'Retour aux résultats', progressReading: 'Je lis votre demande', progressSearching: 'Je cherche dans le réseau', progressCandidates: 'Je parcours {count} profils', progressRanking: 'Je compare les plus proches', progressConsidering: 'J’envisage {name} : {reason}', progressWriting: 'Je rédige la réponse', motivateQuestion: 'Avant d’écrire à {name} : que voudriez-vous demander, et pourquoi cette personne ?', motivateLabel: 'Avec vos mots', motivatePlaceholder: 'ex. J’hésite entre la banque d’affaires et le capital-risque, et vous avez travaillé dans les deux.', motivateHelp: 'Une ou deux lignes suffisent. Elles rendent le message personnel, pas un modèle.', motivateWrite: 'Rédiger mon message', motivateSkip: 'Passer, rédigez-le pour moi', drafting: 'Préparation de la demande', useful: 'Ces profils sont-ils utiles ?', yes: 'Oui', no: 'Non', feedbackSaved: 'Merci — cela nous aide à améliorer les suggestions.',
  },
};

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

// A title for the invite: the expertise the person was matched on, else their
// field, and only as a last resort the words that were searched.
function suggestedTitle(match, query) {
  const topic = String(match?.expertise?.[0] || match?.person?.department || query || '').trim();
  return (topic.charAt(0).toUpperCase() + topic.slice(1)).slice(0, 120);
}

function MatchCard({ match, index, selected, onSelect, copy, style, profileHref, onViewProfile, seenBefore = false }) {
  const person = match.person;
  const jobTitle = person.job_title || person.current_role;
  const titleAt = jobTitle && person.current_company ? copy.roleAt.replace('{role}', jobTitle).replace('{company}', person.current_company) : jobTitle;
  const role = [titleAt, person.department, person.location].filter(Boolean).join(' · ');

  // The subtitle already names the role and department, and the server falls
  // back to exactly those when it has no matched expertise — so drop anything
  // that would just repeat it and show only what adds information.
  const shown = new Set([jobTitle, person.department].filter(Boolean).map(value => value.toLowerCase()));
  const expertise = (match.expertise || []).filter(item => item && !shown.has(String(item).toLowerCase()));

  // Academic background is the part the subtitle doesn't carry.
  const background = [person.program, person.cohort_year].filter(Boolean).join(' · ') || '';

  return (
    <article role="radio" aria-checked={selected} style={style} className={`person-row discovery-match-card ${selected ? 'is-selected' : ''}`}>
      <span className="discovery-avatar person-row-avatar" style={{ backgroundColor: avatarTint(person.name) }}>
        {initials(person.name)}
        {selected && <span className="discovery-selected-mark"><Check /></span>}
      </span>

      <span className="person-row-identity">
        <span className="person-row-name">{person.name}{seenBefore && <span className="discovery-seen-badge">{copy.shownBefore}</span>}</span>
        {role && <span className="person-row-role">{role}</span>}
      </span>

      <span className="person-row-actions">
        <ButtonLink size="sm" className="person-row-link" to={profileHref(person.id)}
          onClick={(event) => {
            // A plain click stays in the app and remembers the chat; a
            // modifier click still opens the profile in a new tab.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            onViewProfile(person.id);
          }}
        >{copy.viewProfile}</ButtonLink>
        <Button variant="default" size="sm" className={selected ? 'is-chosen' : undefined}
          type="button"
          aria-label={`${copy.choose} ${person.name}`}
          onClick={() => onSelect(match)}
        >
          {selected ? copy.selected : copy.choose}
        </Button>
      </span>

      {match.reasons?.length > 0 && (
        <p className="person-row-detail">{match.reasons.join(' ')}</p>
      )}

      {(expertise.length > 0 || background) && (
        <span className="person-row-meta">
          {expertise.map(item => <span className="person-row-chip" key={item}>{item}</span>)}
          {background && <span className="person-row-note">{background}</span>}
        </span>
      )}
    </article>
  );
}

export default function DiscoveryFlow() {
  const { user } = useAuth();
  const { lang, t } = useT();
  const copy = COPY[lang] || COPY.en;
  const intentCopy = homeCopy(lang);
  const [stage, setStage] = useState('ask');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [turns, setTurns] = useState([]);
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  // Live stages of the current search, and the student's reason for the chosen person.
  const [progress, setProgress] = useState([]);
  const [motivation, setMotivation] = useState('');
  const [progressShown, setProgressShown] = useState(0);
  const [draftVariant, setDraftVariant] = useState(0);
  const [draft, setDraft] = useState('');
  // The invite's own title, shown and editable on the draft card. It starts
  // from what the conversation would be about, not from the search text.
  const [requestTitle, setRequestTitle] = useState('');
  const [requestIntent, setRequestIntent] = useState('one_off');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [connectionsReady, setConnectionsReady] = useState(false);
  const [connectionCategory, setConnectionCategory] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [threadId, setThreadId] = useState(null);
  const [history, setHistory] = useState([]);
  const [resumeThread, setResumeThread] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [matchFeedback, setMatchFeedback] = useState(null);
  const [sentSessionToken, setSentSessionToken] = useState('');
  // Where a request reopened from history stands now (declined, completed...).
  const [sentStatus, setSentStatus] = useState('');
  // A search is linked to the first request sent from it. Later requests
  // from the same conversation are sent on their own, not refused.
  const [linkedThread, setLinkedThread] = useState(null);
  const threadEndRef = useRef(null);
  const composerInputRef = useRef(null);
  // A request whose answer never arrived may already be saved, so it is
  // retried exactly as sent and cannot be edited meanwhile.
  const [pendingRequest, setPendingRequest] = useState(null);
  const flowVersion = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const resumedFromUrl = useRef(null);
  // Earlier result sets stay reachable: each can be reopened in place.
  const [openEarlier, setOpenEarlier] = useState(() => new Set());
  const toggleEarlier = (key) => setOpenEarlier((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Opening a profile from the results leaves a way back: the conversation is
  // written into the home URL first, so both the profile's "Back to chat"
  // button and the browser's own back button reopen it as it was.
  const profileHref = (personId) => `/profile/${personId}?from=chat${threadId ? `&thread=${encodeURIComponent(threadId)}` : ''}`;
  function viewProfile(personId) {
    if (threadId) navigate(`/?thread=${encodeURIComponent(threadId)}`, { replace: true });
    navigate(profileHref(personId));
  }

  useEffect(() => {
    if (!location.state?.resetDiscovery) return;
    reset();
    navigate('/', { replace: true, state: null });
  }, [location.key, location.state, navigate]);

  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }, [query, stage]);

  async function refreshHistory() {
    const { data } = await api.get('/discovery/threads?limit=8');
    setHistory(data || []);
    setResumeThread((data || []).find(resumableSearch) || null);
  }

  useEffect(() => { if (stage !== 'ask') threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [stage, selected, turns.length]);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    api.get('/discovery/threads?limit=8').then(({ data }) => {
      if (cancelled) return;
      setHistory(data || []);
      setResumeThread((data || []).find(resumableSearch) || null);
      setHistoryReady(true);
    }).catch(() => { if (!cancelled) setHistoryReady(true); });
    return () => { cancelled = true; };
  }, [user?.id]);
  useEffect(() => {
    const requested = searchParams.get('thread');
    if (!user?.id || !requested || requested === threadId || resumedFromUrl.current === requested) return;
    resumedFromUrl.current = requested;
    resumeSearch(requested);
  }, [user?.id, searchParams]);
  useEffect(() => {
    if (!user?.id || stage !== 'ask') return;
    let cancelled = false;
    api.get('/sessions')
      .then(({ data }) => { if (!cancelled) setConnections(data || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setConnectionsReady(true); });
    return () => { cancelled = true; };
  }, [stage, user?.id]);

  async function findMatches(nextQuery, activeThreadId = threadId) {
    const version = flowVersion.current;
    const message = nextQuery.trim();
    if (!message) return;
    setTurns(current => [...current, { role: 'user', content: message, at: new Date().toISOString() }]);
    setError(''); setStage('matching'); setMatchFeedback(null); setProgress([]); setProgressShown(0);
    setSelected(null); setDraft('');
    try {
      const onProgress = event => { if (version === flowVersion.current) setProgress(current => [...current, event]); };
      const [{ data }] = await Promise.all([api.post('/discovery/matches', { query: message, thread_id: activeThreadId }, { onProgress }), pause(350)]);
      if (version !== flowVersion.current) return;
      setThreadId(data.thread_id || activeThreadId);
      refreshHistory().catch(() => {});
      const nextMatches = (data.matches || []).map((person) => ({ person, expertise: person.expertise || [], background: person.background || '', reasons: person.reasons || [] }));
      setMatches(nextMatches);
      if (data.clarification) {
        setTurns(current => [...current, { role: 'assistant', kind: 'clarification', content: data.clarification, suggestions: Array.isArray(data.suggestions) ? data.suggestions : [], at: new Date().toISOString() }]);
        setStage('clarify');
      } else {
        setSubmittedQuery(requestText(data.resolved_request, message));
        setTurns(current => [...current, {
          role: 'assistant',
          kind: nextMatches.length ? 'matches' : 'no_match',
          // The server now writes the whole sentence around the results, sized
          // to how many people came back; older replies fall back to the copy.
          framed: Boolean(data.message),
          content: nextMatches.length
            ? (data.message || (data.nearest && data.no_match_reason ? data.no_match_reason : 'matches_ready'))
            : (data.no_match_reason || copy.noMatches),
          matches: Array.isArray(data.matches) ? data.matches : [],
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

  // Choosing someone first asks why them: a reason in the student's own words
  // is what keeps the message from reading like a template.
  function choose(match) {
    setPendingRequest(null);
    setSelected(match); setDraftVariant(0); setRequestTitle(suggestedTitle(match, submittedQuery));
    setMotivation(''); setError(''); setStage('motivate');
  }

  async function writeDraft(why) {
    const version = flowVersion.current;
    const match = selected;
    if (!match) return;
    setStage('drafting'); setError('');
    try {
      const { data } = await api.post('/discovery/draft', { query: submittedQuery, person_id: match.person.id, variant: 0, thread_id: threadId, ...(why ? { motivation: why } : {}) });
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
      const { data } = await api.post('/discovery/draft', { query: submittedQuery, person_id: selected.person.id, variant, thread_id: threadId, ...(motivation.trim() ? { motivation: motivation.trim() } : {}) });
      setThreadId(data.thread_id || threadId);
      setDraft(data.draft || '');
    } catch (requestError) { setError(requestErrorMessage(requestError, copy)); }
    finally { setSending(false); }
  }

  async function sendRequest() {
    if (!selected || !draft.trim() || !requestTitle.trim() || sending) return;
    setSending(true); setError('');
    try {
      const payload = pendingRequest || { mentor_id: selected.person.id, title: requestTitle.trim().slice(0, 120), pre_session_question: submittedQuery, message: draft.trim(), duration_minutes: 60, follow_up_intent: requestIntent, idempotency_key: crypto.randomUUID(), ...(threadId && threadId !== linkedThread ? { thread_id: threadId } : {}) };
      setPendingRequest(payload);
      const response = await api.post('/sessions', payload);
      setPendingRequest(null);
      setSessionId(response.data.id);
      setSentSessionToken(response.data.route_token || '');
      setSentStatus('');
      if (payload.thread_id) setLinkedThread(payload.thread_id);
      setStage('sent');
      refreshHistory().catch(() => {});
    } catch (requestError) {
      // Only a refusal (4xx) is known to have saved nothing, so only then may
      // the request be edited. Every failure carries a response, a dropped
      // connection included, so the status is what tells them apart.
      const status = requestError.response?.status;
      if (status >= 400 && status < 500) setPendingRequest(null);
      // The search already has its request (an earlier send whose answer was lost): the next try goes without it.
      if (requestError.response?.data?.error === 'thread_already_linked') setLinkedThread(threadId);
      setError(errorMessage(requestError, t, copy.error));
    }
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
      if (!lastUser?.content) return;
      if (!lastAssistant) {
        setThreadId(id);
        setSubmittedQuery(lastUser.content);
        await findMatches(lastUser.content, id);
        return;
      }
      setTurns(visibleTurns(data.turns));
      // A search records the request it produced. Nothing is inferred from
      // who else the user has a request with, and a request that has since
      // been declined or completed is still the one this search sent.
      setLinkedThread(data.session_id ? id : null);
      if (data.session_id && lastAssistant.kind === 'draft' && lastAssistant.person) {
        const { data: sessions } = await api.get('/sessions');
        const sentSession = (sessions || []).find(session => session.id === data.session_id);
        if (sentSession) {
          setSentStatus(isExpired(sentSession) ? 'expired' : sentSession.status);
          setSelected({ person: lastAssistant.person, expertise: lastAssistant.person.expertise || [], background: lastAssistant.person.background || '', reasons: lastAssistant.person.reasons || [] });
          // What was sent, which the user may have reworded after it was drafted.
          setDraft(sentSession.outbound_message || lastAssistant.content || '');
          setRequestTitle(sentSession.title || '');
          setSubmittedQuery(requestText(lastAssistant.search_request, lastUser.content));
          setSessionId(sentSession.id);
          setSentSessionToken(sentSession.route_token || '');
          setThreadId(id);
          setStage('sent');
          return;
        }
      }
      await api.put(`/discovery/threads/${id}`, { archived: false });
      setThreadId(id);
      setSubmittedQuery(requestText(lastAssistant.search_request, lastUser.content));
      setQuery(''); setMatches([]); setSelected(null); setDraft('');
      if (lastAssistant.kind === 'matches' && Array.isArray(lastAssistant.matches)) {
        setMatches(lastAssistant.matches.map(person => ({ person, expertise: person.expertise || [], background: person.background || '', reasons: person.reasons || [] })));
        setStage('choose');
      } else if ((lastAssistant.kind === 'clarification' || lastAssistant.kind === 'chat')) {
        setStage('clarify');
      } else if (lastAssistant.kind === 'no_match') {
        setStage('empty');
      } else if (lastAssistant.kind === 'draft' && lastAssistant.person) {
        const person = lastAssistant.person;
        setSelected({ person, expertise: person.expertise || [], background: person.background || '', reasons: person.reasons || [] });
        setDraft(lastAssistant.content || '');
        setRequestTitle(suggestedTitle({ person, expertise: person.expertise || [] }, requestText(lastAssistant.search_request, lastUser.content)));
        setStage('reachout');
      }
    } catch {
      setHistoryError(copy.error);
    }
  }

  async function deleteSearch() {
    const id = deleteTargetId;
    if (!id) return;
    try {
      await api.delete(`/discovery/threads/${id}`);
      setHistory(items => items.filter(item => item.id !== id));
      if (resumeThread?.id === id) setResumeThread(null);
      if (threadId === id) reset();
      setDeleteTargetId(null);
    } catch {
      setHistoryError(copy.error);
    }
  }

  async function reset() {
    if (searchParams.get('thread')) { resumedFromUrl.current = null; setSearchParams({}, { replace: true }); }
    flowVersion.current += 1;
    const currentThread = threadId;
    setConnectionCategory(null);
    setStage('ask'); setQuery(''); setSubmittedQuery(''); setTurns([]); setMatches([]); setSelected(null); setDraft(''); setRequestTitle(''); setRequestIntent('one_off'); setSending(false); setError(''); setSessionId(null); setSentSessionToken(''); setSentStatus(''); setThreadId(null); setMatchFeedback(null); setPendingRequest(null);
    if (currentThread) api.put(`/discovery/threads/${currentThread}`, { archived: true }).then(refreshHistory).catch(() => {});
  }

  // What the search is doing right now, one short line per real stage.
  const progressLines = progress.flatMap(event => {
    if (event.stage === 'considering') {
      return (event.people || []).filter(person => person.first && person.reason)
        .map(person => text(copy, 'progressConsidering', { name: person.first, reason: person.reason.replace(/^./, c => c.toLocaleLowerCase()).replace(/\.$/, '') }));
    }
    if (event.stage === 'candidates') return event.count ? [text(copy, 'progressCandidates', { count: event.count })] : [];
    const key = { reading: 'progressReading', searching: 'progressSearching', ranking: 'progressRanking', writing: 'progressWriting' }[event.stage];
    return key ? [copy[key]] : [];
  });

  // One line at a time, each held for two seconds before the next replaces it.
  useEffect(() => {
    if (stage !== 'matching' || progressShown >= progressLines.length - 1) return undefined;
    const timer = setTimeout(() => setProgressShown(index => index + 1), 2000);
    return () => clearTimeout(timer);
  }, [stage, progressShown, progressLines.length]);
  const progressNow = progressLines[Math.min(progressShown, progressLines.length - 1)];

  function composer() {
    return <><form className="discovery-composer" onSubmit={submit}><textarea data-control-radius-exempt ref={composerInputRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={2000} rows={1} placeholder={copy.placeholder} aria-label={copy.placeholder} disabled={stage === 'matching' || stage === 'drafting' || sending} /><Button size="icon" type="submit" className="send-spark" disabled={!query.trim() || stage === 'matching' || stage === 'drafting' || sending} aria-label={t('conversations.send')}><ArrowUp /></Button></form>
      {/* AI Act Art. 50: people are told they are talking to an AI. */}
      <p className="discovery-ai-note" data-testid="discovery-ai-note">{copy.aiNote}</p></>;
  }

  const firstName = user?.name?.split(' ')[0] || '';
  const connectionFilters = CONVERSATION_FILTERS.filter(option => ['needs', 'waiting', 'scheduled', 'past'].includes(option.key));
  const selectedConnectionFilter = connectionFilters.find(option => option.key === connectionCategory);
  const visibleConnections = selectedConnectionFilter ? connections.filter(session => selectedConnectionFilter.match(conversationState(session))) : [];
  const isConversation = stage !== 'ask';
  // The opening question names the thread, so the header says which search you are in.
  const threadTitle = turns.find(turn => turn.role === 'user')?.content || submittedQuery || copy.placeholder;

  // The draft is persisted as a turn so a reload can restore it, but the
  // reach-out panel below already renders it in an editable field — leaving it
  // in the transcript too prints the same letter twice. Drop it here, and
  // collapse any bubble that exactly repeats the one before it.
  const earlierIds = useMemo(() => {
    const resultTurns = turns.filter(turn => turn.role === 'assistant' && turn.kind === 'matches' && Array.isArray(turn.matches));
    return new Set(resultTurns.slice(0, -1).flatMap(turn => turn.matches.map(person => person?.id)).filter(Boolean));
  }, [turns]);
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
  return <section className={`discovery-flow ${isConversation ? 'is-conversation' : ''}`} aria-label="Ment discovery">{stage === 'ask' && <div className="discovery-page-title" aria-hidden="true"><span>{t('nav.home')}</span></div>}<div className="discovery-thread">
    {stage === 'ask' && (
      <div className="discovery-ask-block">
        <h1 className="discovery-greeting-scene">{copy.greeting.replace('{name}', firstName)}</h1>
        {composer()}
        <div className="discovery-home-row">
        {!selectedConnectionFilter && <div className="discovery-examples">{copy.examples.map(example => <button type="button" key={example} className="discovery-suggestion" onClick={() => findMatches(example)}>{example}</button>)}</div>}
        {(!historyReady || !connectionsReady) ? (
          <div className="discovery-meta-row discovery-home-skeleton" role="status" aria-label={t('common.loading')}>
            <div className="discovery-recent-row"><Skeleton className="size-[var(--connection-control-size)] rounded-full" /></div>
            <div className="discovery-connections"><div className="discovery-connection-bubbles">
              {connectionFilters.map(option => <Skeleton key={option.key} className="size-[var(--connection-control-size)] rounded-full" />)}
            </div></div>
          </div>
        ) : (history.length > 0 || connections.length > 0) && (
          <div className="discovery-meta-row">
            {history.length > 0 && (
              <div className="discovery-recent-row">
                <details className="discovery-history">
                  <summary><span className="discovery-history-mark"><Clock3 aria-hidden="true" /></span><span>{copy.history}</span></summary>
                  <div className="discovery-history-list" aria-label={copy.recentSearches}>{history.map(item => {
                    const title = [...(item.turns || [])].reverse().find(turn => turn?.role === 'user')?.content || requestText(item.title);
                    const date = item.updated_at ? new Date(item.updated_at) : null;
                    const dateLabel = date && !Number.isNaN(date.getTime()) ? formatDay(date, lang) : '';
                    return <div className="discovery-history-row" key={item.id}>
                      <button type="button" className="discovery-history-open" onClick={() => resumeSearch(item.id)} aria-label={`${copy.resume}: ${title}`} title={title}>
                        <span className="discovery-history-date">{dateLabel}</span><span className="discovery-history-title">{title}</span><span className="discovery-history-arrow"><ArrowUpRight aria-hidden="true" /></span>
                      </button>
                      <button type="button" className="discovery-history-delete" aria-label={`${copy.deleteSearch}: ${title}`} title={copy.deleteSearch} onClick={() => { setHistoryError(''); setDeleteTargetId(item.id); }}><Trash2 aria-hidden="true" /></button>
                    </div>;
                  })}</div>
                </details>
              </div>
            )}
            {connections.length > 0 && (
              <div className="discovery-connections">
                <div className="discovery-connection-bubbles" role="group" aria-label={copy.snapshot}>
                  {connectionFilters.map(option => {
                    const active = option.key === connectionCategory;
                    const count = connections.filter(session => option.match(conversationState(session))).length;
                    return <Button
                      key={option.key}
                      id={`connection-category-${option.key}`}
                      type="button"
                      variant="ghost"
                      className="discovery-connection-bubble"
                      aria-label={`${t(option.label)} ${count}`}
                      aria-expanded={active}
                      aria-controls={active ? 'discovery-connection-chats' : undefined}
                      onClick={() => setConnectionCategory(current => current === option.key ? null : option.key)}
                    ><strong>{count}</strong><span>{t(option.label)}</span></Button>;
                  })}
                </div>
                {selectedConnectionFilter && <div id="discovery-connection-chats" className="discovery-connection-panel discovery-reveal" role="region" aria-labelledby={`connection-category-${connectionCategory}`}>
                  <div className="discovery-connection-panel-header">
                    <h2>{t(selectedConnectionFilter.label)}</h2>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t('common.close')} onClick={() => setConnectionCategory(null)}><X aria-hidden="true" /></Button>
                  </div>
                  {visibleConnections.length === 0 ? <p className="discovery-connection-empty">{t('conversations.filter.empty')}</p> : <div className="discovery-connection-cards">
                    {visibleConnections.map((session, index) => {
                      const peer = session.mentor_id === user?.id ? session.mentee : session.mentor;
                      const href = session.route_token ? sessionPath(session) : `/conversations?filter=${connectionCategory}&session=${session.id}`;
                      return <Link key={session.id} className="discovery-connection-card" to={href} aria-label={`${copy.openChat}: ${peer?.name || ''}`}>
                        <span className="discovery-avatar" aria-hidden="true" style={{ backgroundColor: avatarTint(peer?.name) }}>{initials(peer?.name)}</span>
                        <span><strong>{peer?.name}</strong><small>{requestText(session.title, t('conversations.requestTitle'))}</small></span>
                        <ArrowUpRight aria-hidden="true" />
                      </Link>;
                    })}
                  </div>}
                </div>}
              </div>
            )}
          </div>
        )}
        </div>
        {historyError && <p role="alert">{historyError}</p>}
        {error && <p className="discovery-error" role="alert">{error}</p>}
      </div>
    )}
    {isConversation && <div className="discovery-conversation"><div className="discovery-conversation-toolbar"><span className="discovery-thread-title"><strong>{threadTitle}</strong></span><Button type="button" variant="ghost" size="sm" onClick={reset} disabled={sending}><Pencil />{copy.newChat}</Button></div><div className="discovery-header-fade" aria-hidden="true" /><div className="discovery-chat-transcript">{renderedTurns.map((turn, index) => {
      if (turn.role === 'user') return <div className="discovery-chat-turn is-user" key={`${turn.at || index}-${index}`}><div className="discovery-user-bubble">{turn.content}</div></div>;
      if (turn.role !== 'assistant') return null;
      const response = turn.kind === 'matches'
        ? (turn.framed ? turn.content
          : turn.content === 'matches_ready'
            ? `${copy.chooseLead} ${copy.chooseBold}`
            : `${turn.content} ${copy.nearestLead}`)
        : turn.content;
      // One agent mark per run of assistant turns.
      const continues = renderedTurns[index - 1]?.role === 'assistant';
      return <div className={`discovery-chat-turn is-assistant ${turn.kind === 'error' ? 'is-error' : ''}`} key={`${turn.at || index}-${index}`}>{continues ? <span className="discovery-agent-mark-spacer" aria-hidden="true" /> : <span className="discovery-agent-mark" aria-label="Ment">M</span>}<div className="discovery-assistant-stack"><p className="discovery-assistant-bubble">{renderInline(response)}</p>{(() => {
        const people = turn.kind === 'matches' && Array.isArray(turn.matches) ? turn.matches : [];
        const latestResults = renderedTurns.map(entry => entry.kind === 'matches').lastIndexOf(true);
        if (!people.length || (index === latestResults && stage === 'choose')) return null;
        const key = `${turn.at || index}`;
        const open = openEarlier.has(key);
        const label = open ? copy.hideEarlier : (people.length === 1 ? copy.showEarlierOne : copy.showEarlier.replace('{count}', people.length));
        return <div className="discovery-earlier">
          <button type="button" className="discovery-earlier-toggle" aria-expanded={open} onClick={() => toggleEarlier(key)}>{label}</button>
          {open && <div className="discovery-match-grid" role="radiogroup" aria-label={label}>{people.map((person, cardIndex) => {
            const match = { person, expertise: person.expertise || [], background: person.background || '', reasons: person.reasons || [] };
            return <MatchCard key={person.id} match={match} index={cardIndex} profileHref={profileHref} onViewProfile={viewProfile} selected={selected?.person.id === person.id} onSelect={choose} copy={copy} />;
          })}</div>}
        </div>;
      })()}{index === renderedTurns.length - 1 && stage === 'clarify' && Array.isArray(turn.suggestions) && turn.suggestions.length > 0 && <div className="discovery-suggestions" role="group">{turn.suggestions.map(choice => choice.href
          ? <Link key={choice.label} className="discovery-suggestion is-link" to={choice.href}>{choice.label}</Link>
          : <button type="button" key={choice.label} className="discovery-suggestion" disabled={sending} onClick={() => findMatches(choice.message)}>{choice.label}</button>)}</div>}</div></div>;
    })}</div>
    {stage === 'matching' && progressNow ? (
      <div className="discovery-chat-turn is-assistant is-working" role="status" aria-live="polite">
        <span className="discovery-agent-mark" aria-label="Ment">M</span>
        <p className="discovery-assistant-bubble" data-testid="discovery-progress"><span key={progressNow} className="discovery-progress-line">{progressNow}</span><span className="discovery-typing" aria-hidden="true"><i /><i /><i /></span></p>
      </div>
    ) : (stage === 'matching' || stage === 'drafting') && <div className="discovery-chat-turn is-assistant is-working" role="status" aria-live="polite"><span className="discovery-agent-mark" aria-label="Ment">M</span><p className="discovery-assistant-bubble">{stage === 'matching' ? copy.finding : copy.drafting}<span className="discovery-typing" aria-hidden="true"><i /><i /><i /></span></p></div>}
    {stage === 'motivate' && selected && (
      <div className="discovery-reachout discovery-reveal" data-testid="discovery-motivate">
        <div className="discovery-assistant-message">
          <span className="discovery-agent-mark" aria-hidden="true">M</span>
          <div className="discovery-message-body">
            <p>{text(copy, 'motivateQuestion', { name: selected.person.name.split(' ')[0] })}</p>
            <div className="discovery-to-row">
              <span className="discovery-avatar size-10" style={{ backgroundColor: avatarTint(selected.person.name) }}>{initials(selected.person.name)}</span>
              <span>
                <span className="discovery-micro">{copy.to}</span>
                <strong>{selected.person.name}</strong>
                <small>{[selected.person.job_title || selected.person.current_role, selected.person.department].filter(Boolean).join(' · ')}</small>
              </span>
            </div>
            <form className="discovery-draft is-motivate" onSubmit={event => { event.preventDefault(); if (motivation.trim().length >= 10) writeDraft(motivation.trim()); }}>
              <span className="discovery-draft-title"><span>{copy.motivateLabel}</span></span>
              <textarea data-control-radius-exempt autoFocus value={motivation} maxLength={500} onChange={event => setMotivation(event.target.value)} placeholder={copy.motivatePlaceholder} aria-label={copy.motivateLabel} data-testid="discovery-motivation" />
              <p className="discovery-ai-note is-draft">{copy.motivateHelp}</p>
              <div className="discovery-actions">
                <Button type="button" variant="link" onClick={() => setStage('choose')}><ArrowLeft />{copy.back}</Button>
                <div className="discovery-action-controls">
                  <Button type="button" variant="ghost" onClick={() => writeDraft('')} data-testid="discovery-motivation-skip">{copy.motivateSkip}</Button>
                  <Button type="submit" disabled={motivation.trim().length < 10} data-testid="discovery-motivation-write"><Pencil />{copy.motivateWrite}</Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    )}
    {stage === 'choose' && <div className="discovery-reveal"><div className="discovery-match-grid" role="radiogroup" aria-label="Choose a person">{matches.map((match, index) => <MatchCard key={match.person.id} match={match} index={index} seenBefore={earlierIds.has(match.person.id)} profileHref={profileHref} onViewProfile={viewProfile} selected={selected?.person.id === match.person.id} onSelect={choose} copy={copy} style={{ animationDelay: `${Math.min(index, 6) * 65}ms` }} />)}</div><div className="discovery-result-actions" role="group" aria-label={copy.useful}>
      <button type="button" className="discovery-result-icon" aria-label={`${copy.useful} ${copy.yes}`} title={copy.yes} aria-pressed={matchFeedback === true} onClick={() => saveMatchFeedback(true)}><ThumbsUp /></button>
      <button type="button" className="discovery-result-icon" aria-label={`${copy.useful} ${copy.no}`} title={copy.no} aria-pressed={matchFeedback === false} onClick={() => saveMatchFeedback(false)}><ThumbsDown /></button>
      <span className="discovery-result-separator" aria-hidden="true" />
      <button type="button" className="discovery-result-icon" aria-label={copy.different} title={copy.different} onClick={() => findMatches(submittedQuery)}><RefreshCw /></button>
      <Link to={`/explorer?mode=directory&q=${encodeURIComponent(submittedQuery)}`} className="discovery-result-icon" aria-label={copy.browse} title={copy.browse}><Search /></Link>
      {matchFeedback !== null && <span className="sr-only" role="status">{copy.feedbackSaved}</span>}
    </div></div>}
    {stage === 'empty' && <div className="discovery-empty"><button type="button" className="quiet-link" onClick={reset}>{copy.retry}</button></div>}
    {(stage === 'reachout' || stage === 'sent') && selected && (
      <div className="discovery-reachout discovery-reveal">
        <div className="discovery-assistant-message">
          <span className="discovery-agent-mark" aria-hidden="true">M</span>
          <div className="discovery-message-body">
            <p>{copy.intro}</p>
            <div className="discovery-to-row">
              <span className="discovery-avatar size-10" style={{ backgroundColor: avatarTint(selected.person.name) }}>{initials(selected.person.name)}</span>
              <span>
                <span className="discovery-micro">{copy.to}</span>
                <strong>{selected.person.name}</strong>
                <small>{[selected.person.job_title || selected.person.current_role, selected.person.department].filter(Boolean).join(' · ')}</small>
              </span>
            </div>
            <div className={`discovery-draft ${stage === 'sent' ? 'is-sent' : ''}`}>
              <span className="discovery-draft-tag">{copy.suggested}</span>
              <label className="discovery-draft-title">
                <span>{t('components.sessionRequest.requestTitle')}</span>
                <input type="text" data-control-radius-exempt value={requestTitle} maxLength={120} onChange={event => setRequestTitle(event.target.value)} disabled={stage === 'sent' || sending || !!pendingRequest} />
              </label>
              <textarea data-control-radius-exempt value={draft} onChange={event => setDraft(event.target.value)} disabled={stage === 'sent' || sending || !!pendingRequest} aria-label={copy.suggested} />
              {stage !== 'sent' && <p className="discovery-ai-note is-draft" data-testid="discovery-draft-ai-note">{copy.draftNote}</p>}
            </div>
            {stage === 'reachout' ? (
              <div className="discovery-actions">
                <Button type="button" variant="link" onClick={() => setStage('choose')}><ArrowLeft />{copy.back}</Button>
                <div className="discovery-action-controls">
                  <div className="discovery-intent-select">
                    <DirectoryFilter label={intentCopy.intent} value={requestIntent} onChange={setRequestIntent} disabled={sending || !!pendingRequest} options={[{ value: 'one_off', label: intentCopy.oneOff }, { value: 'ongoing', label: intentCopy.ongoing }]} renderValue={requestIntent === 'ongoing' ? intentCopy.ongoing : intentCopy.oneOff} />
                  </div>
                  <Button type="button" variant="ghost" onClick={regenerate} disabled={sending || !!pendingRequest}><RefreshCw />{copy.regenerate}</Button>
                  <Button type="button" onClick={sendRequest} disabled={sending || !draft.trim() || !requestTitle.trim()}>{sending ? <RefreshCw className="animate-spin" /> : <Send />}{copy.send}</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="discovery-confirmation"><Check /><div><strong>{text(copy, 'sent', { name: selected.person.name.split(' ')[0] })}</strong><p>{sentStatus && sentStatus !== 'pending' ? t(`conversations.status.${sentStatus}`) : copy.sentSubline}</p></div></div>
                {sessionId && <ButtonLink className="mt-4" to={sessionPath({ id: sessionId, route_token: sentSessionToken })}>{copy.openChat}</ButtonLink>}
                <Button type="button" variant="ghost" onClick={reset}>{copy.again}</Button>
              </>
            )}
            {error && <p className="discovery-error" role="alert">{error}</p>}
          </div>
        </div>
      </div>
    )}
    <div ref={threadEndRef} /></div>}
  </div>{isConversation && <div className="discovery-composer-dock">{composer()}</div>}
  <Dialog open={deleteTargetId !== null} onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{copy.deleteSearch}</DialogTitle><DialogDescription>{copy.confirmDeleteSearch}</DialogDescription></DialogHeader>
      {historyError && <p role="alert" className="text-sm text-destructive">{historyError}</p>}
      <DialogFooter><Button variant="outline" onClick={() => setDeleteTargetId(null)}>{copy.cancel}</Button><Button onClick={deleteSearch}>{copy.deleteSearch}</Button></DialogFooter>
    </DialogContent>
  </Dialog></section>;
}
