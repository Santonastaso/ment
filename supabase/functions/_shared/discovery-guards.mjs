const weakReason = /\b(no direct|not directly|adjacent|transferable|may include|might have|not listed|indirect|senza esperienza diretta|nessuna esperienza diretta|sans experience directe|pas d.experience directe)\b/i;

// allowWeakReason is for the "nearest" tier only, where the model is asked to
// name the gap out loud ("works in corporate finance rather than audit"). The
// words that phrasing needs are exactly the ones weakReason rejects, so without
// this the tier would validate to empty and look like it had done nothing. The
// expertise check still applies: a near match must cite something real.
export function hasGroundedExpertise(candidate, ranked, { allowWeakReason = false } = {}) {
  if (!Array.isArray(ranked.matched_expertise) || !ranked.matched_expertise.length) return false;
  if (!allowWeakReason && (ranked.reasons || []).some((reason) => weakReason.test(String(reason)))) return false;
  const supplied = new Set(
    [...(candidate.skills || []), candidate.job_title, candidate.department, candidate.program, candidate.linkedin_headline]
      .filter(Boolean)
      .map((value) => String(value).trim().slice(0, 200).toLowerCase()),
  );
  return ranked.matched_expertise.some((value) => supplied.has(String(value || '').trim().slice(0, 200).toLowerCase()));
}

export function canHelpWithCareerGoal(candidate, request) {
  const careerGoal = /\b(internship|internships|stage|stages|tirocinio|tirocini|job search|job hunting|recherche d.emploi|cerc[oa] (?:un )?lavoro)\b/i.test(request);
  const isIntern = /\b(intern|internship|stagiaire|stage|tirocinante)\b/i.test(candidate.job_title || '');
  if (!careerGoal || !isIntern) return true;
  // Being another applicant is not evidence of being able to help an applicant.
  return (candidate.skills || []).some(skill => /\b(recruiting|recruitment|hiring|career coaching|interview preparation|recrutement|orientation professionnelle|selezione|colloqui)\b/i.test(skill));
}
