'use client';

import { useEffect, useState } from 'react';
import { Layers, Wand2, Bell, Home } from 'lucide-react';
import Link from 'next/link';
import { SessionSearch } from '@/components/home/session-search';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

type ActivePage = 'home' | 'skills' | 'alerts';

interface NavBarProps {
  activePage: ActivePage;
  rightSlot?: React.ReactNode;
}

export function NavBar({ activePage, rightSlot }: NavBarProps) {
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    fetch('/api/v2/analytics/digest/unread')
      .then(r => r.json())
      .then(d => setUnreadAlerts(d.count ?? 0))
      .catch(() => {});
  }, []);

  const navItems = [
    { href: '/',        label: 'Home',   icon: Home,  page: 'home'   as ActivePage },
    { href: '/skills',  label: 'Skills', icon: Wand2, page: 'skills' as ActivePage },
    { href: '/alerts',  label: 'Alerts', icon: Bell,  page: 'alerts' as ActivePage },
  ];

  return (
    <header className="border-b border-border shrink-0 bg-background/95 backdrop-blur z-10">
      <div className="px-4 py-3 grid grid-cols-3 items-center gap-4">

        {/* Left: logo + nav tabs */}
        <div className="flex items-center gap-1 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition-opacity mr-1"
          >
            <Layers className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">AgentWatch</span>
          </Link>

          <div className="h-4 w-px bg-border mx-1.5 shrink-0" />

          <nav className="flex items-center gap-0.5">
            {navItems.map(({ href, label, icon: Icon, page }) => {
              const isActive = activePage === page;
              const isAlerts = page === 'alerts';
              return (
                <Link
                  key={page}
                  href={href}
                  className={cn(
                    'relative flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md transition-colors',
                    isActive
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                  {isAlerts && unreadAlerts > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Center: search */}
        <div className="flex justify-center">
          <div className="w-full max-w-sm">
            <SessionSearch />
          </div>
        </div>

        {/* Right: slot + theme toggle */}
        <div className="flex items-center justify-end gap-2">
          {rightSlot}
          <ThemeToggle />
        </div>

      </div>
    </header>
  );
}
