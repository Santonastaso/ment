import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Compass, User, Users, Shield, Menu, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/explorer', label: 'Explorer', icon: Compass },
  { to: '/profile', label: 'Profile', icon: User, match: (p) => p.startsWith('/profile') },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const isActive = (item) => (item.match ? item.match(location.pathname) : location.pathname === item.to);
  const initials = (user?.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  const links = [
    ...NAV,
    ...(user?.direct_reports > 0 ? [{ to: '/team', label: 'Team', icon: Users }] : []),
    ...(user?.is_admin ? [{ to: '/admin', label: 'Admin', icon: Shield }] : []),
  ];

  function NavLink({ item, onClick, mobile }) {
    const Icon = item.icon;
    const active = isActive(item);
    return (
      <Link
        to={item.to}
        onClick={onClick}
        className={cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          mobile
            ? active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
            : active
              ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]'
              : 'text-[var(--sidebar-foreground)]/75 hover:bg-[var(--sidebar-accent)]/70 hover:text-[var(--sidebar-foreground)]'
        )}
      >
        <Icon className="size-4 shrink-0 opacity-90" />
        {item.label}
      </Link>
    );
  }

  return (
    <header
      className="sticky top-0 z-40 border-b border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)] shadow-md shadow-black/20"
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-lg font-bold tracking-tight">
            MENT
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {links.map(item => <NavLink key={item.to} item={item} />)}
          </nav>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                variant="ghost"
                className="h-9 gap-2 px-2 text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              >
                <Avatar className="size-8 border border-[var(--sidebar-border)]">
                  <AvatarFallback className="bg-[var(--sidebar-primary)] text-[var(--sidebar-primary-foreground)] text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-[140px] truncate text-sm font-medium">{user?.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { logout(); navigate('/login'); }}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <nav className="mt-6 flex flex-col gap-1">
              {links.map(item => <NavLink key={item.to} item={item} mobile onClick={() => setOpen(false)} />)}
            </nav>
            <Button variant="outline" className="mt-8 w-full" onClick={() => { logout(); navigate('/login'); setOpen(false); }}>
              Sign out
            </Button>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
