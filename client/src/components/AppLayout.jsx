import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import { cn } from '@/lib/utils';

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const location = useLocation();
  const isDiscovery = location.pathname === '/';
  const isConversation = location.pathname === '/conversations' || location.pathname.startsWith('/c/') || location.pathname.startsWith('/g/');
  const isDirectory = location.pathname === '/explorer';
  const closeNarrowSidebar = () => {
    if (window.matchMedia('(max-width: 700px)').matches) setSidebarCollapsed(true);
  };

  return (
    <div className="flex h-screen min-h-screen overflow-hidden bg-[var(--background)]">
      <aside className={cn(
        'app-sidebar flex h-full shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] max-[700px]:fixed max-[700px]:inset-y-0 max-[700px]:left-0 max-[700px]:z-50',
        sidebarCollapsed
          ? 'is-collapsed'
          : 'max-[700px]:shadow-[var(--shadow-overlay)]'
      )}>
        <Sidebar collapsed={sidebarCollapsed} onNavigate={closeNarrowSidebar} onToggle={() => setSidebarCollapsed(value => !value)} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col max-[700px]:ml-[68px]">
        <main className={cn('min-h-0 flex-1 bg-[var(--background)] px-5 sm:px-8',
          isConversation ? 'overflow-hidden px-0 py-0 sm:px-0' : isDiscovery ? 'overflow-auto px-0 py-0 sm:px-0' : isDirectory ? 'overflow-auto pb-6 pt-0' : 'overflow-auto pb-6 pt-4')}>
          <div className={cn('mx-auto w-full max-w-[900px]', (isDiscovery || isConversation) && 'max-w-none')}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
