'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, Copy, Image as ImageIcon, Check, Loader2, Eye, X, GitFork } from 'lucide-react';
import { cn, formatTokens, formatDuration, formatCost, estimateAgentCost } from '@/lib/utils';
import { getAgentDisplay, getStatusDisplay } from '@/lib/agent-display';
import {
  hierarchyToText,
  hierarchyToSvg,
  svgToPngBlob,
  downloadBlob,
  copyTextToClipboard,
  flowDiagramToSvg,
  resolveColor,
  type ExportNode,
  type FlowDiagramNode,
  type FlowDiagramEdge,
  type FlowDiagramTheme,
} from '@/lib/hierarchy-export';
import type { Agent } from '@/types/session';

/** Count all descendants of an agent (guards against cycles). */
function countDescendants(agent: Agent, agentMap: Map<string, Agent>, visited: Set<string>): number {
  let n = 0;
  for (const id of agent.children) {
    const child = agentMap.get(id);
    if (child && !visited.has(id)) {
      visited.add(id);
      n += 1 + countDescendants(child, agentMap, visited);
    }
  }
  return n;
}

/**
 * Build the export tree from exactly what the sidebar shows: children sorted by
 * start time (matching the tree view), and collapsed subtrees omitted.
 */
function buildExportTree(
  root: Agent,
  agentMap: Map<string, Agent>,
  collapsedNodes: Set<string>,
): ExportNode {
  const build = (agent: Agent, seen: Set<string>): ExportNode => {
    const { name, color } = getAgentDisplay(agent);
    const status = getStatusDisplay(agent);
    const tu = agent.tokenUsage;
    const cache = tu.cacheCreation + tu.cacheRead;
    const cost = estimateAgentCost(tu, agent.model);
    const meta = [
      agent.model?.replace('claude-', '') || null,
      tu.total ? `in ${formatTokens(tu.input)} / out ${formatTokens(tu.output)}` : null,
      cache ? `cache ${formatTokens(cache)}` : null,
      tu.total ? `${formatTokens(tu.total)} total` : null,
      agent.durationMs ? formatDuration(agent.durationMs) : null,
      cost ? `~${formatCost(cost)}` : null,
      status.tone !== 'ok' && status.tone !== 'idle' ? status.label : null,
    ].filter(Boolean).join(' · ');
    const kids = agent.children
      .map(id => agentMap.get(id))
      .filter((c): c is Agent => !!c && !seen.has(c.id))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    kids.forEach(c => seen.add(c.id));

    const collapsed = collapsedNodes.has(agent.id) && kids.length > 0;
    return {
      id: agent.id,
      label: name,
      meta: meta || undefined,
      color: resolveColor(color.text),
      collapsed,
      hiddenChildCount: collapsed ? countDescendants(agent, agentMap, new Set()) : 0,
      children: collapsed ? [] : kids.map(c => build(c, seen)),
    };
  };
  return build(root, new Set([root.id]));
}

// ─── Flow diagram layout (mirrors agent-hierarchy-graph tree algorithm) ──────

const FD_NODE_W = 148;
const FD_NODE_H = 44;
const FD_H_GAP = 20;
const FD_V_GAP = 68;
const FD_COL = FD_NODE_W + FD_H_GAP;
const FD_ROW = FD_NODE_H + FD_V_GAP;

interface FdTree { agentId: string; x: number; y: number; subtreeWidth: number; children: FdTree[]; }

function fdBuild(agentId: string, agentMap: Map<string, Agent>, depth: number, visited: Set<string>): FdTree {
  if (visited.has(agentId)) return { agentId, x: 0, y: depth * FD_ROW, subtreeWidth: 1, children: [] };
  visited.add(agentId);
  const agent = agentMap.get(agentId);
  const childIds = [...(agent?.children ?? [])].sort((a, b) => {
    const at = agentMap.get(a)?.startTime, bt = agentMap.get(b)?.startTime;
    return (at ? new Date(at).getTime() : 0) - (bt ? new Date(bt).getTime() : 0);
  });
  const children = childIds.map(id => fdBuild(id, agentMap, depth + 1, visited));
  const subtreeWidth = children.length === 0 ? 1 : children.reduce((s, c) => s + c.subtreeWidth, 0);
  return { agentId, x: 0, y: depth * FD_ROW, subtreeWidth, children };
}

function fdAssignX(node: FdTree, startCol: number): void {
  node.x = (startCol + node.subtreeWidth / 2) * FD_COL - FD_NODE_W / 2;
  let col = startCol;
  for (const c of node.children) { fdAssignX(c, col); col += c.subtreeWidth; }
}

function fdFlatten(node: FdTree, out: FdTree[] = []): FdTree[] {
  out.push(node);
  for (const c of node.children) fdFlatten(c, out);
  return out;
}

