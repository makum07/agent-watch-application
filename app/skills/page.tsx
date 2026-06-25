import Link from 'next/link';
import { Layers, Sparkles } from 'lucide-react';
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
          <span className="text-[#30363d]">/</span>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#d2a8ff]" />
            <span className="text-sm font-medium text-[#e6edf3]">Skills Intelligence</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[#e6edf3] mb-1">Skills Dashboard</h1>
          <p className="text-sm text-[#8b949e]">
            Cross-session skill analytics, feedback aggregation, and self-healing intelligence
          </p>
        </div>
        <SkillList />
      </main>
    </div>
  );
}
