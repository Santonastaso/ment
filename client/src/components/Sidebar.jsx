import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Compass, User, Shield, Share2, Server } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/index.jsx';
import { cn } from '@/lib/utils';

export default function Sidebar({ onNavigate }) {
  const { user, pendingAcceptanceCount } = useAuth();
  const { t } = useT();
  const location = useLocation();

  const links = [
    { to: '/', label: t('nav.home'), icon: LayoutDashboard },
    { to: '/explorer', label: t('nav.explorer'), icon: Compass },
    { to: '/profile', label: t('nav.myProfile'), icon: User, match: (p, uid) => p === '/profile' || p === `/profile/${uid}` },
    ...(user?.is_admin ? [{ to: '/admin/graph', label: t('nav.knowledgeGraph'), icon: Share2, testid: 'nav-knowledge-graph' }] : []),
    ...(user?.is_admin ? [{ to: '/admin', label: t('nav.admin'), icon: Shield }] : []),
    ...(user?.is_admin && user?.admin_scope === 'platform' ? [{ to: '/admin/ops', label: t('nav.platformOps'), icon: Server, testid: 'nav-platform-ops' }] : []),
  ];

  return (
    <div className="flex h-full flex-col px-3 py-5">
      <Link to="/" onClick={onNavigate} className="mb-8 flex items-center gap-2 px-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          M
        </span>
        <span className="text-lg font-semibold tracking-tight text-foreground">MENT</span>
      </Link>

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
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
                active
                  ? 'bg-[var(--muted)] text-foreground'
                  : 'text-muted-foreground hover:bg-[var(--muted)]/60 hover:text-foreground'
              )}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
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
