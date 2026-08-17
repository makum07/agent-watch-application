'use client';

import Image from 'next/image';
import Link from 'next/link';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { spaceGrotesk } from '@/lib/fonts';
import logoImg from '../../public/agentwatch-logo.png';

interface NavBarBrandProps {
  /** Whether the sidebar this brand block sits above is currently collapsed to its icon rail. */
  collapsed?: boolean;
  /** Renders a collapse/expand toggle when the page has a resizable sidebar (Home, Skills). */
  sidebarToggle?: { onToggle: () => void };
}

/**
 * The logo/title block that sits directly above a page's sidebar, sized to its column so the
 * two read as one piece — as opposed to a full-width top bar with the sidebar living below and
 * disconnected from it. Pages without a sidebar (Alerts) render this at a fixed width instead so
 * the tab row still lines up with the ones that do.
 */
export function NavBarBrand({ collapsed, sidebarToggle }: NavBarBrandProps) {
  return (
    <div className={cn(
      'h-16 flex items-center border-b border-sidebar-border shrink-0',
      collapsed ? 'justify-center px-0' : 'justify-between px-4',
    )}>
      {!collapsed && (
        <Link href="/" className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity">
          <Image src={logoImg} alt="" className="h-11 w-auto shrink-0" />
          <span className={cn(spaceGrotesk.className, 'font-bold text-xl tracking-tight truncate')}>
            AgentWatch
          </span>
        </Link>
      )}
      {sidebarToggle && (
        <button
          onClick={sidebarToggle.onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="h-9 w-9 flex items-center justify-center rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors shrink-0"
        >
          {collapsed
            ? <PanelLeftOpen className="h-5 w-5" />
            : <PanelLeftClose className="h-5 w-5" />}
        </button>
      )}
    </div>
  );
}
