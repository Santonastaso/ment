import React from 'react';
import { useT } from '../i18n/index.jsx';

// Unambiguous month/year picker — two dropdowns instead of <input type="month">
// because that native control renders very differently across browsers and
// doesn't make the expected format obvious.
//
// Value shape: a "YYYY-MM" string (matching the format the server expects),
// or empty string when nothing's selected. Both selects can be cleared.

const MONTH_VALUES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function buildYearOptions() {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current; y >= 1970; y--) years.push(y);
  return years;
}

export default function MonthYearPicker({ value = '', onChange, allowEmpty = true }) {
  const { t } = useT();
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
        aria-label={t('components.monthYear.monthLabel')}
      >
        <option value="">{t('components.monthYear.monthLabel')}</option>
        {MONTH_VALUES.map(v => (
          <option key={v} value={v}>{t(`components.monthYear.month${v}`)}</option>
        ))}
      </select>
      <select
        className="input text-sm flex-1"
        value={year || ''}
        onChange={e => update(e.target.value, month)}
        aria-label={t('components.monthYear.yearLabel')}
      >
        <option value="">{t('components.monthYear.yearLabel')}</option>
        {buildYearOptions().map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
