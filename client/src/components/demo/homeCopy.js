// Component-local copy while shared catalogs are owned by the localization agent.
const en = {
  badge: 'Demo assistant', title: 'Who could help you move forward?', intro: 'Tell me what you are working on. Suggestions use Ment ranked matching and real directory profiles.',
  browse: 'Browse directory', newSearch: 'New search', archive: 'Archive', continue: 'Continue conversation', recent: 'Your conversations', relationships: 'Continue a relationship',
  placeholder: 'For example: help preparing for an internship interview', send: 'Send', busy: 'Working...',
  clarify: 'Is this about an internship, a career change, technical help, or ongoing alumni mentorship? Tell me the topic or skill you want help with.',
  results: 'These suggestions combine your request with Ment profile ranking. Availability and request limits are checked again when you send.',
  empty: 'No available profile matched this topic. Try another skill or browse the directory.',
  error: 'Could not load the directory. Your message is still here; try again.', saveError: 'Conversation could not be saved. Retry saving before leaving this page.', retry: 'Retry',
  loadError: 'Saved conversations could not be loaded.', saved: 'Conversation saved', request: 'Review request', evidence: 'Profile details', you: 'You',
  oneOff: 'One-off conversation', ongoing: 'Ongoing support', intent: 'What kind of support?', resume: 'Open existing session', selected: 'Selected person',
  draft: 'Demo draft - edit the complete message below', recipient: 'Recipient', message: 'Outgoing message', hello: 'Hello',
  ongoingDraft: 'I would like to explore ongoing support, if that works for you.', oneOffDraft: 'Would you be available for a one-off conversation?',
  proposedTime: 'Proposed time', flexibleDraft: 'We can agree on a time together.', emptyDraft: 'Enter the message you want to send.', close: 'Close', available: 'Available to request', unavailable: 'Currently unavailable',
};
const it = {
  badge: 'Assistente demo', title: 'Chi potrebbe aiutarti a fare un passo avanti?', intro: 'Racconta su cosa stai lavorando. I suggerimenti usano il ranking Ment e profili reali della directory.',
  browse: 'Sfoglia la directory', newSearch: 'Nuova ricerca', archive: 'Archivia', continue: 'Continua la conversazione', recent: 'Le tue conversazioni', relationships: 'Continua una relazione',
  placeholder: 'Per esempio: preparare un colloquio per un tirocinio', send: 'Invia', busy: 'Caricamento...',
  clarify: 'Cerchi un tirocinio, un cambio di carriera, aiuto tecnico o un mentore tra gli alumni? Indica il tema o la competenza.',
  results: 'Questi suggerimenti combinano la tua richiesta con il ranking dei profili Ment. Disponibilita e limiti saranno ricontrollati quando invii.',
  empty: 'Nessun profilo disponibile corrisponde a questo tema. Prova una competenza diversa o sfoglia la directory.',
  error: 'Impossibile caricare la directory. Il messaggio e ancora qui: riprova.', saveError: 'Conversazione non salvata. Riprova prima di lasciare questa pagina.', retry: 'Riprova',
  loadError: 'Impossibile caricare le conversazioni salvate.', saved: 'Conversazione salvata', request: 'Rivedi la richiesta', evidence: 'Dettagli del profilo', you: 'Tu',
  oneOff: 'Conversazione singola', ongoing: 'Supporto continuativo', intent: 'Che tipo di supporto?', resume: 'Apri incontro esistente', selected: 'Persona scelta',
  draft: 'Bozza demo - modifica il messaggio completo', recipient: 'Destinatario', message: 'Messaggio da inviare', hello: 'Ciao',
  ongoingDraft: 'Vorrei valutare un supporto continuativo, se per te va bene.', oneOffDraft: 'Ti andrebbe una conversazione singola?',
  proposedTime: 'Orario proposto', flexibleDraft: 'Possiamo concordare insieme un orario.', emptyDraft: 'Inserisci il messaggio da inviare.', close: 'Chiudi', available: 'Disponibile per una richiesta', unavailable: 'Al momento non disponibile',
};
const fr = {
  badge: 'Assistant de demonstration', title: 'Qui pourrait vous aider a avancer ?', intro: 'Expliquez votre besoin. Les suggestions utilisent le classement Ment et les profils reels du repertoire.',
  browse: 'Parcourir le repertoire', newSearch: 'Nouvelle recherche', archive: 'Archiver', continue: 'Continuer la conversation', recent: 'Vos conversations', relationships: 'Poursuivre une relation',
  placeholder: 'Par exemple : preparer un entretien pour un stage', send: 'Envoyer', busy: 'Chargement...',
  clarify: 'Cherchez-vous un stage, une reconversion, une aide technique ou un mentor parmi les alumni ? Precisez le sujet ou la competence.',
  results: 'Ces suggestions combinent votre demande et le classement des profils Ment. La disponibilite et les limites seront verifiees lors de l envoi.',
  empty: 'Aucun profil disponible ne correspond a ce sujet. Essayez une autre competence ou parcourez le repertoire.',
  error: 'Impossible de charger le repertoire. Votre message est conserve : reessayez.', saveError: 'Conversation non enregistree. Reessayez avant de quitter cette page.', retry: 'Reessayer',
  loadError: 'Impossible de charger les conversations enregistrees.', saved: 'Conversation enregistree', request: 'Relire la demande', evidence: 'Details du profil', you: 'Vous',
  oneOff: 'Conversation ponctuelle', ongoing: 'Accompagnement regulier', intent: 'Quel type de soutien ?', resume: 'Ouvrir la rencontre existante', selected: 'Personne choisie',
  draft: 'Brouillon de demonstration - modifiez le message complet', recipient: 'Destinataire', message: 'Message a envoyer', hello: 'Bonjour',
  ongoingDraft: 'Je souhaiterais envisager un accompagnement regulier, si cela vous convient.', oneOffDraft: 'Seriez-vous disponible pour une conversation ponctuelle ?',
  proposedTime: 'Horaire propose', flexibleDraft: 'Nous pouvons convenir ensemble d un horaire.', emptyDraft: 'Saisissez le message a envoyer.', close: 'Fermer', available: 'Disponible pour une demande', unavailable: 'Indisponible actuellement',
};
export const homeCopy = lang => ({ en, it, fr }[lang] || en);
