// The member's data export as one CSV that opens in any spreadsheet: one line
// per stored value, as Section, Item, Field, Value. Item numbers the records
// within a section (blank for single records such as the profile); a value
// that is itself a list or object is written as JSON.

const HEADER = ['Section', 'Item', 'Field', 'Value'];

function cell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A spreadsheet would run a value starting with these as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportToCsv(data) {
  const rows = [HEADER];
  const record = (section, item, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [field, fieldValue] of Object.entries(value)) rows.push([section, item, field, fieldValue]);
    } else {
      rows.push([section, item, '', value]);
    }
  };
  for (const [section, value] of Object.entries(data || {})) {
    if (Array.isArray(value)) value.forEach((entry, index) => record(section, index + 1, entry));
    else if (value && typeof value === 'object') record(section, '', value);
    else rows.push(['export', '', section, value]);
  }
  // The byte-order mark makes Excel read accents and non-Latin names correctly.
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
