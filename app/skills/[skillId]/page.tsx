'use client';

import { useEffect } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { Layers, Sparkles, Zap, MessageSquare, Clock, ArrowLeft, FolderOpen } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useSkillStore } from '@/store/skill-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { SelfHealingConfig } from '@/components/skills/self-healing-config';
import { ExecutionHistory } from '@/components/skills/execution-history';
import { FeedbackAnalytics } from '@/components/skills/feedback-analytics';
import { AnalysisHistory } from '@/components/skills/analysis-history';
import { formatDuration } from '@/lib/utils';
import type { SessionEvent } from '@/types/events';

export default function SkillDetailPage({ params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = use(params);
  const {
    selectedSkill,
    analysisCycles,
    isLoading,
    loadSkillDetail,
    loadAnalysisCycles,
    handleStreamEvent,
  } = useSkillStore();

  useEffect(() => {
    loadSkillDetail(skillId);
    loadAnalysisCycles(skillId);
  }, [skillId, loadSkillDetail, loadAnalysisCycles]);

  useWebSocket((event: SessionEvent) => {
    if (
      event.type === 'skill_analysis_started' ||
      event.type === 'skill_analysis_stream_event' ||
      event.type === 'skill_analysis_complete' ||
      event.type === 'skill_analysis_failed'
    ) {
      handleStreamEvent(event);
    }
  });

  if (isLoading || !selectedSkill) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-[#58a6ff] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const skill = selectedSkill.skill;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Layers className="h-5 w-5 text-primary" />
            <span className="font-semibold text-lg">AgentWatch</span>
          </Link>
          <span className="text-[#30363d]">/</span>
          <Link href="/skills" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Sparkles className="h-4 w-4 text-[#d2a8ff]" />
            <span className="text-sm text-[#8b949e] hover:text-[#e6edf3]">Skills</span>
          </Link>
          <span className="text-[#30363d]">/</span>
          <span className="text-sm font-medium text-[#e6edf3] font-mono">/{skill.name}</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <Link
          href="/skills"
          className="inline-flex items-center gap-1 text-xs text-[#8b949e] hover:text-[#e6edf3] mb-4"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Skills
        </Link>

        {/* Skill header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold text-[#e6edf3] font-mono">/{skill.name}</h1>
            <span className="text-xs bg-[#21262d] px-2 py-0.5 rounded text-[#8b949e]">v{skill.version}</span>
          </div>
          <div className="text-sm text-[#8b949e] font-mono">{skill.project}</div>
          {skill.description && (
            <p className="text-sm text-[#c9d1d9] mt-2">{skill.description}</p>
          )}
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
          <StatCard icon={<Zap className="h-4 w-4" />} label="Executions" value={String(skill.totalExecutions)} />
          <StatCard icon={<FolderOpen className="h-4 w-4" />} label="Sessions" value={String(skill.totalSessions)} />
          <StatCard icon={<MessageSquare className="h-4 w-4" />} label="Feedback" value={String(skill.totalFeedback)} />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Avg Duration" value={skill.avgDurationMs > 0 ? formatDuration(skill.avgDurationMs) : '—'} />
          <StatCard
            icon={<Sparkles className="h-4 w-4" />}
            label="Analysis Cycles"
            value={String(analysisCycles.length)}
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <TabsList className="bg-[#161b22] border border-[#30363d]">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="executions" className="text-xs">Executions</TabsTrigger>
            <TabsTrigger value="feedback" className="text-xs">Feedback</TabsTrigger>
            <TabsTrigger value="analysis" className="text-xs">Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
              <SelfHealingConfig
                skillId={skillId}
                enabled={skill.selfHealingEnabled}
                mode={skill.selfHealingMode}
                threshold={skill.selfHealingThreshold}
              />
              <div className="space-y-4">
                <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
                  <h3 className="text-xs font-medium text-[#8b949e] mb-3 uppercase tracking-wide">
                    Skill Metadata
                  </h3>
                  <dl className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-[#8b949e]">Name</dt>
                      <dd className="text-[#e6edf3] font-mono">{skill.name}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#8b949e]">Project</dt>
                      <dd className="text-[#e6edf3] font-mono">{skill.project}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#8b949e]">Version</dt>
                      <dd className="text-[#e6edf3]">{skill.version}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#8b949e]">Created</dt>
                      <dd className="text-[#e6edf3]">{new Date(skill.createdAt).toLocaleDateString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#8b949e]">Last Execution</dt>
                      <dd className="text-[#e6edf3]">
                        {skill.lastExecutionAt
                          ? new Date(skill.lastExecutionAt).toLocaleDateString()
                          : 'Never'
                        }
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#8b949e]">Last Analysis</dt>
                      <dd className="text-[#e6edf3]">
                        {skill.lastAnalysisAt
                          ? new Date(skill.lastAnalysisAt).toLocaleDateString()
                          : 'Never'
                        }
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Quick feedback summary */}
                {selectedSkill.feedbackByCategory.length > 0 && (
                  <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
                    <h3 className="text-xs font-medium text-[#8b949e] mb-3 uppercase tracking-wide">
                      Top Feedback Categories
                    </h3>
                    <div className="space-y-1.5">
                      {selectedSkill.feedbackByCategory.slice(0, 5).map(fb => (
                        <div key={fb.category} className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: fb.color }} />
                          <span className="text-xs text-[#c9d1d9] flex-1">{fb.label}</span>
                          <span className="text-xs text-[#e6edf3] font-mono">{fb.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="executions">
            <div className="mt-4">
              <ExecutionHistory skillId={skillId} />
            </div>
          </TabsContent>

          <TabsContent value="feedback">
            <div className="mt-4">
              <FeedbackAnalytics
                feedbackItems={selectedSkill.feedbackItems}
                feedbackByCategory={selectedSkill.feedbackByCategory}
                feedbackByAgent={selectedSkill.feedbackByAgent}
                totalFeedback={skill.totalFeedback}
                analysisCycles={analysisCycles}
                improvementCycles={selectedSkill.improvementCycles ?? []}
              />
            </div>
          </TabsContent>

          <TabsContent value="analysis">
            <div className="mt-4">
              <AnalysisHistory skillId={skillId} cycles={analysisCycles} />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 text-center">
      <div className="flex justify-center text-[#8b949e] mb-1.5">{icon}</div>
      <div className="text-lg font-semibold text-[#e6edf3]">{value}</div>
      <div className="text-[11px] text-[#8b949e]">{label}</div>
    </div>
  );
}
