// Career dates are a year with an optional month. The picker's value is
// "YYYY-MM", or "YYYY-" when only the year is known: a CV that says "2020"
// must not come back as January 2020.

/** A plausible four-digit year from a number or text, else null. */
export function importedYear(value) {
  const year = String(value ?? '').match(/\b(19|20)\d{2}\b/)?.[0];
  return year ? Number(year) : null;
}

/** A month number from 1 to 12, else null. */
export function importedMonth(value) {
  const month = Number.parseInt(value, 10);
  return month >= 1 && month <= 12 ? month : null;
}

/** (year, month) to the picker's value; the month stays empty when unknown. */
export function monthYearValue(year, month) {
  const y = importedYear(year);
  if (!y) return '';
  const m = importedMonth(month);
  return `${y}-${m ? String(m).padStart(2, '0') : ''}`;
}

/** The picker's value back to { year, month }, each null when absent. */
export function parseMonthYear(value) {
  if (!value) return { year: null, month: null };
  const [year, month] = String(value).split('-');
  return { year: importedYear(year), month: importedMonth(month) };
}
