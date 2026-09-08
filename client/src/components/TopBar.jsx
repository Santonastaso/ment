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
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[#fbfbfa]/95 px-4 backdrop-blur sm:px-6">
      {mobileMenu}
      {!user?.is_admin && <div className="hidden flex-1 justify-center md:flex">
        <form onSubmit={submit} className="w-full max-w-md" role="search">
          <div className="flex h-9 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[#f0f0ee] px-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors duration-150 focus-within:border-[#b8b8b4] focus-within:bg-white focus-within:ring-[3px] focus-within:ring-black/[0.05]">
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