function fdEdges(node: FdTree): Array<{ from: FdTree; to: FdTree }> {
  const edges: Array<{ from: FdTree; to: FdTree }> = [];
  for (const c of node.children) { edges.push({ from: node, to: c }); edges.push(...fdEdges(c)); }
  return edges;
}

function buildFlowDiagramData(
  agentMap: Map<string, Agent>,
  rootAgent: Agent,
): { nodes: FlowDiagramNode[]; edges: FlowDiagramEdge[]; rootIds: string[] } {
  const allAgents = [...agentMap.values()];
  const rootIds = allAgents
    .filter(a => !a.parentId || !agentMap.has(a.parentId))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .map(a => a.id);
  if (rootIds.length === 0) rootIds.push(rootAgent.id);

  const visited = new Set<string>();
  const roots = rootIds.map(id => fdBuild(id, agentMap, 0, visited));
  const orphans = allAgents
    .filter(a => !visited.has(a.id))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  for (const a of orphans) {
    if (!visited.has(a.id)) roots.push(fdBuild(a.id, agentMap, 0, visited));
  }

  let col = 0;
  for (const r of roots) { fdAssignX(r, col); col += r.subtreeWidth; }

  const treeNodes = roots.flatMap(r => fdFlatten(r));
  const treeEdges = roots.flatMap(r => fdEdges(r));

  const nodes: FlowDiagramNode[] = treeNodes.map(tn => {
    const agent = agentMap.get(tn.agentId);
    if (!agent) return null;
    const { shortName, color, initials } = getAgentDisplay(agent);
    const st = getStatusDisplay(agent);
    return {
      x: tn.x,
      y: tn.y,
      label: shortName,
      initials: initials.slice(0, 2),
      meta: `${formatTokens(agent.tokenUsage.total)} · ${formatDuration(agent.durationMs)}`,
      colorBg: resolveColor(color.bg),
      colorText: resolveColor(color.text),
      colorBorder: resolveColor(color.border),
      statusHex: st.hex,
      childCount: agent.children.length,
      isRoot: rootIds.includes(tn.agentId),
    };
  }).filter(Boolean) as FlowDiagramNode[];

  const edges: FlowDiagramEdge[] = treeEdges.map(({ from, to }) => ({
    x1: from.x + FD_NODE_W / 2,
    y1: from.y + FD_NODE_H,
    x2: to.x + FD_NODE_W / 2,
    y2: to.y,
  }));

  return { nodes, edges, rootIds };
}

interface ExportHierarchyMenuProps {
  rootAgent: Agent | undefined;
  agentMap: Map<string, Agent>;
  collapsedNodes: Set<string>;
  title: string;          // shown as the PNG header + used for the filename
}

