const weakReason = /\b(no direct|not directly|adjacent|transferable|may include|might have|not listed|indirect|senza esperienza diretta|nessuna esperienza diretta|sans experience directe|pas d.experience directe)\b/i;

export function hasGroundedExpertise(candidate, ranked) {
  if (!Array.isArray(ranked.matched_expertise) || !ranked.matched_expertise.length) return false;
  if ((ranked.reasons || []).some((reason) => weakReason.test(String(reason)))) return false;
  const supplied = new Set(
    [...(candidate.skills || []), candidate.job_title, candidate.department, candidate.program, candidate.linkedin_headline]
      .filter(Boolean)
      .map((value) => String(value).trim().slice(0, 200).toLowerCase()),
  );
  return ranked.matched_expertise.some((value) => supplied.has(String(value || '').trim().slice(0, 200).toLowerCase()));
}
