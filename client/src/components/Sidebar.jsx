import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CircleUserRound, House, MessagesSquare, PanelLeft, Search, Server, Share2, Shield, UsersRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { cn } from '@/lib/utils';
import UserMenu from './UserMenu.jsx';

export default function Sidebar({ collapsed = false, onNavigate, onToggle }) {
  const { user, pendingAcceptanceCount, unreadCounts } = useAuth();
  const { t } = useT();
  const location = useLocation();

  const links = user?.is_admin
    ? [
        { to: '/admin/graph', label: t('nav.knowledgeGraph'), icon: Share2, testid: 'nav-knowledge-graph' },
        { to: '/admin', label: t('nav.admin'), icon: Shield },
        ...(user?.admin_scope === 'platform' ? [{ to: '/admin/ops', label: t('nav.platformOps'), icon: Server, testid: 'nav-platform-ops' }] : []),
      ]
    : [
        { to: '/', label: t('nav.home'), icon: House },
        { to: '/explorer', label: t('nav.explorer'), icon: Search },
        { to: '/conversations', label: t('nav.messages'), icon: MessagesSquare },
        { to: '/groups', label: t('nav.groups'), icon: UsersRound },
        { to: '/profile', label: t('nav.myProfile'), icon: CircleUserRound, match: (p, uid) => p === '/profile' || p === `/profile/${uid}` },
      ];

  return (
    <div className={cn('flex h-full flex-col py-2.5', collapsed ? 'px-2' : 'px-2.5')}>
      <div className="app-sidebar-header mb-6 flex h-11 items-center justify-between">
        <Link to={user?.is_admin ? '/admin' : '/'} onClick={onNavigate} className="app-sidebar-brand flex h-11 items-center gap-2.5 overflow-hidden px-2" tabIndex={collapsed ? -1 : undefined} aria-hidden={collapsed}>
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">M</span>
          <span className="app-sidebar-brand-name text-[17px] font-semibold tracking-[-0.025em] text-foreground">MENT</span>
        </Link>
        {onToggle && <button type="button" onClick={onToggle} className="app-sidebar-toggle group grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-[var(--sidebar-accent)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-[var(--sidebar-ring)]" aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'} title={collapsed ? 'Open sidebar' : 'Close sidebar'}>
          <span className="app-sidebar-toggle-mark grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-white">M</span>
          <PanelLeft className="app-sidebar-toggle-icon size-[22px]" strokeWidth={2.3} />
        </button>}
      </div>

      <nav className="flex flex-col gap-0.5">
        {links.map(item => {
          const active = item.match
            ? item.match(location.pathname, user?.id)
            : location.pathname === item.to;
          const Icon = item.icon;
          const badgeCount = item.to === '/conversations'
            ? Math.max(pendingAcceptanceCount, unreadCounts.sessions + unreadCounts.groups)
            : 0;
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
              <span className="app-sidebar-label flex-1" aria-hidden={collapsed}>{item.label}</span>
              {badgeCount > 0 && (
                <span
                  data-testid="nav-messages-unread-badge"
                  className={cn('inline-flex items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground', collapsed ? 'absolute right-1 top-1 size-4' : 'ml-auto h-5 min-w-[1.25rem] px-1.5')}
                  aria-label={t('nav.unreadConversations', { count: badgeCount })}
                >
                  {badgeCount > 99 ? '99+' : badgeCount}
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
