'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/store/session-store';
import { useWorkspaceStore } from '@/store/workspace-store';
import { getAgentDisplay } from '@/lib/agent-display';
import { formatDuration, formatTokens, cn } from '@/lib/utils';
import { ZoomIn, ZoomOut, Maximize2, Minimize2, X, RotateCcw, Activity, Layers } from 'lucide-react';
import type { Agent } from '@/types/session';
import type { PaneTab, LayoutNode } from '@/types/workspace';

const LABEL_WIDTH = 168;
const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 32;

type ViewMode = 'list' | 'lanes';

interface ArtifactMarker {
  id: string;
  file_path: string;
  type: string;
  timestamp: number | null;
  agent_id: string;
}

interface AgentTooltipData {
  agent: Agent;
  barLeft: number;
  barTop: number;
  barWidth: number;
}

interface LaneAgent {
  agent: Agent;
  startMs: number;
  endMs: number;
  durMs: number;
}

interface LaneRow {
  lane: number;
  agents: LaneAgent[];
}

function tickInterval(zoom: number): number {
  const pxPerSec = zoom * 1000;
  if (pxPerSec < 0.3)  return 30 * 60 * 1000;
  if (pxPerSec < 1.5)  return 10 * 60 * 1000;
  if (pxPerSec < 5)    return  5 * 60 * 1000;
  if (pxPerSec < 15)   return  1 * 60 * 1000;
  if (pxPerSec < 60)   return 30 * 1000;
  if (pxPerSec < 150)  return 10 * 1000;
  return 1000;
}

function formatTimeLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${m > 0 ? `${m}m` : ''}`;
  if (m > 0) return `${m}m${sec > 0 ? `${sec}s` : ''}`;
  return `${sec}s`;
}

function getFirstPaneId(node: LayoutNode): string | null {
  if (node.type === 'pane') return node.id;
  return getFirstPaneId(node.children[0]);
}

// Find the first pane that is NOT excludeId (for opening agents in a sibling pane)
function findOtherPane(node: LayoutNode, excludeId: string): string | null {
  if (node.type === 'pane') return node.id !== excludeId ? node.id : null;
  return findOtherPane(node.children[0], excludeId) ?? findOtherPane(node.children[1], excludeId);
}

function fileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath;
}

interface ExecutionTimelineProps {
  sessionId: string;
  paneId?: string;
  isSingleTab?: boolean;
}

export function ExecutionTimeline({ sessionId, paneId, isSingleTab }: ExecutionTimelineProps) {
  const { session } = useSessionStore();
  const { closePane, maximizePane, restorePane, maximizedPaneId } = useWorkspaceStore();
  const router = useRouter();

  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);
  const [zoom, setZoom] = useState<number | null>(null);
  const [panOffset, setPanOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startPan: 0 });
  const [tooltip, setTooltip] = useState<AgentTooltipData | null>(null);

  // New: view mode and markers
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showMarkers, setShowMarkers] = useState(true);
  const [artifacts, setArtifacts] = useState<ArtifactMarker[]>([]);
  const [markersLoaded, setMarkersLoaded] = useState(false);

  const isMaximized = paneId ? maximizedPaneId === paneId : false;

  // Measure canvas width
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setCanvasWidth(entries[0].contentRect.width));
    ro.observe(el);
    setCanvasWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Fetch artifact markers lazily (only when markers are enabled)
  useEffect(() => {
    if (!showMarkers || markersLoaded) return;
    fetch(`/api/v2/sessions/${sessionId}/artifacts`)
      .then(r => r.json())
      .then(d => { setArtifacts(d.artifacts ?? []); setMarkersLoaded(true); })
      .catch(() => setMarkersLoaded(true));
  }, [sessionId, showMarkers, markersLoaded]);

  // Group artifacts by agent for quick lookup
  const artifactsByAgent = useMemo(() => {
    const map = new Map<string, ArtifactMarker[]>();
    for (const a of artifacts) {
      if (a.timestamp) {
        if (!map.has(a.agent_id)) map.set(a.agent_id, []);
        map.get(a.agent_id)!.push(a);
      }
    }
    return map;
  }, [artifacts]);

  // Session timing
  const { sortedAgents, sessionStart, sessionDurationMs } = useMemo(() => {
    if (!session) return { sortedAgents: [], sessionStart: 0, sessionDurationMs: 1 };
    const sorted = [...session.agents].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    const starts = sorted.map(a => new Date(a.startTime).getTime()).filter(Boolean);
    const ends = sorted.filter(a => a.endTime).map(a => new Date(a.endTime!).getTime());
    const sessionStart = starts.length ? Math.min(...starts) : Date.now();
    const sessionEnd = ends.length ? Math.max(...ends) : sessionStart + 1000;
    return { sortedAgents: sorted, sessionStart, sessionDurationMs: Math.max(sessionEnd - sessionStart, 1000) };
  }, [session]);

  // Swim lane assignment
  const lanesData = useMemo((): LaneRow[] | null => {
    if (viewMode !== 'lanes') return null;
    const laneEnds: number[] = [];
    const assignments: Array<{ agent: Agent; lane: number; startMs: number; endMs: number; durMs: number }> = [];

    for (const agent of sortedAgents) {
      const startMs = new Date(agent.startTime).getTime() - sessionStart;
      const endMs = agent.endTime
        ? new Date(agent.endTime).getTime() - sessionStart
        : startMs + (agent.durationMs || 0);
      let lane = laneEnds.findIndex(e => e <= startMs);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(endMs); }
      else laneEnds[lane] = endMs;
      assignments.push({ agent, lane, startMs, endMs, durMs: endMs - startMs });
    }

    const maxLane = assignments.length > 0 ? Math.max(...assignments.map(a => a.lane)) : 0;
    return Array.from({ length: maxLane + 1 }, (_, l) => ({
      lane: l,
      agents: assignments.filter(a => a.lane === l),
    }));
  }, [viewMode, sortedAgents, sessionStart]);

  // Zoom / pan
  const fitZoom = useCallback(() =>
    canvasWidth > 10 ? canvasWidth / sessionDurationMs : 0.001,
  [canvasWidth, sessionDurationMs]);

  const effectiveZoom = zoom ?? fitZoom();
  const maxPan = Math.max(0, sessionDurationMs * effectiveZoom - canvasWidth);
  const pan = Math.max(0, Math.min(panOffset, maxPan));

  const doZoom = useCallback((factor: number, cursorX?: number) => {
    const cx = cursorX ?? canvasWidth / 2;
    const cur = zoom ?? fitZoom();
    const next = Math.max(cur * factor, 0.000001);
    const newPan = ((pan + cx) / (sessionDurationMs * cur)) * (sessionDurationMs * next) - cx;
    setZoom(next);
    setPanOffset(Math.max(0, newPan));
  }, [zoom, fitZoom, pan, canvasWidth, sessionDurationMs]);

  const resetZoom = () => { setZoom(null); setPanOffset(0); };

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    doZoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - rect.left);
  }, [doZoom]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startPan: pan };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = dragRef.current.startX - e.clientX;
    setPanOffset(Math.max(0, Math.min(dragRef.current.startPan + dx, maxPan)));
  };
  const onPointerUp = () => setIsDragging(false);

  const openAgent = useCallback((agent: Agent) => {
    const { shortName } = getAgentDisplay(agent);
    const tab: PaneTab = { type: 'agent', agentId: agent.id, label: shortName };
    const store = useWorkspaceStore.getState();
    const l = store.layout;

    if (!l) {
      // Standalone page (no workspace active): set a layout then navigate
      store.setLayout({ type: 'pane', id: 'main', tabs: [tab], activeTab: 0 });
      router.push(`/session/${sessionId}/workspace`);
      return;
    }

    if (paneId) {
      // Inside a workspace pane: open in a sibling pane if one exists,
      // otherwise fall back to adding as a tab in this pane
      const other = findOtherPane(l, paneId);
      store.addTabToPane(other ?? paneId, tab);
    } else {
      const target = store.focusedPaneId ?? getFirstPaneId(l);
      if (target) store.addTabToPane(target, tab);
    }
  }, [paneId, sessionId, router]);

  const interval = tickInterval(effectiveZoom);
  const ticks = useMemo(() => {
    const result: number[] = [];
    for (let t = 0; t <= sessionDurationMs + interval; t += interval) {
      const x = t * effectiveZoom - pan;
      if (x >= -80 && x <= canvasWidth + 80) result.push(t);
    }
    return result;
  }, [interval, sessionDurationMs, effectiveZoom, pan, canvasWidth]);

  const maxConcurrent = lanesData ? lanesData.length : 0;

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-[#6e7681] text-sm">
        <Activity className="h-5 w-5 mr-2 opacity-40" /> No session loaded
      </div>
    );
  }

  const rows = viewMode === 'lanes' && lanesData ? lanesData : null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d1117]">
      {/* Pane header */}
      {isSingleTab && paneId && (
        <div className="shrink-0 border-b border-[#21262d]">
          <div className="flex items-center gap-2.5 px-3 py-2 bg-[#161b22]">
            <Activity className="h-4 w-4 text-[#58a6ff] shrink-0" />
            <span className="text-sm font-bold text-[#e6edf3] flex-1">Execution Timeline</span>
            <span className="text-[11px] text-[#6e7681]">{session.agents.length} agents</span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={() => isMaximized ? restorePane() : maximizePane(paneId)}
                className="p-1.5 rounded text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
                title={isMaximized ? 'Restore' : 'Maximize'}>
                {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => { restorePane(); closePane(paneId); }}
                className="p-1.5 rounded text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
                title="Close pane">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#21262d] bg-[#0d1117] shrink-0 flex-wrap gap-y-1">
        <span className="text-[11px] text-[#6e7681] flex-1 truncate min-w-[120px]">
          {formatDuration(sessionDurationMs)}
          {viewMode === 'lanes' && maxConcurrent > 0 && <> · {maxConcurrent} lane{maxConcurrent !== 1 ? 's' : ''}</>}
        </span>

        {/* View mode toggle */}
        <div className="flex items-center bg-[#21262d] rounded overflow-hidden shrink-0">
          {(['list', 'lanes'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={cn(
                'text-[10px] px-2 py-1 flex items-center gap-1 transition-colors',
                viewMode === m ? 'bg-[#30363d] text-[#e6edf3]' : 'text-[#6e7681] hover:text-[#c9d1d9]'
              )}
              title={m === 'list' ? 'One row per agent' : 'Swim lanes (concurrent agents grouped)'}
            >
              {m === 'lanes' && <Layers className="h-2.5 w-2.5" />}
              {m === 'list' ? 'List' : 'Lanes'}
            </button>
          ))}
        </div>

        {/* Markers toggle */}
        <button
          onClick={() => setShowMarkers(v => !v)}
          className={cn(
            'text-[10px] px-2 py-1 rounded transition-colors shrink-0 flex items-center gap-1',
            showMarkers ? 'bg-[#21262d] text-[#e6edf3]' : 'text-[#6e7681] hover:text-[#c9d1d9]'
          )}
          title="Toggle artifact markers"
        >
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: showMarkers ? '#3fb950' : '#484f58' }} />
          Markers
        </button>

        <button onClick={() => doZoom(1.5)} className="p-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors" title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
        <button onClick={() => doZoom(1 / 1.5)} className="p-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors" title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
        <button onClick={resetZoom} className="p-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors" title="Fit all"><RotateCcw className="h-3 w-3" /></button>
        <span className="text-[10px] font-mono text-[#484f58] w-10 text-right shrink-0">
          {zoom ? `×${(effectiveZoom / fitZoom()).toFixed(1)}` : 'fit'}
        </span>
      </div>

      {/* Timeline body */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Time axis header */}
        <div className="flex shrink-0 border-b border-[#21262d] bg-[#0d1117]" style={{ height: HEADER_HEIGHT }}>
          <div className="shrink-0 border-r border-[#21262d] flex items-center px-2" style={{ width: LABEL_WIDTH }}>
            <span className="text-[10px] text-[#484f58] font-medium uppercase tracking-wide">
              {viewMode === 'lanes' ? 'Lane' : 'Agent'}
            </span>
          </div>
          <div ref={canvasRef} className="flex-1 relative overflow-hidden">
            {ticks.map(t => {
              const x = t * effectiveZoom - pan;
              return (
                <div key={t} className="absolute top-0 flex flex-col items-center pointer-events-none"
                  style={{ left: x, transform: 'translateX(-50%)' }}>
                  <span className="text-[9px] font-mono text-[#6e7681] mt-1 leading-tight">{formatTimeLabel(t)}</span>
                  <div className="w-px h-2 bg-[#30363d] mt-0.5" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {viewMode === 'list' ? (
            /* ── LIST MODE: one row per agent ── */
            sortedAgents.map((agent, rowIdx) => {
              const { shortName, color, initials } = getAgentDisplay(agent);
              const startMs = new Date(agent.startTime).getTime() - sessionStart;
              const dur = agent.endTime
                ? new Date(agent.endTime).getTime() - new Date(agent.startTime).getTime()
                : agent.durationMs || 0;
              const barLeft = startMs * effectiveZoom - pan;
              const barWidth = Math.max(dur * effectiveZoom, 4);
              const visible = barLeft + barWidth >= 0 && barLeft <= canvasWidth;

              return (
                <div key={agent.id}
                  className={cn('flex border-b border-[#0d1117]', rowIdx % 2 === 0 ? 'bg-[#0d1117]' : 'bg-[#0a0e14]')}
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* Label */}
                  <div className="shrink-0 flex items-center gap-1.5 px-2 border-r border-[#21262d] cursor-pointer hover:bg-[#161b22] transition-colors"
                    style={{ width: LABEL_WIDTH }}
                    onClick={() => openAgent(agent)}
                    title={`Open ${shortName}`}
                  >
                    <div className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold shrink-0 border"
                      style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}>
                      {initials.slice(0, 2)}
                    </div>
                    <span className="text-[10px] text-[#c9d1d9] truncate flex-1 leading-tight">{shortName}</span>
                    <span className={cn('text-[8px] px-1 rounded shrink-0 font-medium',
                      agent.status === 'completed' ? 'text-[#3fb950] bg-[#3fb950]/10' :
                      agent.status === 'running'   ? 'text-[#58a6ff] bg-[#58a6ff]/10' :
                      agent.status === 'errored'   ? 'text-[#f85149] bg-[#f85149]/10' :
                      'text-[#8b949e] bg-[#21262d]'
                    )}>
                      {agent.status[0].toUpperCase()}
                    </span>
                  </div>

                  {/* Bar cell */}
                  <div className="flex-1 relative"
                    style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                    onWheel={onWheel}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={() => setIsDragging(false)}
                  >
                    {ticks.map(t => {
                      const x = t * effectiveZoom - pan;
                      if (x < 0 || x > canvasWidth) return null;
                      return <div key={t} className="absolute top-0 bottom-0 w-px bg-[#21262d]/40" style={{ left: x }} />;
                    })}

                    {visible && (
                      <div className="absolute rounded border cursor-pointer hover:opacity-85 flex items-center overflow-hidden"
                        style={{
                          left: Math.max(barLeft, 0),
                          width: barLeft < 0 ? barWidth + barLeft : Math.min(barWidth, canvasWidth - Math.max(barLeft, 0)),
                          top: 6, height: ROW_HEIGHT - 12,
                          backgroundColor: color.bg, borderColor: color.border,
                        }}
                        onClick={e => { e.stopPropagation(); openAgent(agent); }}
                        onMouseEnter={() => setTooltip({ agent, barLeft, barTop: rowIdx * ROW_HEIGHT, barWidth })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {barWidth > 32 && (
                          <span className="text-[9px] font-medium px-1.5 truncate select-none" style={{ color: color.text }}>
                            {shortName}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Artifact markers */}
                    {showMarkers && (artifactsByAgent.get(agent.id) ?? []).map(art => {
                      if (!art.timestamp) return null;
                      const mx = (art.timestamp - sessionStart) * effectiveZoom - pan;
                      if (mx < 0 || mx > canvasWidth) return null;
                      const isCreate = art.type === 'create';
                      return (
                        <div key={art.id}
                          className="absolute pointer-events-auto z-10"
                          style={{ left: mx - 3, bottom: 1 }}
                          title={`${isCreate ? '✚ Created' : '✎ Modified'}: ${fileName(art.file_path)}`}
                        >
                          <svg width="7" height="5" viewBox="0 0 7 5" className="cursor-default">
                            <polygon points="3.5,0 7,5 0,5"
                              fill={isCreate ? '#3fb950' : '#f0883e'} opacity="0.9" />
                          </svg>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            /* ── LANES MODE: one row per swim lane ── */
            (rows ?? []).map((row, rowIdx) => (
              <div key={row.lane}
                className={cn('flex border-b border-[#0d1117]', rowIdx % 2 === 0 ? 'bg-[#0d1117]' : 'bg-[#0a0e14]')}
                style={{ height: ROW_HEIGHT }}
              >
                {/* Lane label */}
                <div className="shrink-0 flex items-center gap-1.5 px-2 border-r border-[#21262d]"
                  style={{ width: LABEL_WIDTH }}>
                  <span className="text-[9px] font-mono text-[#484f58] shrink-0 w-5">L{row.lane + 1}</span>
                  <div className="flex items-center gap-0.5 flex-1 overflow-hidden">
                    {row.agents.slice(0, 4).map(({ agent }) => {
                      const { color, initials } = getAgentDisplay(agent);
                      return (
                        <div key={agent.id}
                          className="w-4 h-4 rounded flex items-center justify-center text-[7px] font-bold shrink-0 border cursor-pointer"
                          style={{ backgroundColor: color.bg, color: color.text, borderColor: color.border }}
                          onClick={() => openAgent(agent)}
                          title={getAgentDisplay(agent).shortName}
                        >
                          {initials.slice(0, 2)}
                        </div>
                      );
                    })}
                    {row.agents.length > 4 && (
                      <span className="text-[9px] text-[#484f58] ml-0.5">+{row.agents.length - 4}</span>
                    )}
                  </div>
                  <span className="text-[9px] text-[#484f58] shrink-0">{row.agents.length}</span>
                </div>

                {/* Bar cell with all agents in this lane */}
                <div className="flex-1 relative"
                  style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                  onWheel={onWheel}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={() => setIsDragging(false)}
                >
                  {ticks.map(t => {
                    const x = t * effectiveZoom - pan;
                    if (x < 0 || x > canvasWidth) return null;
                    return <div key={t} className="absolute top-0 bottom-0 w-px bg-[#21262d]/40" style={{ left: x }} />;
                  })}

                  {row.agents.map(({ agent, startMs, durMs }) => {
                    const { shortName, color } = getAgentDisplay(agent);
                    const barLeft = startMs * effectiveZoom - pan;
                    const barWidth = Math.max(durMs * effectiveZoom, 4);
                    if (barLeft + barWidth < 0 || barLeft > canvasWidth) return null;

                    return (
                      <div key={agent.id}
                        className="absolute rounded border cursor-pointer hover:opacity-85 flex items-center overflow-hidden"
                        style={{
                          left: Math.max(barLeft, 0),
                          width: barLeft < 0 ? barWidth + barLeft : Math.min(barWidth, canvasWidth - Math.max(barLeft, 0)),
                          top: 6, height: ROW_HEIGHT - 12,
                          backgroundColor: color.bg, borderColor: color.border,
                        }}
                        onClick={e => { e.stopPropagation(); openAgent(agent); }}
                        onMouseEnter={() => setTooltip({ agent, barLeft, barTop: rowIdx * ROW_HEIGHT, barWidth })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {barWidth > 28 && (
                          <span className="text-[9px] font-medium px-1.5 truncate select-none" style={{ color: color.text }}>
                            {shortName}
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* Artifact markers for all agents in this lane */}
                  {showMarkers && row.agents.flatMap(({ agent }) =>
                    (artifactsByAgent.get(agent.id) ?? []).map(art => {
                      if (!art.timestamp) return null;
                      const mx = (art.timestamp - sessionStart) * effectiveZoom - pan;
                      if (mx < 0 || mx > canvasWidth) return null;
                      const isCreate = art.type === 'create';
                      return (
                        <div key={art.id}
                          className="absolute pointer-events-auto z-10"
                          style={{ left: mx - 3, bottom: 1 }}
                          title={`${isCreate ? '✚ Created' : '✎ Modified'}: ${fileName(art.file_path)}`}
                        >
                          <svg width="7" height="5" viewBox="0 0 7 5" className="cursor-default">
                            <polygon points="3.5,0 7,5 0,5"
                              fill={isCreate ? '#3fb950' : '#f0883e'} opacity="0.9" />
                          </svg>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Legend for markers */}
      {showMarkers && artifacts.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1 border-t border-[#21262d] bg-[#0d1117] shrink-0">
          <span className="flex items-center gap-1 text-[10px] text-[#484f58]">
            <svg width="7" height="5" viewBox="0 0 7 5"><polygon points="3.5,0 7,5 0,5" fill="#3fb950" /></svg>
            Created
          </span>
          <span className="flex items-center gap-1 text-[10px] text-[#484f58]">
            <svg width="7" height="5" viewBox="0 0 7 5"><polygon points="3.5,0 7,5 0,5" fill="#f0883e" /></svg>
            Modified
          </span>
          <span className="text-[10px] text-[#484f58] ml-auto">{artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Agent tooltip */}
      {tooltip && <AgentTooltip tooltip={tooltip} canvasWidth={canvasWidth} />}
    </div>
  );
}

function AgentTooltip({ tooltip, canvasWidth }: { tooltip: AgentTooltipData; canvasWidth: number }) {
  const { agent, barLeft, barTop, barWidth } = tooltip;
  const { name, color } = getAgentDisplay(agent);
  const tipWidth = 220;
  const barCenter = LABEL_WIDTH + Math.max(barLeft, 0) + Math.min(barWidth, canvasWidth) / 2;
  const left = Math.max(8, Math.min(barCenter - tipWidth / 2, canvasWidth + LABEL_WIDTH - tipWidth - 8));
  const top = HEADER_HEIGHT + barTop - 4;

  return (
    <div className="absolute pointer-events-none z-50 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl px-3 py-2.5"
      style={{ left, top, width: tipWidth, transform: 'translateY(-100%)' }}>
      <div className="flex items-center gap-1.5 mb-2">
        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: color.text }} />
        <span className="text-xs font-semibold text-[#e6edf3] truncate flex-1">{name}</span>
        <span className={cn('text-[9px] px-1 rounded font-medium',
          agent.status === 'completed' ? 'text-[#3fb950] bg-[#3fb950]/10' :
          agent.status === 'running'   ? 'text-[#58a6ff] bg-[#58a6ff]/10' :
          agent.status === 'errored'   ? 'text-[#f85149] bg-[#f85149]/10' :
          'text-[#8b949e] bg-[#21262d]'
        )}>
          {agent.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 text-[11px]">
        <span className="text-[#6e7681]">Duration</span>
        <span className="text-[#c9d1d9] text-right">{formatDuration(agent.durationMs)}</span>
        <span className="text-[#6e7681]">Tokens</span>
        <span className="text-[#c9d1d9] text-right">{formatTokens(agent.tokenUsage.total)}</span>
        <span className="text-[#6e7681]">Messages</span>
        <span className="text-[#c9d1d9] text-right">{agent.messageCount}</span>
        {agent.toolCalls.length > 0 && (
          <>
            <span className="text-[#6e7681]">Tools</span>
            <span className="text-[#c9d1d9] text-right">{agent.toolCalls.reduce((s, t) => s + t.count, 0)}</span>
          </>
        )}
      </div>
      {agent.model && (
        <div className="mt-1.5 pt-1.5 border-t border-[#21262d] text-[10px] font-mono text-[#484f58]">
          {agent.model.replace('claude-', '')}
        </div>
      )}
      <div className="mt-1 text-[10px] text-[#58a6ff]">Click to open</div>
    </div>
  );
}
