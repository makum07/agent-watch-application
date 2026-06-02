import { notFound } from 'next/navigation';
import { ingestSession } from '@/lib/services/session-ingester';
import { formatTokens, formatDuration, formatCost } from '@/lib/utils';
import { Layers, Users, Zap, Clock, DollarSign } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = ingestSession(id);

  if (!session) notFound();

  const modelBreakdown = Object.entries(session.estimatedCost.byModel).sort((a, b) => b[1] - a[1]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <a href="/" className="text-muted-foreground hover:text-foreground"><Layers className="h-4 w-4" /></a>
          <span className="text-muted-foreground">/</span>
          <a href={`/session/${id}`} className="text-muted-foreground hover:text-foreground text-sm">Session</a>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">Analytics</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold mb-6">Session Analytics</h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Users className="h-4 w-4 text-blue-400" />} label="Agents" value={String(session.totalAgents)} />
          <StatCard icon={<Zap className="h-4 w-4 text-yellow-400" />} label="Tokens" value={formatTokens(session.totalTokens)} />
          <StatCard icon={<Clock className="h-4 w-4 text-green-400" />} label="Duration" value={formatDuration(session.duration.wallClock)} />
          <StatCard icon={<DollarSign className="h-4 w-4 text-purple-400" />} label="Est. Cost" value={formatCost(session.estimatedCost.total)} />
        </div>

        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Cost by Model</h2>
          <div className="space-y-2">
            {modelBreakdown.map(([model, cost]) => (
              <div key={model} className="flex items-center gap-3">
                <span className="text-sm font-mono w-48 truncate text-muted-foreground">{model}</span>
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full"
                    style={{ width: `${(cost / session.estimatedCost.total) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-mono text-right w-20">{formatCost(cost)}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Top Agents by Tokens</h2>
          <div className="space-y-2">
            {session.agents
              .sort((a, b) => b.tokenUsage.total - a.tokenUsage.total)
              .slice(0, 10)
              .map(agent => (
                <div key={agent.id} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-24 truncate">{agent.subagentType || 'Main'}</span>
                  <span className="text-xs truncate flex-1 text-muted-foreground/70">
                    {agent.description?.slice(0, 50) || agent.conversationId.slice(0, 16)}
                  </span>
                  <span className="text-xs font-mono">{formatTokens(agent.tokenUsage.total)}</span>
                </div>
              ))
            }
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
