'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/store/session-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getAgentDisplay, getStatusDisplay } from '@/lib/agent-display';
import { formatTokens, formatDuration, cn } from '@/lib/utils';
import { ZoomIn, ZoomOut, RotateCcw, GitFork, X } from 'lucide-react';
import type { Agent } from '@/types/session';
import type { PaneTab, LayoutNode } from '@/types/workspace';

const NODE_W = 148;
const NODE_H = 44;
const H_GAP = 20;
const V_GAP = 68;
const COL = NODE_W + H_GAP;
const ROW = NODE_H + V_GAP;

interface TreeNode {
  agentId: string;
  x: number;
  y: number;
  subtreeWidth: number; // in column units
  children: TreeNode[];
}

function buildSubtree(
  agentId: string,
  agentMap: Map<string, Agent>,
  depth: number,
  visited: Set<string>
): TreeNode {
  if (visited.has(agentId)) return { agentId, x: 0, y: depth * ROW, subtreeWidth: 1, children: [] };
  visited.add(agentId);

  const agent = agentMap.get(agentId);
  const childIds = [...(agent?.children ?? [])].sort((a, b) => {
    const aAgent = agentMap.get(a);
    const bAgent = agentMap.get(b);
    const aTime = aAgent?.startTime ? new Date(aAgent.startTime).getTime() : 0;
    const bTime = bAgent?.startTime ? new Date(bAgent.startTime).getTime() : 0;
    return aTime - bTime;
  });
  const children = childIds.map(id => buildSubtree(id, agentMap, depth + 1, visited));
  const subtreeWidth = children.length === 0 ? 1 : children.reduce((s, c) => s + c.subtreeWidth, 0);
  return { agentId, x: 0, y: depth * ROW, subtreeWidth, children };
}

function assignX(node: TreeNode, startCol: number): void {
  node.x = (startCol + node.subtreeWidth / 2) * COL - NODE_W / 2;
  let col = startCol;
  for (const child of node.children) {
    assignX(child, col);
    col += child.subtreeWidth;
  }
}

function flattenTree(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
  out.push(node);
  for (const c of node.children) flattenTree(c, out);
  return out;
}

function collectEdges(node: TreeNode): Array<{ from: TreeNode; to: TreeNode }> {
  const edges: Array<{ from: TreeNode; to: TreeNode }> = [];
  for (const c of node.children) {
    edges.push({ from: node, to: c });
    edges.push(...collectEdges(c));
  }
  return edges;
}

function getFirstPaneId(node: LayoutNode): string | null {
  if (node.type === 'pane') return node.id;
  return getFirstPaneId(node.children[0]);
}

function findOtherPane(node: LayoutNode, excludeId: string): string | null {
  if (node.type === 'pane') return node.id !== excludeId ? node.id : null;
  return findOtherPane(node.children[0], excludeId) ?? findOtherPane(node.children[1], excludeId);
}

interface AgentHierarchyGraphProps {
  sessionId: string;
  paneId?: string;
  isSingleTab?: boolean;
  showWorkflowPhases?: boolean;
}

interface WorkflowPhaseData {
  title: string;
  agentIds: Set<string>;
  color: string;
}

const PHASE_COLORS = ['var(--aw-phase-blue)', 'var(--aw-green-bg)', 'var(--aw-phase-orange)', '#2d1f45', '#3d1f1a', 'var(--aw-phase-teal)'];

