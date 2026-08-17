'use client';

import { NavBarBrand } from './navbar-brand';
import { NavBarTabs } from './navbar-tabs';

type ActivePage = 'home' | 'skills' | 'alerts';

interface NavBarProps {
  activePage: ActivePage;
  rightSlot?: React.ReactNode;
}

/**
 * Full-width top bar for pages with no sidebar of their own (Alerts). The brand block is
 * pinned to the same width as the default sidebar on Home/Skills so the tab row still starts
 * at the same X position across every page, even though there's no actual resizable panel here.
 * Pages that do have a sidebar render `NavBarBrand`/`NavBarTabs` split across their own panels
 * instead of this — see home-client.tsx / skills-client.tsx.
 */
export function NavBar({ activePage, rightSlot }: NavBarProps) {
  return (
    <header className="flex bg-sidebar/95 backdrop-blur z-10 text-sidebar-foreground shrink-0">
      <div className="w-[260px] shrink-0">
        <NavBarBrand />
      </div>
      <div className="flex-1 min-w-0">
        <NavBarTabs activePage={activePage} rightSlot={rightSlot} />
      </div>
    </header>
  );
}
