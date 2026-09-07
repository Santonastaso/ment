// Pure, deterministic demo fixtures. No credentials, network, or inference.
// Kept JavaScript-compatible so Node can test this module as .mjs.
export function sampleProfile() {
  return {
    classifier_source: 'demo',
    proposed: {
      job_title: 'Sample: Marketing specialist',
      department: 'Marketing',
      location: '',
      bio: 'Sample profile for review: I enjoy sharing content strategy and learning data analysis.',
      career_history: [],
      can_teach: [
        { skill: 'content strategy', example_project: '' },
        { skill: 'communication', example_project: '' },
      ],
      wants_to_learn: ['data analysis', 'project management'],
    },
  };
}

const SYNONYMS = [
  ['project management', 'project planning', 'project manager', 'gestione progetti', 'gestion de projet'],
  ['stakeholder management', 'stakeholder communication', 'stakeholder comms'],
  ['data analysis', 'data analytics', 'analisi dati', 'analyse de donnees'],
  ['Power BI', 'powerbi'],
  ['communication', 'comunicazione'],
  ['leadership', 'team leadership'],
  ['public speaking', 'presenting', 'parlare in pubblico', 'prise de parole'],
  ['mentoring', 'mentorship', 'mentor', 'mentore', 'mentorat'],
  ['financial modeling', 'financial modelling'],
  ['time management', 'gestione del tempo', 'gestion du temps'],
  ['content strategy', 'strategia dei contenuti', 'strategie de contenu'],
  ['SEO', 'search engine optimization'],
  ['Python'], ['SQL'], ['React'], ['Excel'],
];

function normalize(text = '') {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchFixtures(text = '') {
  const input = ' ' + normalize(text) + ' ';
  return SYNONYMS.filter((aliases) =>
    aliases.some((alias) => input.includes(' ' + normalize(alias) + ' '))
  ).map(([canonical]) => canonical).slice(0, 5);
}

export function demoReflection(supportNeeded = '', managedWell = '') {
  return {
    extracted_gaps: matchFixtures(supportNeeded),
    extracted_strengths: matchFixtures(managedWell),
    esco_uris: {},
    // An unmatched fixture is a successful demo result, not a failed classifier.
    classifier_source: 'demo',
  };
}
