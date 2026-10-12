// One pale brand tint per person, so a list of people is not a column of
// identical circles. Initials stay Ink on all of them.
const TINTS = ['#e7e5f5', '#ffe3de', '#d9f4ec', '#e3e2ea'];

// Keyed on the first letter only: some places show "VS", others "V" or the
// full name, and the same person must get the same tint in all of them.
export function avatarTint(key = '') {
  const first = String(key).trim().toUpperCase().charCodeAt(0) || 0;
  return TINTS[first % TINTS.length];
}
