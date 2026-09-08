import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '../context/AuthContext.jsx';

export default function AppLayout() {
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const isDiscovery = location.pathname === '/' && !user?.is_admin;

  return (
    <div className={cn('flex h-screen min-h-screen overflow-hidden bg-[var(--background)]', isDiscovery && 'discovery-app-shell')}>
      {!isDiscovery && <aside className="flex h-full w-[224px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] max-md:hidden">
        <Sidebar />
      </aside>}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          discovery={isDiscovery}
          mobileMenu={
            <Sheet open={mobileNav} onOpenChange={setMobileNav}>
              <SheetTrigger
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-lg md:hidden',
                  'text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50'
                )}
                aria-label="Open navigation"
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="left" className="w-60 p-0">
                <Sidebar onNavigate={() => setMobileNav(false)} />
              </SheetContent>
            </Sheet>
          }
        />
        <main className={cn('flex-1 overflow-auto bg-[var(--background)] px-4 py-6 sm:px-8', isDiscovery && 'px-0 py-0 sm:px-0')}>
          <div className={cn('mx-auto w-full max-w-[1180px]', isDiscovery && 'max-w-none')}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
