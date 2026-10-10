import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CircleUserRound, House, MessagesSquare, PanelLeft, Search, Server, Share2, Shield, UsersRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { cn } from '@/lib/utils';
import UserMenu from './UserMenu.jsx';

export default function Sidebar({ collapsed = false, onNavigate, onToggle }) {
  const { user, pendingAcceptanceCount, unreadCounts } = useAuth();
  const { t } = useT();
  const location = useLocation();
  const navigate = useNavigate();

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
    <div className="flex h-full w-full flex-col px-2.5 pb-2.5 pt-4">
      <div className="relative mb-1.5 flex h-[var(--workspace-top-row)] shrink-0 items-center">
        <button type="button" onClick={onToggle} className="grid size-11 shrink-0 place-items-center rounded-full outline-none hover:bg-[var(--sidebar-accent)] focus-visible:ring-3 focus-visible:ring-[var(--sidebar-ring)]" aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'} title={collapsed ? 'Open sidebar' : 'Close sidebar'}>
          <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-white">M</span>
        </button>
        <Link to={user?.is_admin ? '/admin' : '/'} onClick={onNavigate} tabIndex={collapsed ? -1 : undefined} aria-hidden={collapsed} className={cn('sidebar-brand-label pl-1 text-section-large font-semibold tracking-[-0.025em] text-foreground', collapsed && 'is-hidden')}>
          MENT
        </Link>
        {onToggle && <button type="button" onClick={onToggle} tabIndex={collapsed ? -1 : undefined} aria-hidden={collapsed} className={cn('sidebar-end-toggle absolute right-1 grid size-10 place-items-center rounded-full text-muted-foreground outline-none hover:bg-[var(--sidebar-accent)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-[var(--sidebar-ring)]', collapsed && 'is-hidden')} aria-label="Close sidebar" title="Close sidebar">
          <PanelLeft className="size-5" strokeWidth={2.3} />
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
              onClick={event => {
                onNavigate?.();
                if (item.to === '/' && location.pathname === '/') {
                  event.preventDefault();
                  navigate('/', { state: { resetDiscovery: true } });
                }
              }}
              data-testid={item.testid}
              className={cn(
                'relative flex h-[var(--navigation-row-height)] items-center rounded-[var(--control-radius)] text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-[var(--sidebar-ring)]',
                'sidebar-nav-link gap-3 px-3',
                active
                  ? 'bg-[var(--sidebar-accent)] text-foreground'
                  : 'text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]'
              )}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="size-5 shrink-0" strokeWidth={2.05} />
              <span className={cn('sidebar-nav-label flex-1 whitespace-nowrap', collapsed && 'is-hidden')}>{item.label}</span>
              {badgeCount > 0 && (
                <span
                  data-testid="nav-messages-unread-badge"
                  className={cn('inline-flex items-center justify-center rounded-full bg-primary text-micro font-semibold text-primary-foreground', collapsed ? 'absolute right-1 top-1 size-4' : 'ml-auto h-5 min-w-[1.25rem] px-1.5')}
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
