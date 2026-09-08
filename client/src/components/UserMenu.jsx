import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, LogOut, LifeBuoy, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import HelpFeedbackModal from './HelpFeedbackModal.jsx';
import LanguageSwitcher from '../i18n/LanguageSwitcher.jsx';

export default function UserMenu({ compact = false, placement = 'topbar' }) {
  const { user, session, logout } = useAuth();
  const { t } = useT();
  const email = session?.user?.email || '';
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const rootRef = useRef(null);

  const initials = (user?.name || '?')
    .split(' ')
    .map(p => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setOpen(false);
    await logout();
    navigate('/login');
  }

  return (
    <div className={cn('relative', !compact && 'w-full')} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'inline-flex h-12 items-center gap-2.5 rounded-full px-2 text-sm font-medium text-foreground',
          compact && 'size-9 justify-center rounded-full p-0',
          !compact && 'w-full justify-start',
          'outline-none hover:bg-[var(--sidebar-accent)] focus-visible:ring-2 focus-visible:ring-ring/50',
          open && 'bg-[var(--sidebar-accent)]'
        )}
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
        {!compact && <span className="min-w-0 flex-1 truncate text-left">{user?.name}</span>}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 w-60 rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-overlay)]',
            placement === 'sidebar'
              ? compact ? 'bottom-0 left-full ml-2' : 'bottom-full left-0 mb-2'
              : 'right-0 top-full mt-1'
          )}
        >
          <div className="flex items-center gap-2.5 border-b border-border px-2 py-2.5">
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary text-xs font-semibold text-white">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" strokeWidth={2.2} />
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); navigate('/profile'); }}
            className="flex h-10 w-full items-center gap-3 rounded-full px-3 text-sm hover:bg-[var(--control-surface)]"
          >
            <User className="size-5" strokeWidth={2.2} />
            {t('nav.myProfile')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="help-feedback-menu-item"
            onClick={() => { setOpen(false); setHelpOpen(true); }}
            className="flex h-10 w-full items-center gap-3 rounded-full px-3 text-sm hover:bg-[var(--control-surface)]"
          >
            <LifeBuoy className="size-5" strokeWidth={2.2} />
            {t('common.helpFeedback')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex h-10 w-full items-center gap-3 rounded-full px-3 text-sm hover:bg-[var(--control-surface)]"
          >
            <LogOut className="size-5" strokeWidth={2.2} />
            {t('common.signOut')}
          </button>
          <div className="mt-1 flex items-center justify-between border-t border-border px-2.5 pt-2">
            <span className="text-xs text-muted-foreground">Language</span>
            <LanguageSwitcher />
          </div>
        </div>
      )}

      {helpOpen && (
        <HelpFeedbackModal onClose={() => setHelpOpen(false)} />
      )}
    </div>
  );
}
