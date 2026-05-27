import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Compass, User, Users, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/explorer', label: 'Explorer', icon: Compass },
  { to: '/profile', label: 'My profile', icon: User, match: (p, uid) => p === '/profile' || p === `/profile/${uid}` },
];

export default function Sidebar({ onNavigate }) {
  const { user, pendingAcceptanceCount } = useAuth();
  const location = useLocation();

  const links = [
    ...NAV,
    ...(user?.direct_reports > 0 ? [{ to: '/team', label: 'Team insights', icon: Users }] : []),
    ...(user?.is_admin ? [{ to: '/admin', label: 'Admin', icon: Shield }] : []),
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
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className={cn('size-[18px] shrink-0', active && 'text-primary')} strokeWidth={1.75} />
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
