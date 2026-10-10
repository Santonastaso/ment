// Check-in suggestions. New entries carry at most two skills per side; older
// ones stored up to five, in machine style ("strategic_planning"). Nothing is
// rewritten: older lists are shown focused first, with the rest one tap away.
export const FOCUSED_SUGGESTIONS = 2;

/** Stored skill names as people read them, without duplicates. */
export function readableSkills(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map(skill => String(skill || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean))];
}

/** The suggestions shown first and the ones held back, in their stored order. */
export function focusSuggestions(list, limit = FOCUSED_SUGGESTIONS) {
  const skills = readableSkills(list);
  return { shown: skills.slice(0, limit), more: skills.slice(limit) };
}
