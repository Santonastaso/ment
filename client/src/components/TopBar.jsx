import React from 'react';
import UserMenu from './UserMenu.jsx';

export default function TopBar({ mobileMenu }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--sidebar)] px-4 sm:px-6">
      {mobileMenu}
      <div className="hidden flex-1 justify-center md:flex">
        <div className="flex h-9 w-full max-w-md items-center rounded-full border border-[var(--border)] bg-[var(--background)] px-4 text-sm text-muted-foreground">
          Search people and skills
        </div>
      </div>
      <div className="flex flex-1 justify-end md:flex-none">
        <UserMenu />
      </div>
    </header>
  );
}
