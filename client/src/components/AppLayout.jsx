import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AppLayout() {
  const [mobileNav, setMobileNav] = useState(false);

  return (
    <div className="flex h-screen min-h-screen overflow-hidden bg-[var(--background)]">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] max-md:hidden">
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
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
        <main className="flex-1 overflow-auto px-6 py-8 lg:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
