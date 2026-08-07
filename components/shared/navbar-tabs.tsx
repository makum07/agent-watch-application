'use client';

import { useEffect, useState } from 'react';
import { Wand2, Bell, Home } from 'lucide-react';
import Link from 'next/link';
import { SessionSearch } from '@/components/home/session-search';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

type ActivePage = 'home' | 'skills' | 'alerts';

interface NavBarTabsProps {
  activePage: ActivePage;
  rightSlot?: React.ReactNode;
}

/**
 * The tabs/search/actions half of the top bar — rendered as the header of the main content
 * column, so it starts exactly where the sidebar ends instead of spanning the full page width.
 */
export function NavBarTabs({ activePage, rightSlot }: NavBarTabsProps) {
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    fetch('/api/v2/alerts?status=active&limit=1')
      .then(r => r.json())
      .then(d => setUnreadAlerts(d.activeCount ?? 0))
      .catch(() => {});
  }, []);

  const navItems = [
    { href: '/',        label: 'Home',   icon: Home,  page: 'home'   as ActivePage },
    { href: '/skills',  label: 'Skills', icon: Wand2, page: 'skills' as ActivePage },
    { href: '/alerts',  label: 'Alerts', icon: Bell,  page: 'alerts' as ActivePage },
  ];

  return (
    <div className="h-16 flex items-center gap-4 px-4 border-b border-sidebar-border shrink-0">
      <nav className="flex items-center gap-1 shrink-0">
        {navItems.map(({ href, label, icon: Icon, page }) => {
          const isActive = activePage === page;
          const isAlerts = page === 'alerts';
          return (
            <Link
              key={page}
              href={href}
              title={label}
              className={cn(
                'relative flex items-center gap-1.5 text-sm px-3 sm:px-4 py-2 rounded-md transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden md:inline">{label}</span>
              {isAlerts && unreadAlerts > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Search — flexes to fill remaining space, never overlaps neighbors */}
      <div className="flex-1 min-w-0 flex justify-center">
        <div className="w-full min-w-0 max-w-md">
          <SessionSearch />
        </div>
      </div>

      {/* Right: slot + theme toggle */}
      <div className="flex items-center justify-end gap-2 shrink-0">
        {rightSlot}
        <ThemeToggle />
      </div>
    </div>
  );
}
