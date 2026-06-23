'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, Copy, Image as ImageIcon, Check, Loader2, Eye, X } from 'lucide-react';
import { cn, formatTokens, formatDuration, formatCost, estimateAgentCost } from '@/lib/utils';
import { getAgentDisplay, getStatusDisplay } from '@/lib/agent-display';
import {
  hierarchyToText,
  hierarchyToSvg,
  svgToPngBlob,
  downloadBlob,
  copyTextToClipboard,
  type ExportNode,
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
      color: color.text,
      collapsed,
      hiddenChildCount: collapsed ? countDescendants(agent, agentMap, new Set()) : 0,
      children: collapsed ? [] : kids.map(c => build(c, seen)),
    };
  };
  return build(root, new Set([root.id]));
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
          'border-[#30363d] text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#21262d] disabled:opacity-40 disabled:cursor-not-allowed',
          open && 'bg-[#21262d] text-[#e6edf3]',
        )}
      >
        {copied ? <Check className="h-3 w-3 text-[#3fb950]" /> : <Download className="h-3 w-3" />}
        <span>{copied ? 'Copied' : 'Export'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-[#161b22] border border-[#30363d] rounded-md shadow-xl py-1">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[#6e7681]">Export hierarchy</div>
          <button
            onClick={handlePreview}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors text-left"
          >
            <Eye className="h-3.5 w-3.5 shrink-0 text-[#8b949e]" />
            Preview…
          </button>
          <button
            onClick={handleCopy}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors text-left"
          >
            <Copy className="h-3.5 w-3.5 shrink-0 text-[#8b949e]" />
            Copy as text
          </button>
          <button
            onClick={handlePng}
            disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors text-left disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#8b949e]" />}
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
        className="flex flex-col w-full max-w-3xl max-h-[85vh] bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#21262d] shrink-0">
          <Download className="h-4 w-4 text-[#8b949e] shrink-0" />
          <span className="text-sm font-semibold text-[#e6edf3] shrink-0">Export hierarchy</span>
          <span className="text-xs text-[#6e7681] truncate">· {title} · {nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
          <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded bg-[#161b22] border border-[#21262d] shrink-0">
            {(['text', 'image'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-2.5 py-1 rounded text-[11px] font-medium transition-colors capitalize',
                  tab === t ? 'bg-[#21262d] text-[#e6edf3]' : 'text-[#6e7681] hover:text-[#c9d1d9]',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="shrink-0 p-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-[#010409] p-4">
          {tab === 'text' ? (
            <pre className="text-[12px] leading-relaxed font-mono text-[#c9d1d9] whitespace-pre">{text}</pre>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={svgDataUrl} alt="Agent hierarchy" width={width} height={height} className="max-w-none rounded-md" />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[#21262d] shrink-0">
          <span className="text-[11px] text-[#6e7681]">Reflects the current tree, order &amp; expand/collapse state.</span>
          <div className="flex-1" />
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-[#30363d] text-[#c9d1d9] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[#3fb950]" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy as text'}
          </button>
          <button
            onClick={onDownloadPng}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1f6feb] text-white hover:bg-[#388bfd] disabled:opacity-50 transition-colors"
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
