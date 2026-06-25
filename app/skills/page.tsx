import Link from 'next/link';
import { Layers, Wand2 } from 'lucide-react';
import { SkillList } from '@/components/skills/skill-list';
import { ThemeToggle } from '@/components/theme-toggle';
import { SessionSearch } from '@/components/home/session-search';

export const dynamic = 'force-dynamic';

export default function SkillsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="px-6 py-3 grid grid-cols-3 items-center gap-4">
          {/* Left: breadcrumb */}
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0">
              <Layers className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">AgentWatch</span>
            </Link>
            <span className="text-border shrink-0">/</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <Wand2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Skills</span>
            </div>
          </div>

          {/* Center: search */}
          <div className="flex justify-center">
            <div className="w-full max-w-sm">
              <SessionSearch />
            </div>
          </div>

          {/* Right: theme toggle */}
          <div className="flex items-center justify-end">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold mb-1">Skills Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Cross-session skill analytics, feedback aggregation, and self-healing intelligence
          </p>
        </div>
        <SkillList />
      </main>
    </div>
  );
}
