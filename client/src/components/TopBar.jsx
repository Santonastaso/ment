import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import UserMenu from './UserMenu.jsx';
import LanguageSwitcher from '../i18n/LanguageSwitcher.jsx';
import { useT } from '../i18n/index.jsx';

export default function TopBar({ mobileMenu }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  function submit(e) {
    e.preventDefault();
    const query = q.trim();
    // Route to Explorer; pass the query so it can pre-filter. Empty query just
    // opens Explorer.
    navigate(query ? `/explorer?q=${encodeURIComponent(query)}` : '/explorer');
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--sidebar)] px-4 sm:px-6">
      {mobileMenu}
      <div className="hidden flex-1 justify-center md:flex">
        <form onSubmit={submit} className="w-full max-w-md" role="search">
          <div className="flex h-9 w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-4 text-sm focus-within:ring-2 focus-within:ring-primary/40">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('topbar.searchPlaceholder')}
              aria-label={t('topbar.searchPlaceholder')}
              data-testid="topbar-search"
              className="w-full bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
        </form>
      </div>
      <div className="flex flex-1 items-center justify-end gap-3 md:flex-none">
        <LanguageSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
