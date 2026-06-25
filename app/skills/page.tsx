import Link from 'next/link';
import { Layers, Wand2 } from 'lucide-react';
import { SkillList } from '@/components/skills/skill-list';

export const dynamic = 'force-dynamic';

export default function SkillsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Layers className="h-5 w-5 text-primary" />
            <span className="font-semibold text-lg">AgentWatch</span>
          </Link>
          <span className="text-[var(--aw-bg-3)]">/</span>
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-[var(--aw-text-0)]">Skills Intelligence</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[var(--aw-text-0)] mb-1">Skills Dashboard</h1>
          <p className="text-sm text-[var(--aw-text-2)]">
            Cross-session skill analytics, feedback aggregation, and self-healing intelligence
          </p>
        </div>
        <SkillList />
      </main>
    </div>
  );
}
