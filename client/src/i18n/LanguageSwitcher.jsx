import React from 'react';
import { useT } from './index.jsx';
import { cn } from '@/lib/utils';

// Compact EN | IT segmented toggle for the top bar (sits left of the user menu).
export default function LanguageSwitcher({ className }) {
  const { lang, setLang } = useT();
  const options = [
    { code: 'en', label: 'EN' },
    { code: 'it', label: 'IT' },
  ];
  return (
    <div
      role="group"
      aria-label="Language"
      data-testid="language-switcher"
      className={cn('inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5', className)}
    >
      {options.map((o) => {
        const active = lang === o.code;
        return (
          <button
            key={o.code}
            type="button"
            data-testid={`lang-${o.code}`}
            aria-pressed={active}
            onClick={() => setLang(o.code)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
