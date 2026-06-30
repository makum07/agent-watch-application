'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/hooks/use-session';
import { useWorkspaceStore } from '@/store/workspace-store';
import { useWorkspacePersistence } from '@/hooks/use-workspace-persistence';
import { useFeedbackStore } from '@/store/feedback-store';
import { AgentSidebar } from '@/components/session/agent-sidebar';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { FeedbackPanel } from '@/components/session/feedback-panel';
import { Loader2, Layers, Clock, LayoutDashboard, Columns2, Rows2, Grid2x2, Square, MessageSquare, Save, ChevronDown, Trash2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import type { LayoutNode, WorkspaceSnapshot } from '@/types/workspace';
import type { Session } from '@/types/session';
import { cn } from '@/lib/utils';

// Below this content-area width, the Review panel floats over the workspace
// instead of pushing it — otherwise three columns get unusably cramped.
const REVIEW_OVERLAY_BELOW = 900;

interface Props {
  params: Promise<{ id: string }>;
}

export default function WorkspacePage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const openTab = searchParams.get('open');
  const { session, isLoading, error, reload } = useSession(id);
  const { setSessionId, setLayout, setSidebarCollapsed, incrementRefreshToken } = useWorkspaceStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const sidebarPanelRef = usePanelRef();
  const sidebarCollapsedRef = useRef(false);
  const { restoreSnapshot } = useWorkspacePersistence(id);
  const [initialized, setInitialized] = useState(false);
  const [showResumeChoice, setShowResumeChoice] = useState(false);
  const { isPanelOpen, setPanelOpen, items, loadFeedback, reset: resetFeedback } = useFeedbackStore();

  // Feedback panel resize state
  const [feedbackWidth, setFeedbackWidth] = useState(288);
  const feedbackWidthRef = useRef(288);   // kept in sync for use inside event listeners
  const resizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWRef = useRef(288);

  // Track the content area's width so the Review panel can float (overlay) when narrow
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContentWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Restore persisted width on mount
  useEffect(() => {
    const stored = localStorage.getItem('feedback-panel-width');
    if (stored) {
      const w = Math.min(900, Math.max(200, Number(stored)));
      setFeedbackWidth(w);
      feedbackWidthRef.current = w;
    }
  }, []);

  // Keep ref in sync with state so the mouseup handler can persist the final value
  useEffect(() => { feedbackWidthRef.current = feedbackWidth; }, [feedbackWidth]);

  // Global mouse tracking for drag resize
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizingRef.current) return;
      const dx = resizeStartXRef.current - e.clientX;
      const w = Math.min(900, Math.max(200, resizeStartWRef.current + dx));
      setFeedbackWidth(w);
      feedbackWidthRef.current = w;
    }
    function onUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      localStorage.setItem('feedback-panel-width', String(feedbackWidthRef.current));
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  function startFeedbackResize(e: React.MouseEvent) {
    resizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWRef.current = feedbackWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  useEffect(() => {
    setSessionId(id);
    setLayout(null);
    resetFeedback();
    loadFeedback(id);
  }, [id]);

  useEffect(() => {
    if (!session || initialized) return;

    restoreSnapshot().then(snapshot => {
      setInitialized(true);
      const rootAgent = session.agents?.find(a => a.parentId === null) ?? session.agents?.[0];

      // If ?open=timeline|analytics, skip resume dialog and open that tab directly
      if (openTab && (openTab === 'timeline' || openTab === 'analytics')) {
        const tabLabels: Record<string, string> = { timeline: 'Timeline', analytics: 'Analytics' };
        setLayout({
          type: 'pane',
          id: 'main',
          tabs: [{ type: openTab as 'timeline' | 'analytics', label: tabLabels[openTab] }],
          activeTab: 0,
        });
        return;
      }

      if (snapshot?.layout) {
        // Restored saved workspace — show resume choice if there's a meaningful layout
        setShowResumeChoice(true);
        // But also set the restored layout so it's ready
        setLayout(snapshot.layout);
        // Sync the actual resizable panel to the restored collapse state (after
        // it mounts) so the store + panel never disagree. Default to expanded.
        requestAnimationFrame(() => {
          const panel = sidebarPanelRef.current;
          if (!panel) return;
          if (snapshot.sidebarCollapsed) panel.collapse();
          else panel.expand();
        });
      } else if (rootAgent) {
        // No saved layout — open with root agent
        setLayout({
          type: 'pane',
          id: 'main',
          tabs: [{
            type: 'agent',
            agentId: rootAgent.id,
            label: rootAgent.description?.slice(0, 30) || rootAgent.subagentType || 'Orchestrator',
          }],
          activeTab: 0,
        });
      }
    });
  }, [session?.id]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Loading session…</span>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{error || 'Session not found'}</p>
          <Link href="/" className="text-xs text-primary mt-2 block hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const projectName = session.project.split(/[/\\]/).filter(Boolean).pop() || 'Session';

  return (
    <div className="relative h-screen bg-background overflow-hidden">
      {/* Inline resume choice overlay — simple, no external dialog dependency */}
      {showResumeChoice && (
        <div className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-base font-semibold mb-1">Resume Session</h2>
            <p className="text-xs text-muted-foreground mb-4">
              {projectName} — {session.totalAgents} agent{session.totalAgents !== 1 ? 's' : ''}
            </p>
            <div className="space-y-2">
              <button
                onClick={() => setShowResumeChoice(false)}
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/30 hover:bg-primary/20 text-left transition-colors"
              >
                <Layers className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <div className="text-sm font-medium">Resume Last Workspace</div>
                  <div className="text-xs text-muted-foreground">Continue where you left off</div>
                </div>
              </button>
              <button
                onClick={() => { setShowResumeChoice(false); router.push(`/session/${id}/timeline`); }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent text-left transition-colors"
              >
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-sm font-medium">Timeline View</div>
                  <div className="text-xs text-muted-foreground">Visualize agent execution</div>
                </div>
              </button>
              <button
                onClick={() => { setShowResumeChoice(false); router.push(`/session/${id}/analytics`); }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent text-left transition-colors"
              >
                <LayoutDashboard className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-sm font-medium">Analytics</div>
                  <div className="text-xs text-muted-foreground">Tokens, cost, and metrics</div>
                </div>
              </button>
              <button
                onClick={() => {
                  const rootAgent = session.agents?.find(a => a.parentId === null) ?? session.agents?.[0];
                  if (rootAgent) {
                    setLayout({
                      type: 'pane',
                      id: 'main-fresh',
                      tabs: [{ type: 'agent', agentId: rootAgent.id, label: rootAgent.subagentType || 'Orchestrator' }],
                      activeTab: 0,
                    });
                  }
                  setShowResumeChoice(false);
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground text-left px-3 py-2 transition-colors"
              >
                Start fresh
              </button>
            </div>
          </div>
        </div>
      )}

      <Group orientation="horizontal" className="h-full" style={{ display: 'flex', height: '100%' }}>
        {/* Sidebar panel — resizable, collapsible to 40px icon strip */}
        <Panel
          id="sidebar-panel"
          panelRef={sidebarPanelRef}
          defaultSize={256}
          minSize={160}
          maxSize={600}
          collapsible
          collapsedSize={40}
          onResize={(size) => {
            const collapsed = size.inPixels <= 44;
            if (collapsed !== sidebarCollapsedRef.current) {
              sidebarCollapsedRef.current = collapsed;
              setSidebarCollapsed(collapsed);
            }
          }}
        >
          <AgentSidebar sessionId={id} panelRef={sidebarPanelRef} />
        </Panel>

        <Separator className="shrink-0 bg-[var(--aw-bg-3)] hover:bg-[var(--aw-blue)]/50 cursor-col-resize transition-colors data-[orientation=horizontal]:w-1" />

        {/* Main content panel */}
        <Panel id="main-panel" minSize={300}>
          <div className="flex flex-col h-full overflow-hidden">
            {/* Workspace header — never wraps; breadcrumb truncates first, controls stay on one line */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-1)] shrink-0 overflow-x-auto overflow-y-hidden">
              {/* Breadcrumb cluster — shrinks/truncates before the controls do */}
              <div className="flex items-center gap-2 min-w-0 shrink">
                <Link href="/" className="text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] transition-colors shrink-0">
                  <Layers className="h-4 w-4" />
                </Link>
                <span className="text-[var(--aw-text-4)] shrink-0">/</span>
                <span className="text-sm font-semibold text-[var(--aw-text-0)] truncate">{projectName}</span>
                <div className="flex items-center gap-1 ml-1 text-[11px] text-[var(--aw-text-3)] shrink-0 hidden lg:flex whitespace-nowrap">
                  <span>{session.totalAgents} agent{session.totalAgents !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span className="font-mono">{id.slice(0, 8)}…</span>
                </div>
              </div>
              <div className="flex-1 min-w-2" />
              {/* Controls cluster — fixed, never compresses */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={async () => {
                    setIsRefreshing(true);
                    reload();
                    incrementRefreshToken();
                    setTimeout(() => setIsRefreshing(false), 800);
                  }}
                  title="Refresh session data"
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--aw-text-1)] hover:text-white hover:bg-[var(--aw-bg-3)] transition-colors shrink-0"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
                </button>
                <LayoutMenu session={session} setLayout={setLayout} sessionId={id} />
                <div className="flex items-center gap-1 border-l border-[var(--aw-bg-3)] pl-2">
                  <button
                    onClick={() => setPanelOpen(!isPanelOpen)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors whitespace-nowrap ${
                      isPanelOpen
                        ? 'bg-[var(--aw-blue)]/15 text-[var(--aw-blue)] border border-[var(--aw-blue)]/30'
                        : 'text-[var(--aw-text-1)] hover:text-white hover:bg-[var(--aw-bg-2)]'
                    }`}
                    title="Feedback Review"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span>Review</span>
                    {items.length > 0 && (
                      <span className={`text-[10px] px-1 rounded-full font-medium ${isPanelOpen ? 'bg-[var(--aw-blue)]/30 text-[var(--aw-blue)]' : 'bg-[var(--aw-bg-2)] text-[var(--aw-text-2)]'}`}>
                        {items.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
            <div ref={contentRef} className="flex-1 overflow-hidden relative flex">
              <div className="flex-1 overflow-hidden min-w-0">
                <WorkspaceShell sessionId={id} />
              </div>
              {isPanelOpen && (() => {
                const overlay = contentWidth > 0 && contentWidth < REVIEW_OVERLAY_BELOW;
                const panelW = overlay
                  ? Math.min(feedbackWidth, Math.max(260, contentWidth - 48))
                  : feedbackWidth;
                return (
                  <div
                    className={cn(
                      'flex overflow-hidden',
                      overlay
                        ? 'absolute top-0 right-0 bottom-0 z-30 shadow-2xl shadow-black/60'
                        : 'shrink-0'
                    )}
                    style={{ width: panelW }}
                  >
                    {/* Drag handle */}
                    <div
                      onMouseDown={startFeedbackResize}
                      className="w-1 shrink-0 bg-[var(--aw-bg-3)] hover:bg-[var(--aw-blue)]/50 cursor-col-resize transition-colors"
                    />
                    <div className="flex-1 overflow-hidden bg-[var(--aw-bg-0)] border-l border-[var(--aw-bg-2)]">
                      <FeedbackPanel sessionId={id} onClose={() => setPanelOpen(false)} />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  );
}

// Combined layout menu — presets + save + saved layouts in one dropdown
function LayoutMenu({ session, setLayout, sessionId }: {
  session: Session;
  setLayout: (l: LayoutNode | null) => void;
  sessionId: string;
}) {
  const { layout, paneStates, sidebarCollapsed, sidebarWidth, globalSearchQuery, activeFilters } = useWorkspaceStore();
  const [isOpen, setIsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([]);
  const [saveName, setSaveName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    fetch(`/api/v2/workspaces/${sessionId}`)
      .then(r => r.json())
      .then(d => setSnapshots(d.snapshots ?? []))
      .catch(() => {});
  }, [sessionId]);

  const agents = session.agents.slice(0, 4);
  const makeTab = (a: (typeof agents)[0]) => ({
    type: 'agent' as const,
    agentId: a.id,
    label: a.subagentType || (a.depth === 0 ? 'Main' : 'Agent'),
  });

  const presets = [
    { id: 'single', icon: <Square className="h-3.5 w-3.5" />, label: 'Single',
      layout: (): LayoutNode => ({ type: 'pane', id: 'p1', tabs: agents[0] ? [makeTab(agents[0])] : [], activeTab: 0 }) },
    { id: '2col', icon: <Columns2 className="h-3.5 w-3.5" />, label: '2 Columns',
      layout: (): LayoutNode | null => agents.length < 2 ? null : ({ type: 'split', id: 's1', direction: 'horizontal', ratio: 0.5, children: [{ type: 'pane', id: 'p1', tabs: [makeTab(agents[0])], activeTab: 0 }, { type: 'pane', id: 'p2', tabs: [makeTab(agents[1])], activeTab: 0 }] }) },
    { id: '3col', icon: <Grid2x2 className="h-3.5 w-3.5" />, label: '3 Columns',
      layout: (): LayoutNode | null => agents.length < 3 ? null : ({ type: 'split', id: 's1', direction: 'horizontal', ratio: 0.33, children: [{ type: 'pane', id: 'p1', tabs: [makeTab(agents[0])], activeTab: 0 }, { type: 'split', id: 's2', direction: 'horizontal', ratio: 0.5, children: [{ type: 'pane', id: 'p2', tabs: [makeTab(agents[1])], activeTab: 0 }, { type: 'pane', id: 'p3', tabs: [makeTab(agents[2])], activeTab: 0 }] }] }) },
    { id: 'orch', icon: <Rows2 className="h-3.5 w-3.5" />, label: 'Orchestrator+',
      layout: (): LayoutNode | null => agents.length < 2 ? null : ({ type: 'split', id: 's1', direction: 'horizontal', ratio: 0.4, children: [{ type: 'pane', id: 'p1', tabs: [makeTab(agents[0])], activeTab: 0 }, { type: 'split', id: 's2', direction: 'vertical', ratio: 0.5, children: [{ type: 'pane', id: 'p2', tabs: agents.slice(1).map(makeTab), activeTab: 0 }, { type: 'pane', id: 'p3', tabs: [], activeTab: 0 }] }] }) },
  ];

  const named = snapshots.filter(s => !s.isAutoSave);

  const saveLayout = async () => {
    if (!layout || !saveName.trim()) return;
    setIsSaving(true);
    const snapshot: WorkspaceSnapshot = { id: crypto.randomUUID(), sessionId, savedAt: new Date().toISOString(), isAutoSave: false, name: saveName.trim(), layout, paneStates, sidebarCollapsed, sidebarWidth, globalSearchQuery: globalSearchQuery || null, activeFilters };
    try {
      const res = await fetch(`/api/v2/workspaces/${sessionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) });
      const saved = await res.json();
      setSnapshots(prev => [saved, ...prev]);
      setSaveName('');
    } finally { setIsSaving(false); }
  };

  const deleteSnapshot = async (id: string) => {
    setSnapshots(prev => prev.filter(s => s.id !== id));
    await fetch(`/api/v2/workspaces/${sessionId}/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const open = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setIsOpen(true);
  };

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        onClick={isOpen ? () => setIsOpen(false) : open}
        className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] text-[var(--aw-text-1)] hover:text-white hover:bg-[var(--aw-bg-3)] transition-colors"
      >
        <LayoutDashboard className="h-3.5 w-3.5" />
        <span>Layout</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setIsOpen(false)} />
          <div className="fixed z-[100] bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] rounded-md shadow-xl w-52 py-1" style={{ top: pos.top, right: pos.right }}>
            <div className="px-3 py-1.5 text-[10px] text-[var(--aw-text-3)] font-medium uppercase tracking-wide">Presets</div>
            {presets.map(p => {
              const l = p.layout();
              return (
                <button key={p.id} onClick={() => { if (l) { setLayout(l); setIsOpen(false); } }} disabled={!l}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--aw-text-1)] hover:bg-[var(--aw-bg-2)] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-left">
                  {p.icon} {p.label}
                </button>
              );
            })}

            {named.length > 0 && (
              <>
                <div className="h-px bg-[var(--aw-bg-3)] my-1" />
                <div className="px-3 py-1.5 text-[10px] text-[var(--aw-text-3)] font-medium uppercase tracking-wide">Saved</div>
                {named.map(s => (
                  <div key={s.id} className="flex items-center gap-1 px-2 py-1 hover:bg-[var(--aw-bg-2)] group">
                    <button onClick={() => { setLayout(s.layout); setIsOpen(false); }} className="flex-1 text-left text-xs text-[var(--aw-text-1)] hover:text-white truncate px-1">{s.name}</button>
                    <button onClick={() => deleteSnapshot(s.id)} className="opacity-0 group-hover:opacity-100 text-[var(--aw-text-3)] hover:text-red-400 transition-all p-0.5 rounded"><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
              </>
            )}

            <div className="h-px bg-[var(--aw-bg-3)] my-1" />
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-1">
                <input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveLayout(); }}
                  placeholder="Save current layout…"
                  className="flex-1 text-xs bg-[var(--aw-bg-0)] border border-[var(--aw-bg-3)] rounded px-2 py-1 text-[var(--aw-text-0)] placeholder-[var(--aw-text-4)] outline-none focus:border-[var(--aw-blue)]/50"
                />
                <button onClick={saveLayout} disabled={isSaving || !saveName.trim()}
                  className="text-xs px-2 py-1 rounded bg-[var(--aw-blue)]/15 text-[var(--aw-blue)] hover:bg-[var(--aw-blue)]/25 disabled:opacity-40 transition-colors shrink-0">
                  {isSaving ? '…' : <Save className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
