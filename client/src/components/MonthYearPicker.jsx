import React from 'react';

// Unambiguous month/year picker — two dropdowns instead of <input type="month">
// because that native control renders very differently across browsers and
// doesn't make the expected format obvious.
//
// Value shape: a "YYYY-MM" string (matching the format the server expects),
// or empty string when nothing's selected. Both selects can be cleared.

const MONTH_OPTIONS = [
  { value: '01', label: 'Jan' }, { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' }, { value: '04', label: 'Apr' },
  { value: '05', label: 'May' }, { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' }, { value: '08', label: 'Aug' },
  { value: '09', label: 'Sep' }, { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' }, { value: '12', label: 'Dec' },
];

function buildYearOptions() {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current; y >= 1970; y--) years.push(y);
  return years;
}

export default function MonthYearPicker({ value = '', onChange, allowEmpty = true }) {
  const [year, month] = (value || '').split('-');

  function update(nextYear, nextMonth) {
    if (!nextYear && !nextMonth) {
      onChange('');
      return;
    }
    // Pad month to 2 digits; year stays as-is
    onChange(`${nextYear || ''}-${(nextMonth || '').padStart(2, '0').slice(0, 2)}`);
  }

  return (
    <div className="flex gap-2">
      <select
        className="input text-sm flex-1"
        value={month || ''}
        onChange={e => update(year, e.target.value)}
        aria-label="Month"
      >
        <option value="">Month</option>
        {MONTH_OPTIONS.map(m => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      <select
        className="input text-sm flex-1"
        value={year || ''}
        onChange={e => update(e.target.value, month)}
        aria-label="Year"
      >
        <option value="">Year</option>
        {buildYearOptions().map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