export function ExportHierarchyMenu({ rootAgent, agentMap, collapsedNodes, title }: ExportHierarchyMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ text: string; svg: string; width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const fileBase = (title || 'agent').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agent';

  const handleCopy = async () => {
    if (!rootAgent) return;
    const tree = buildExportTree(rootAgent, agentMap, collapsedNodes);
    const ok = await copyTextToClipboard(hierarchyToText(tree));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    setOpen(false);
  };

  const buildArtifacts = () => {
    const tree = buildExportTree(rootAgent!, agentMap, collapsedNodes);
    const text = hierarchyToText(tree);
    const { svg, width, height } = hierarchyToSvg(tree, `${title} — Agent Hierarchy`);
    return { text, svg, width, height };
  };

  const handlePng = async () => {
    if (!rootAgent) return;
    setBusy(true);
    try {
      const { svg, width, height } = buildArtifacts();
      const blob = await svgToPngBlob(svg, width, height, 2);
      downloadBlob(blob, `${fileBase}-hierarchy.png`);
    } catch (err) {
      console.error('PNG export failed', err);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const handleFlowDiagram = async () => {
    if (!rootAgent) return;
    setBusy(true);
    try {
      const { nodes, edges } = buildFlowDiagramData(agentMap, rootAgent);
      const theme: FlowDiagramTheme = {
        canvasBg: resolveColor('var(--aw-canvas-deep)'),
        nodeBg: resolveColor('var(--aw-bg-1)'),
        textPrimary: resolveColor('var(--aw-text-0)'),
        textMuted: resolveColor('var(--aw-text-3)'),
        edgeColor: resolveColor('var(--aw-bg-3)'),
        dotColor: resolveColor('var(--aw-bg-2)'),
      };
      const { svg, width, height } = flowDiagramToSvg(nodes, edges, theme, `${title} — Flow Diagram`);
      const blob = await svgToPngBlob(svg, width, height, 2);
      downloadBlob(blob, `${fileBase}-flow-diagram.png`);
    } catch (err) {
      console.error('Flow diagram export failed', err);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const handlePreview = () => {
    if (!rootAgent) return;
    setPreview(buildArtifacts());
    setOpen(false);
  };

  const downloadPreviewPng = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const blob = await svgToPngBlob(preview.svg, preview.width, preview.height, 2);
      downloadBlob(blob, `${fileBase}-hierarchy.png`);
    } catch (err) {
      console.error('PNG export failed', err);
    } finally {
      setBusy(false);
    }
  };

  const copyPreviewText = async () => {
    if (!preview) return;
    const ok = await copyTextToClipboard(preview.text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={!rootAgent}
        title="Export hierarchy"
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors',
          'border-[var(--aw-bg-3)] text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] disabled:opacity-40 disabled:cursor-not-allowed',
          open && 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]',
        )}
      >
        {copied ? <Check className="h-3 w-3 text-[var(--aw-green)]" /> : <Download className="h-3 w-3" />}
        <span>{copied ? 'Copied' : 'Export'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] rounded-md shadow-xl py-1">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--aw-text-3)]">Export hierarchy</div>
          <button
            onClick={handlePreview}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--aw-text-1)] hover:bg-[var(--aw-bg-2)] hover:text-[var(--aw-text-0)] transition-colors text-left"
          >
            <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--aw-text-2)]" />
            Preview…
          </button>
          <button
            onClick={handleCopy}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--aw-text-1)] hover:bg-[var(--aw-bg-2)] hover:text-[var(--aw-text-0)] transition-colors text-left"
          >
            <Copy className="h-3.5 w-3.5 shrink-0 text-[var(--aw-text-2)]" />
            Copy as text
          </button>
          <button
            onClick={handlePng}
            disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--aw-text-1)] hover:bg-[var(--aw-bg-2)] hover:text-[var(--aw-text-0)] transition-colors text-left disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[var(--aw-text-2)]" />}
            Export as PNG
          </button>
          <div className="my-1 border-t border-[var(--aw-bg-2)]" />
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--aw-text-3)]">Flow diagram</div>
          <button
            onClick={handleFlowDiagram}
            disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--aw-text-1)] hover:bg-[var(--aw-bg-2)] hover:text-[var(--aw-text-0)] transition-colors text-left disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <GitFork className="h-3.5 w-3.5 shrink-0 text-[var(--aw-text-2)]" />}
            Export as PNG
          </button>
        </div>
      )}

      {preview && (
        <HierarchyPreviewModal
          title={title}
          text={preview.text}
          svg={preview.svg}
          width={preview.width}
          height={preview.height}
          copied={copied}
          busy={busy}
          onCopy={copyPreviewText}
          onDownloadPng={downloadPreviewPng}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

interface PreviewModalProps {
  title: string;
  text: string;
  svg: string;
  width: number;
  height: number;
  copied: boolean;
  busy: boolean;
  onCopy: () => void;
  onDownloadPng: () => void;
  onClose: () => void;
}

function HierarchyPreviewModal({
  title, text, svg, width, height, copied, busy, onCopy, onDownloadPng, onClose,
}: PreviewModalProps) {
  const [tab, setTab] = useState<'text' | 'image'>('text');
  const nodeCount = text ? text.split('\n').length : 0;
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-3xl max-h-[85vh] bg-[var(--aw-bg-0)] border border-[var(--aw-bg-3)] rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--aw-bg-2)] shrink-0">
          <Download className="h-4 w-4 text-[var(--aw-text-2)] shrink-0" />
          <span className="text-sm font-semibold text-[var(--aw-text-0)] shrink-0">Export hierarchy</span>
          <span className="text-xs text-[var(--aw-text-3)] truncate">· {title} · {nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
          <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded bg-[var(--aw-bg-1)] border border-[var(--aw-bg-2)] shrink-0">
            {(['text', 'image'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-2.5 py-1 rounded text-[11px] font-medium transition-colors capitalize',
                  tab === t ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)]' : 'text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)]',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="shrink-0 p-1 rounded text-[var(--aw-text-2)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-[var(--aw-bg-4)] p-4">
          {tab === 'text' ? (
            <pre className="text-[12px] leading-relaxed font-mono text-[var(--aw-text-1)] whitespace-pre">{text}</pre>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={svgDataUrl} alt="Agent hierarchy" width={width} height={height} className="max-w-none rounded-md" />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--aw-bg-2)] shrink-0">
          <span className="text-[11px] text-[var(--aw-text-3)]">Reflects the current tree, order &amp; expand/collapse state.</span>
          <div className="flex-1" />
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-[var(--aw-bg-3)] text-[var(--aw-text-1)] hover:text-[var(--aw-text-0)] hover:bg-[var(--aw-bg-2)] transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[var(--aw-green)]" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy as text'}
          </button>
          <button
            onClick={onDownloadPng}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--aw-blue-action)] text-white hover:bg-[var(--aw-blue-action-hover)] disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            Download PNG
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
