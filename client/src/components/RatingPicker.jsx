import React, { useState } from 'react';
import { useT } from '../i18n/index.jsx';

// 5-star rating with optional hover preview, used both in the mark-complete
// flow and in the ex-post reflection editor. The picker is intentionally
// minimal: no half-stars, no required state, no decimals. Users can clear by
// clicking the currently-selected star a second time.
//
// Props:
//   value       — current rating (1-5) or null
//   onChange    — (newValue) => void
//   disabled    — read-only display
//   showHint    — optional small label below the row
const HINT_KEYS = {
  1: 'components.rating.hint1',
  2: 'components.rating.hint2',
  3: 'components.rating.hint3',
  4: 'components.rating.hint4',
  5: 'components.rating.hint5',
};

export default function RatingPicker({ value = null, onChange, disabled = false, showHint = true }) {
  const { t } = useT();
  const [hovered, setHovered] = useState(null);
  const display = hovered ?? value ?? 0;
  const hintFor = hovered ?? value;

  function handleClick(n) {
    if (disabled) return;
    // Clicking the current value clears it
    onChange?.(value === n ? null : n);
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <div
        className="flex items-center gap-1"
        onMouseLeave={() => setHovered(null)}
        role="radiogroup"
        aria-label={t('components.rating.aria')}
      >
        {[1, 2, 3, 4, 5].map(n => {
          const filled = n <= display;
          return (
            <button
              key={n}
              type="button"
              onClick={() => handleClick(n)}
              onMouseEnter={() => !disabled && setHovered(n)}
              disabled={disabled}
              aria-checked={value === n}
              role="radio"
              className={`w-7 h-7 inline-flex items-center justify-center rounded transition-colors ${
                disabled ? 'cursor-default' : 'cursor-pointer hover:bg-amber-50'
              }`}
              title={t(HINT_KEYS[n])}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" className={filled ? 'text-amber-400' : 'text-gray-300'}>
                <path
                  fill="currentColor"
                  d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                />
              </svg>
            </button>
          );
        })}
      </div>
      {showHint && (
        <p className="text-[11px] text-gray-500 h-4">
          {hintFor ? t(HINT_KEYS[hintFor]) : t('components.rating.tapToRate')}
        </p>
      )}
    </div>
  );
}
