// Fallback copy while the shared catalogs are updated by their owner.
export const adminPmCopy = {
  'graph.filter.persona': 'Persona',
  'graph.filter.cohort': 'Cohort',
  'graph.filter.skill': 'Skill',
  'graph.filter.all': 'All',
  'graph.reset': 'Reset filters and view',
  'graph.fit': 'Fit graph',
  'graph.search': 'Find a person or skill',
  'graph.details': 'Node details',
  'graph.accessibleList': 'Browse accessible node list',
  'graph.kind.person': 'Person',
  'graph.kind.skill': 'Skill',
  'admin.pm.noData': 'No data',
  'admin.pm.loadFailed': 'Could not load this data. Please retry.',
  'admin.pm.definition': 'Definition and evidence',
  'admin.pm.numerator': 'Numerator',
  'admin.pm.denominator': 'Denominator',
  'admin.pm.period': 'Reporting period',
  'admin.pm.asOf': 'As of',
  'admin.pm.cohort': 'Cohort / term',
  'admin.pm.export': 'Export KPI definitions and values',
  'admin.pm.referrals': 'Referrals',
  'admin.pm.responseRate': 'Survey response rate',
  'admin.pm.auditHelp': 'Each event records who performed an action and when. Filter the most recent 100 loaded events by actor or action; export includes the full audit history.',
  'admin.pm.auditFilter': 'Filter loaded events by actor or action',
  'admin.pm.privacyHelp': 'School reporting uses aggregate activity. Members control the profile information they share. Private conversations and reflections are not school reporting content.',
  'admin.pm.schoolControls': 'School reporting controls',
  'admin.pm.consent': 'Consent and data handling',
  'admin.pm.consentHelp': 'Profile visibility and private data are separated below. Optional AI processing requires the applicable consent; contact the platform team for data access or deletion requests.',
  'admin.pm.platformTitle': 'Platform administration',
  'admin.pm.platformDescription': 'Platform administrators manage organizations and access requests across schools. School administrators manage only their own school.',
  'admin.tab.audit': 'Audit history',
};

export function pmTranslate(t, key, vars) {
  const translated = t(key, vars);
  return translated === key ? (adminPmCopy[key] || key) : translated;
}

export function formatAdminDate(value, missing = '—') {
  if (typeof value !== 'string' || !value.trim()) return missing;
  const raw = value.trim();
  // Only timestamps without a timezone need the database's UTC suffix.
  const normalized = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw) && !/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(raw) ? `${raw}Z` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? missing : date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
