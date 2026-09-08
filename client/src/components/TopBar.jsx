import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import UserMenu from './UserMenu.jsx';
import LanguageSwitcher from '../i18n/LanguageSwitcher.jsx';
import { useT } from '../i18n/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function TopBar({ mobileMenu, discovery = false }) {
  const { t } = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  function submit(e) {
    e.preventDefault();
    const query = q.trim();
    // Route to Explorer; pass the query so it can pre-filter. Empty query just
    // opens Explorer.
    navigate(query ? `/explorer?q=${encodeURIComponent(query)}` : '/explorer');
  }

  if (discovery) {
    return (
      <header className="discovery-topbar">
        <Link to="/" className="discovery-brand" aria-label="Ment home"><span>M</span>Ment</Link>
        <div className="flex items-center gap-2 sm:gap-4"><Link to="/explorer?mode=directory" className="discovery-directory-link">Directory</Link><LanguageSwitcher /><UserMenu compact /></div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[rgb(255_255_255_/_72%)] px-5 backdrop-blur sm:px-8">
      {mobileMenu}
      {!user?.is_admin && <div className="hidden flex-1 justify-center md:flex">
        <form onSubmit={submit} className="w-full max-w-md" role="search">
          <div className="flex h-10 w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[#faf8f4] px-3.5 text-sm transition-colors duration-150 focus-within:border-primary focus-within:bg-white focus-within:ring-[3px] focus-within:ring-primary/10">
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
      </div>}
      <div className="flex flex-1 items-center justify-end gap-3 md:flex-none">
        <LanguageSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
