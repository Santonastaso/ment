import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Compass, User, Shield, Share2, Server, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { cn } from '@/lib/utils';

export default function Sidebar({ onNavigate }) {
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
        { to: '/', label: t('nav.home'), icon: LayoutDashboard },
        { to: '/explorer', label: t('nav.explorer'), icon: Compass },
        { to: '/groups', label: t('nav.groups'), icon: Users },
        { to: '/profile', label: t('nav.myProfile'), icon: User, match: (p, uid) => p === '/profile' || p === `/profile/${uid}` },
      ];

  return (
    <div className="flex h-full flex-col px-3 py-5">
      <Link to={user?.is_admin ? '/admin' : '/'} onClick={onNavigate} className="mb-8 flex h-10 items-center gap-2.5 rounded-xl px-2 hover:bg-[var(--sidebar-accent)]">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white shadow-[0_3px_8px_rgba(217,119,87,0.22)]">
          M
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">MENT</span>
      </Link>

      <nav className="flex flex-col gap-1">
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
                'flex h-9 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium transition-colors duration-150',
                active
                  ? 'bg-[var(--sidebar-accent)] text-foreground shadow-[inset_0_0_0_1px_rgba(217,119,87,0.08)]'
                  : 'text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground'
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.9} />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span
                  data-testid="home-pending-badge"
                  className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold"
                  aria-label={`${pendingAcceptanceCount} pending acceptance${pendingAcceptanceCount === 1 ? '' : 's'}`}
                >
                  {pendingAcceptanceCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
