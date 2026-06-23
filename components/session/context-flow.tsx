'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/store/session-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getAgentDisplay, getStatusDisplay } from '@/lib/agent-display';
import { formatTokens, formatDuration, cn } from '@/lib/utils';
import { ZoomIn, ZoomOut, RotateCcw, GitFork, Maximize2, Minimize2, X, ChevronRight } from 'lucide-react';
import { findOtherPane, getFirstPaneId } from '@/lib/workspace-utils';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import type { Agent } from '@/types/session';
import type { PaneTab, LayoutNode } from '@/types/workspace';

const NODE_W = 160;
const NODE_H = 52;
const H_GAP = 24;
const V_GAP = 80;
const COL = NODE_W + H_GAP;
const ROW = NODE_H + V_GAP;

interface TreeNode {
  agentId: string;
  x: number;
  y: number;
  subtreeWidth: number;
  children: TreeNode[];
}

function buildSubtree(agentId: string, agentMap: Map<string, Agent>, depth: number, visited: Set<string>): TreeNode {
  if (visited.has(agentId)) return { agentId, x: 0, y: depth * ROW, subtreeWidth: 1, children: [] };
  visited.add(agentId);
  const agent = agentMap.get(agentId);
  const childIds = agent?.children ?? [];
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

interface ContextFlowProps {
  sessionId: string;
  paneId?: string;
  isSingleTab?: boolean;
}

interface SelectedEdge {
  parentId: string;
  childId: string;
}

export function ContextFlow({ sessionId, paneId, isSingleTab }: ContextFlowProps) {
  const { session, agentMap } = useSessionStore();
  const { closePane, maximizePane, restorePane, maximizedPaneId } = useWorkspaceStore();
  const router = useRouter();

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, startPan: { x: 0, y: 0 } });
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);

  const isMaximized = paneId ? maximizedPaneId === paneId : false;

  const { allNodes, edges, svgWidth, svgHeight, rootIds } = useMemo(() => {
    if (!session) return { allNodes: [], edges: [], svgWidth: 400, svgHeight: 200, rootIds: [] };

    const rIds = session.agents.filter(a => !a.parentId || !agentMap.has(a.parentId)).map(a => a.id);
    if (rIds.length === 0) rIds.push(session.rootAgentId);

    const visited = new Set<string>();
    const roots = rIds.map(id => buildSubtree(id, agentMap, 0, visited));

    for (const agent of session.agents) {
      if (!visited.has(agent.id)) roots.push(buildSubtree(agent.id, agentMap, 0, visited));
    }

    let col = 0;
    for (const root of roots) { assignX(root, col); col += root.subtreeWidth; }

    const allNodes = roots.flatMap(r => flattenTree(r));
    const edges = roots.flatMap(r => collectEdges(r));
    const maxX = Math.max(...allNodes.map(n => n.x + NODE_W), 400);
    const maxY = Math.max(...allNodes.map(n => n.y + NODE_H), 200);

    return { allNodes, edges, svgWidth: maxX + H_GAP, svgHeight: maxY + V_GAP, rootIds: rIds };
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
      const dest = store.focusedPaneId ?? getFirstPaneId(l);
      if (dest) store.addTabToPane(dest, tab);
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
    setPan({ x: dragRef.current.startPan.x + (e.clientX - dragRef.current.startX), y: dragRef.current.startPan.y + (e.clientY - dragRef.current.startY) });
  };
  const onPointerUp = () => setIsDragging(false);
  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); doZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); };

  const selectedChild = selectedEdge ? agentMap.get(selectedEdge.childId) : null;
  const selectedParent = selectedEdge ? agentMap.get(selectedEdge.parentId) : null;

  if (!session) {
    return <div className="flex items-center justify-center h-full text-[#6e7681] text-sm"><GitFork className="h-5 w-5 mr-2 opacity-40" /> No session loaded</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d1117]">
      {isSingleTab && paneId && (
        <div className="shrink-0 border-b border-[#21262d]">
          <div className="flex items-center gap-2.5 px-3 py-2 bg-[#161b22]">
            <GitFork className="h-4 w-4 text-[#39d353] shrink-0" />
            <span className="text-sm font-bold text-[#e6edf3] flex-1">Context Flow</span>
            <span className="text-[11px] text-[#6e7681]">{session.agents.length} agents</span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={() => isMaximized ? restorePane() : maximizePane(paneId)} className="p-1.5 rounded text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors">
                {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => { restorePane(); closePane(paneId); }} className="p-1.5 rounded text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#21262d] bg-[#0d1117] shrink-0">
        <span className="text-[11px] text-[#6e7681] flex-1">
          Click an edge to inspect prompt/response · Click a node to open agent
        </span>
        <button onClick={() => doZoom(1.3)} className="p-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors" title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
        <button onClick={() => doZoom(1 / 1.3)} className="p-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors" title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
        <button onClick={resetView} className="p-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors" title="Reset view"><RotateCcw className="h-3 w-3" /></button>
        <span className="text-[10px] font-mono text-[#484f58] w-10 text-right">{Math.round(zoom * 100)}%</span>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Graph canvas */}
        <div
          className="flex-1 relative overflow-hidden bg-[#060a0f]"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setIsDragging(false)}
          onWheel={onWheel}
        >
          {/* Dot grid */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
            <defs>
              <pattern id="cf-grid" x={pan.x % (20 * zoom)} y={pan.y % (20 * zoom)} width={20 * zoom} height={20 * zoom} patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.8" fill="#1c2128" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#cf-grid)" />
          </svg>

          <div
            className="absolute"
            style={{ transform: `translate(${pan.x + 24}px, ${pan.y + 24}px) scale(${zoom})`, transformOrigin: '0 0', width: svgWidth, height: svgHeight }}
          >
            {/* SVG edges with token labels */}
            <svg className="absolute inset-0 overflow-visible" width={svgWidth} height={svgHeight}>
              {edges.map(({ from, to }) => {
                const childAgent = agentMap.get(to.agentId);
                const edgeKey = `${from.agentId}-${to.agentId}`;
                const isHovered = hoveredEdge === edgeKey;
                const isSelected = selectedEdge?.childId === to.agentId;

                const x1 = from.x + NODE_W / 2;
                const y1 = from.y + NODE_H;
                const x2 = to.x + NODE_W / 2;
                const y2 = to.y;
                const midY = (y1 + y2) / 2;
                const midX = (x1 + x2) / 2;

                const inputTok = childAgent ? formatTokens(childAgent.tokenUsage.input) : '';
                const outputTok = childAgent ? formatTokens(childAgent.tokenUsage.output) : '';

                return (
                  <g key={edgeKey}>
                    {/* Invisible wider hit area */}
                    <path
                      d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={12}
                      style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                      onMouseEnter={() => setHoveredEdge(edgeKey)}
                      onMouseLeave={() => setHoveredEdge(null)}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); setSelectedEdge(isSelected ? null : { parentId: from.agentId, childId: to.agentId }); }}
                    />
                    {/* Visible edge */}
                    <path
                      d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                      fill="none"
                      stroke={isSelected ? '#39d353' : isHovered ? '#58a6ff' : '#30363d'}
                      strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 1}
                      opacity={isHovered || isSelected ? 1 : 0.5}
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Arrow head */}
                    <polygon
                      points={`${x2},${y2} ${x2 - 3},${y2 - 5} ${x2 + 3},${y2 - 5}`}
                      fill={isSelected ? '#39d353' : isHovered ? '#58a6ff' : '#30363d'}
                      opacity={isHovered || isSelected ? 1 : 0.5}
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Token labels on hover/select */}
                    {(isHovered || isSelected) && childAgent && (
                      <g>
                        {/* Input tokens (going down) */}
                        <rect x={midX - 28} y={midY - 18} width={56} height={14} rx={3} fill="#1c2333" stroke="#2d3f55" strokeWidth={0.5} />
                        <text x={midX} y={midY - 8} textAnchor="middle" fill="#58a6ff" fontSize={8} fontFamily="monospace">
                          ↓ {inputTok}
                        </text>
                        {/* Output tokens (going up) */}
                        <rect x={midX - 28} y={midY + 5} width={56} height={14} rx={3} fill="#1c2333" stroke="#2d3f55" strokeWidth={0.5} />
                        <text x={midX} y={midY + 15} textAnchor="middle" fill="#3fb950" fontSize={8} fontFamily="monospace">
                          ↑ {outputTok}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Agent nodes */}
            {allNodes.map(node => {
              const agent = agentMap.get(node.agentId);
              if (!agent) return null;
              const { name, shortName, color, initials } = getAgentDisplay(agent);
              const isRoot = rootIds.includes(node.agentId);
              const isSelectedNode = selectedEdge?.childId === node.agentId || selectedEdge?.parentId === node.agentId;

              return (
                <div
                  key={node.agentId}
                  className="absolute rounded-lg border transition-all cursor-pointer select-none"
                  style={{
                    left: node.x, top: node.y, width: NODE_W, height: NODE_H,
                    backgroundColor: isSelectedNode ? color.bg : '#161b22',
                    borderColor: isSelectedNode ? color.text : color.border,
                    boxShadow: isRoot ? `0 0 10px ${color.text}30` : isSelectedNode ? `0 0 6px ${color.text}20` : 'none',
                    zIndex: isSelectedNode ? 10 : 1,
                  }}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); openAgent(node.agentId); }}
                  title={`Open ${name}`}
                >
                  <div className="flex items-center gap-2 px-2.5 h-full">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0 border" style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}>
                      {initials.slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold truncate leading-tight" style={{ color: isSelectedNode ? color.text : '#e6edf3' }}>
                        {shortName}
                      </div>
                      <div className="text-[9px] text-[#6e7681] font-mono truncate leading-tight">
                        {formatTokens(agent.tokenUsage.total)} · {formatDuration(agent.durationMs)}
                      </div>
                    </div>
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
                  {agent.children.length > 0 && (
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[8px] px-1.5 py-0.5 rounded-full font-bold border" style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}>
                      {agent.children.length}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Edge detail drawer */}
        {selectedEdge && selectedChild && (
          <div className="w-72 shrink-0 border-l border-[#21262d] bg-[#0d1117] flex flex-col overflow-hidden">
            {/* Drawer header */}
            <div className="shrink-0 px-3 py-2.5 border-b border-[#21262d] bg-[#161b22] flex items-center gap-2">
              {selectedParent && (() => {
                const { shortName, color, initials } = getAgentDisplay(selectedParent);
                return (
                  <span className="w-5 h-5 rounded text-[8px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: color.bg, color: color.text }}>
                    {initials.slice(0, 2)}
                  </span>
                );
              })()}
              <ChevronRight className="w-3 h-3 text-[#484f58] shrink-0" />
              {(() => {
                const { shortName, color, initials } = getAgentDisplay(selectedChild);
                return (
                  <span className="w-5 h-5 rounded text-[8px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: color.bg, color: color.text }}>
                    {initials.slice(0, 2)}
                  </span>
                );
              })()}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[#e6edf3] truncate">{getAgentDisplay(selectedChild).shortName}</div>
              </div>
              <button onClick={() => setSelectedEdge(null)} className="p-1 rounded text-[#6e7681] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Token summary */}
            <div className="shrink-0 px-3 py-2 border-b border-[#21262d] flex gap-4 text-[11px]">
              <div><span className="text-[#6e7681]">In:</span> <span className="text-[#58a6ff] font-mono">{formatTokens(selectedChild.tokenUsage.input)}</span></div>
              <div><span className="text-[#6e7681]">Out:</span> <span className="text-[#3fb950] font-mono">{formatTokens(selectedChild.tokenUsage.output)}</span></div>
              <div><span className="text-[#6e7681]">Dur:</span> <span className="text-[#f0883e] font-mono">{formatDuration(selectedChild.durationMs)}</span></div>
            </div>

            {/* Prompt / response content */}
            <div className="flex-1 overflow-y-auto">
              {selectedChild.prompt && (
                <div className="p-3 border-b border-[#21262d]">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6e7681] mb-1.5">Prompt</div>
                  <div className="text-[12px] text-[#c9d1d9] leading-relaxed line-clamp-12 font-mono">
                    {selectedChild.prompt.slice(0, 800)}{selectedChild.prompt.length > 800 ? '…' : ''}
                  </div>
                </div>
              )}
              {selectedChild.response && (
                <div className="p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6e7681] mb-1.5">Response</div>
                  <div className="text-[12px] text-[#c9d1d9] leading-relaxed line-clamp-12 font-mono">
                    {selectedChild.response.slice(0, 800)}{selectedChild.response.length > 800 ? '…' : ''}
                  </div>
                </div>
              )}
              {!selectedChild.prompt && !selectedChild.response && (
                <div className="p-4 text-[12px] text-[#484f58] italic">No prompt/response recorded for this agent</div>
              )}
            </div>

            {/* Open agent button */}
            <div className="shrink-0 px-3 py-2 border-t border-[#21262d]">
              <button
                onClick={() => openAgent(selectedChild.id)}
                className="w-full text-xs py-1.5 rounded border border-[#30363d] text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#161b22] transition-colors"
              >
                Open agent →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
