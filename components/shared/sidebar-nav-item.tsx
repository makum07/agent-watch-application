'use client';

import { cn } from '@/lib/utils';

interface SidebarNavItemProps {
  active: boolean;
  collapsed?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  title?: string;
  /** CSS var() reference (e.g. from `projectColorVar`) tinting the active accent bar; defaults to the theme primary. */
  accentVar?: string;
}

/**
 * One row in a sidebar nav list (Pinned/Recent, a project, a skill). Shared between Home and
 * Skills so both sidebars stay visually identical instead of drifting — same icon slot size,
 * same active-state treatment (accent bar + tint), same spacing.
 */
export function SidebarNavItem({ active, collapsed, onClick, icon, label, trailing, title, accentVar }: SidebarNavItemProps) {
  return (
    <button
      onClick={onClick}
      title={title ?? (collapsed ? label : undefined)}
      className={cn(
        'group relative w-full flex items-center gap-2 rounded-md text-sm transition-colors',
        collapsed ? 'justify-center py-2' : 'py-2 pl-2.5 pr-2',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
      )}
    >
      {active && !collapsed && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full"
          style={{ backgroundColor: accentVar ? `var(${accentVar})` : 'var(--primary)' }}
        />
      )}
      <span className="flex h-4 w-4 items-center justify-center shrink-0">{icon}</span>
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {trailing != null && <span className="ml-auto text-xs opacity-60 shrink-0">{trailing}</span>}
        </>
      )}
    </button>
  );
}
