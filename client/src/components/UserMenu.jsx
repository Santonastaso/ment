import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, LifeBuoy } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import HelpFeedbackModal from './HelpFeedbackModal.jsx';

export default function UserMenu() {
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
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium text-foreground',
          'outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50'
        )}
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="hidden max-w-[120px] truncate sm:inline">{user?.name}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <div className="border-b border-border px-2.5 py-2">
            <p className="text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            data-testid="help-feedback-menu-item"
            onClick={() => { setOpen(false); setHelpOpen(true); }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
          >
            <LifeBuoy className="size-4" />
            {t('common.helpFeedback')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
          >
            <LogOut className="size-4" />
            {t('common.signOut')}
          </button>
        </div>
      )}

      {helpOpen && (
        <HelpFeedbackModal onClose={() => setHelpOpen(false)} />
      )}
    </div>
  );
}
