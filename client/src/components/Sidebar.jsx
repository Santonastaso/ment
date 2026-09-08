import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CircleUserRound, MessageCircle, PanelLeftClose, PanelLeftOpen, Search, Server, Share2, Shield, SquarePen } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { cn } from '@/lib/utils';
import UserMenu from './UserMenu.jsx';

export default function Sidebar({ collapsed = false, onNavigate, onToggle }) {
  const { user, pendingAcceptanceCount } = useAuth();
  const { t } = useT();
  const location = useLocation();

  const links = user?.is_admin
    ? [
        { to: '/admin/graph', label: t('nav.knowledgeGraph'), icon: Share2, testid: 'nav-knowledge-graph' },
        { to: '/admin', label: t('nav.admin'), icon: Shield },
        ...(user?.admin_scope === 'platform' ? [{ to: '/admin/ops', label: t('nav.platformOps'), icon: Server, testid: 'nav-platform-ops' }] : []),
      ]
    : [
        { to: '/', label: t('nav.home'), icon: SquarePen },
        { to: '/explorer', label: t('nav.explorer'), icon: Search },
        { to: '/groups', label: t('nav.groups'), icon: MessageCircle },
        { to: '/profile', label: t('nav.myProfile'), icon: CircleUserRound, match: (p, uid) => p === '/profile' || p === `/profile/${uid}` },
      ];

  return (
    <div className={cn('flex h-full flex-col py-2.5', collapsed ? 'px-2' : 'px-2.5')}>
      <div className={cn('mb-6 flex h-11 items-center', collapsed ? 'justify-center' : 'justify-between')}>
        {collapsed ? <button type="button" onClick={onToggle} className="group grid size-11 place-items-center rounded-full outline-none hover:bg-[var(--sidebar-accent)] focus-visible:ring-3 focus-visible:ring-[var(--sidebar-ring)]" aria-label="Open sidebar" title="Open sidebar">
          <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-white group-hover:hidden">M</span>
          <PanelLeftOpen className="hidden size-[22px] text-foreground group-hover:block" strokeWidth={2.3} />
        </button> : <Link to={user?.is_admin ? '/admin' : '/'} onClick={onNavigate} className="flex h-11 items-center gap-2.5 px-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">M</span>
          <span className="text-[17px] font-semibold tracking-[-0.025em] text-foreground">MENT</span>
        </Link>}
        {!collapsed && onToggle && <button type="button" onClick={onToggle} className="grid size-10 place-items-center rounded-full text-muted-foreground outline-none hover:bg-[var(--sidebar-accent)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-[var(--sidebar-ring)]" aria-label="Close sidebar" title="Close sidebar">
          <PanelLeftClose className="size-[22px]" strokeWidth={2.3} />
        </button>}
      </div>

      <nav className="flex flex-col gap-0.5">
        {links.map(item => {
          const active = item.match
            ? item.match(location.pathname, user?.id)
            : location.pathname === item.to;
          const Icon = item.icon;
          const showBadge = item.to === '/' && pendingAcceptanceCount > 0;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              data-testid={item.testid}
              className={cn(
                'relative flex h-10 items-center rounded-full text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-[var(--sidebar-ring)]',
                collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                active
                  ? 'bg-[var(--sidebar-accent)] text-foreground'
                  : 'text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]'
              )}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="size-5 shrink-0" strokeWidth={2.05} />
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {showBadge && (
                <span
                  data-testid="home-pending-badge"
                  className={cn('inline-flex items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground', collapsed ? 'absolute right-1 top-1 size-4' : 'ml-auto h-5 min-w-[1.25rem] px-1.5')}
                  aria-label={`${pendingAcceptanceCount} pending acceptance${pendingAcceptanceCount === 1 ? '' : 's'}`}
                >
                  {pendingAcceptanceCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className={cn('mt-auto flex pt-1', collapsed ? 'justify-center' : '')}>
        <UserMenu compact={collapsed} placement="sidebar" />
      </div>
    </div>
  );
}