export function AgentHierarchyGraph({ sessionId, paneId, isSingleTab, showWorkflowPhases: defaultShowPhases }: AgentHierarchyGraphProps) {
  const { session, agentMap } = useSessionStore();
  const { closePane } = useWorkspaceStore();
  const router = useRouter();

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, startPan: { x: 0, y: 0 } });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showPhases, setShowPhases] = useState(defaultShowPhases ?? false);
  const [phaseData, setPhaseData] = useState<WorkflowPhaseData[]>([]);
  const [phasesLoaded, setPhasesLoaded] = useState(false);

  

  // Load workflow phases when toggled on
  useEffect(() => {
    if (!showPhases || phasesLoaded) return;
    fetch(`/api/v2/sessions/${sessionId}/workflow`)
      .then(r => r.json())
      .then(data => {
        const phases: WorkflowPhaseData[] = [];
        let colorIdx = 0;
        for (const wf of data.workflows ?? []) {
          for (const phase of wf.phases ?? []) {
            phases.push({
              title: phase.title,
              agentIds: new Set(phase.agentIds),
              color: PHASE_COLORS[colorIdx % PHASE_COLORS.length],
            });
            colorIdx++;
          }
        }
        setPhaseData(phases);
        setPhasesLoaded(true);
      })
      .catch(() => setPhasesLoaded(true));
  }, [showPhases, phasesLoaded, sessionId]);

  // Build tree layout
  const { allNodes, edges, svgWidth, svgHeight, rootIds } = useMemo(() => {
    if (!session) return { allNodes: [], edges: [], svgWidth: 400, svgHeight: 200, rootIds: [] };

    // Find roots (agents with no parent in this session), sorted by start time
    const rootIds = session.agents
      .filter(a => !a.parentId || !agentMap.has(a.parentId))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .map(a => a.id);

    if (rootIds.length === 0) {
      rootIds.push(session.rootAgentId);
    }

    const visited = new Set<string>();
    const roots = rootIds.map(id => buildSubtree(id, agentMap, 0, visited));

    // Assign any orphaned agents as extra roots, sorted by start time
    const orphans = session.agents
      .filter(a => !visited.has(a.id))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    for (const agent of orphans) {
      if (!visited.has(agent.id)) {
        roots.push(buildSubtree(agent.id, agentMap, 0, visited));
      }
    }

    // Assign X positions for all roots horizontally
    let col = 0;
    for (const root of roots) {
      assignX(root, col);
      col += root.subtreeWidth;
    }

    const allNodes = roots.flatMap(r => flattenTree(r));
    const edges = roots.flatMap(r => collectEdges(r));

    const maxX = Math.max(...allNodes.map(n => n.x + NODE_W), 400);
    const maxY = Math.max(...allNodes.map(n => n.y + NODE_H), 200);
    const svgWidth = maxX + H_GAP;
    const svgHeight = maxY + V_GAP;

    return { allNodes, edges, svgWidth, svgHeight, rootIds };
  }, [session, agentMap]);

  const openAgent = useCallback((agentId: string) => {
    const agent = agentMap.get(agentId);
    if (!agent) return;
    const { shortName } = getAgentDisplay(agent);
    const tab: PaneTab = { type: 'agent', agentId: agent.id, label: shortName };
    const store = useWorkspaceStore.getState();
    const l = store.layout;

    if (!l) {
      store.setLayout({ type: 'pane', id: 'main', tabs: [tab], activeTab: 0 });
      router.push(`/session/${sessionId}/workspace`);
      return;
    }

    if (paneId) {
      const other = findOtherPane(l, paneId);
      store.addTabToPane(other ?? paneId, tab);
    } else {
      const target = store.focusedPaneId ?? getFirstPaneId(l);
      if (target) store.addTabToPane(target, tab);
    }
  }, [agentMap, paneId, sessionId, router]);

  const doZoom = (factor: number) => setZoom(z => Math.max(0.1, Math.min(z * factor, 5)));
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: { ...pan } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: dragRef.current.startPan.x + (e.clientX - dragRef.current.startX),
      y: dragRef.current.startPan.y + (e.clientY - dragRef.current.startY),
    });
  };
  const onPointerUp = () => setIsDragging(false);
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    doZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--aw-text-3)] text-sm">
        <GitFork className="h-5 w-5 mr-2 opacity-40" /> No session loaded
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--aw-bg-0)]">
      {/* Pane header when single tab */}
      {isSingleTab && paneId && (
        <div className="shrink-0 border-b border-[var(--aw-bg-2)]">
          <div className="flex items-center gap-2.5 px-3 py-2 bg-[var(--aw-bg-1)]">
            <GitFork className="h-4 w-4 text-[var(--aw-purple)] shrink-0" />
            <span className="text-sm font-bold text-[var(--aw-text-0)] flex-1">Agent Hierarchy</span>
            <span className="text-[11px] text-[var(--aw-text-3)]">{session.agents.length} agents</span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={() => closePane(paneId)}
                className="p-1.5 rounded text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--aw-bg-2)] bg-[var(--aw-bg-0)] shrink-0">
        <span className="text-[11px] text-[var(--aw-text-3)] flex-1">
          {session.agents.length} agents · {session.agents.filter(a => a.parentId).length} subagents
        </span>
        <button
          onClick={() => { setShowPhases(v => !v); setPhasesLoaded(false); }}
          className={cn(
            'text-[10px] px-2 py-1 rounded transition-colors shrink-0',
            showPhases ? 'bg-[var(--aw-green-bg)] text-[var(--aw-green)] border border-[var(--aw-green-bg-2)]' : 'text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)]'
          )}
          title="Show workflow phases"
        >
          Phases
        </button>
        <button onClick={() => doZoom(1.3)} className="p-1 rounded text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors" title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
        <button onClick={() => doZoom(1 / 1.3)} className="p-1 rounded text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors" title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
        <button onClick={resetView} className="p-1 rounded text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors" title="Reset view"><RotateCcw className="h-3 w-3" /></button>
        <span className="text-[10px] font-mono text-[var(--aw-text-4)] w-10 text-right">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Phase legend */}
      {showPhases && phaseData.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 py-1.5 border-b border-[var(--aw-bg-2)] bg-[var(--aw-canvas-medium)] shrink-0">
          {phaseData.map((phase, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded border" style={{ backgroundColor: phase.color, borderColor: `${phase.color}80`, color: 'var(--aw-text-1)' }}>
              {phase.title}
            </span>
          ))}
        </div>
      )}

      {/* Graph canvas */}
      <div
        className="flex-1 relative overflow-hidden bg-[var(--aw-canvas-deep)]"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setIsDragging(false)}
        onWheel={onWheel}
      >
        {/* Dot grid background */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
          <defs>
            <pattern id="grid" x={pan.x % (20 * zoom)} y={pan.y % (20 * zoom)} width={20 * zoom} height={20 * zoom} patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.8" fill="var(--aw-bg-5)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Transformed graph content */}
        <div
          className="absolute"
          style={{
            transform: `translate(${pan.x + 24}px, ${pan.y + 24}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: svgWidth,
            height: svgHeight,
          }}
        >
          {/* Workflow phase background bands (rendered before edges/nodes) */}
          {showPhases && phaseData.map((phase, pi) => {
            const nodesInPhase = allNodes.filter(n => phase.agentIds.has(n.agentId));
            if (nodesInPhase.length === 0) return null;
            const minX = Math.min(...nodesInPhase.map(n => n.x)) - 8;
            const maxX = Math.max(...nodesInPhase.map(n => n.x + NODE_W)) + 8;
            const minY = Math.min(...nodesInPhase.map(n => n.y)) - 8;
            const maxY = Math.max(...nodesInPhase.map(n => n.y + NODE_H)) + 8;
            return (
              <div
                key={pi}
                className="absolute rounded-xl border pointer-events-none"
                style={{
                  left: minX, top: minY,
                  width: maxX - minX, height: maxY - minY,
                  backgroundColor: `${phase.color}40`,
                  borderColor: `${phase.color}80`,
                  zIndex: 0,
                }}
              >
                <span className="absolute -top-5 left-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: phase.color, color: 'var(--aw-text-1)' }}>
                  {phase.title}
                </span>
              </div>
            );
          })}

          {/* SVG edges */}
          <svg
            className="absolute inset-0 pointer-events-none overflow-visible"
            width={svgWidth}
            height={svgHeight}
          >
            {edges.map(({ from, to }) => {
              const x1 = from.x + NODE_W / 2;
              const y1 = from.y + NODE_H;
              const x2 = to.x + NODE_W / 2;
              const y2 = to.y;
              const midY = (y1 + y2) / 2;
              const isHovered = hoveredId === from.agentId || hoveredId === to.agentId;
              return (
                <path
                  key={`${from.agentId}-${to.agentId}`}
                  d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                  fill="none"
                  stroke={isHovered ? 'var(--aw-blue)' : 'var(--aw-bg-3)'}
                  strokeWidth={isHovered ? 1.5 : 1}
                  strokeDasharray={isHovered ? undefined : undefined}
                  opacity={isHovered ? 1 : 0.6}
                />
              );
            })}
          </svg>

          {/* Agent nodes */}
          {allNodes.map(node => {
            const agent = agentMap.get(node.agentId);
            if (!agent) return null;
            const { name, shortName, color, initials } = getAgentDisplay(agent);
            const isHovered = hoveredId === node.agentId;
            const isRoot = rootIds.includes(node.agentId);

            return (
              <div
                key={node.agentId}
                className="absolute rounded-lg border transition-all cursor-pointer select-none"
                style={{
                  left: node.x,
                  top: node.y,
                  width: NODE_W,
                  height: NODE_H,
                  backgroundColor: isHovered ? color.bg : 'var(--aw-bg-1)',
                  borderColor: isHovered ? color.text : color.border,
                  boxShadow: isRoot ? `0 0 10px ${color.text}30` : isHovered ? `0 0 6px ${color.text}20` : 'none',
                  zIndex: isHovered ? 10 : 1,
                }}
                onClick={e => { e.stopPropagation(); openAgent(node.agentId); }}
                onMouseEnter={() => setHoveredId(node.agentId)}
                onMouseLeave={() => setHoveredId(null)}
                title={`Open ${name}`}
              >
                <div className="flex items-center gap-2 px-2.5 h-full">
                  {/* Avatar */}
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0 border"
                    style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
                  >
                    {initials.slice(0, 2)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold truncate leading-tight"
                      style={{ color: isHovered ? color.text : 'var(--aw-text-0)' }}>
                      {shortName}
                    </div>
                    <div className="text-[9px] text-[var(--aw-text-3)] font-mono truncate leading-tight">
                      {formatTokens(agent.tokenUsage.total)} · {formatDuration(agent.durationMs)}
                    </div>
                  </div>

                  {/* Status dot — amber/red when the agent had denied or failed tool calls */}
                  {(() => {
                    const st = getStatusDisplay(agent);
                    return (
                      <div
                        className={cn('w-1.5 h-1.5 rounded-full shrink-0', st.tone === 'running' && 'animate-pulse')}
                        style={{ backgroundColor: st.hex }}
                        title={st.title}
                      />
                    );
                  })()}
                </div>

                {/* Child count badge */}
                {agent.children.length > 0 && (
                  <div
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[8px] px-1.5 py-0.5 rounded-full font-bold border"
                    style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
                  >
                    {agent.children.length}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
