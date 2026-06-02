'use client';

import { useState } from 'react';
import { ChevronRight, Terminal, FileText, Search, Globe, Code2, Wrench, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContentBlock } from '@/types/session';
import { ArtifactCard } from './artifact-card';

// Tools that write files — rendered as artifact cards instead of generic tool cards
const ARTIFACT_WRITE_TOOLS = new Set(['Write', 'NotebookEdit']);
const ARTIFACT_EDIT_TOOLS = new Set(['Edit']);

const TOOL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Bash: Terminal,
  Read: FileText,
  Write: FileText,
  Edit: FileText,
  NotebookEdit: FileText,
  Grep: Search,
  Glob: Search,
  WebSearch: Globe,
  WebFetch: Globe,
  Agent: Code2,
  Task: Code2,
  Workflow: Code2,
  AskUserQuestion: Code2,
};

function ToolIcon({ name }: { name: string }) {
  const Icon = TOOL_ICONS[name] || Wrench;
  return <Icon className="h-3.5 w-3.5" />;
}

function extractResultText(content: ContentBlock[] | undefined): string {
  if (!content || content.length === 0) return '';
  return content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('\n')
    .trim();
}

function getToolSummary(name: string, input: Record<string, unknown>): string {
  if (name === 'Read') return String(input.file_path || '').split(/[/\\]/).slice(-2).join('/');
  if (name === 'Write' || name === 'Edit') return String(input.file_path || '').split(/[/\\]/).slice(-2).join('/');
  if (name === 'Bash') return String(input.command || '').slice(0, 60);
  if (name === 'Grep') return `"${String(input.pattern || '')}"`;
  if (name === 'Glob') return String(input.pattern || '');
  if (name === 'Agent' || name === 'Task') return String(input.description || input.prompt || '').slice(0, 60);
  if (name === 'Workflow') return String(input.description || '').slice(0, 60);
  if (name === 'WebSearch') return String(input.query || '').slice(0, 60);
  if (name === 'WebFetch') return String(input.url || '').slice(0, 60);
  return JSON.stringify(input).slice(0, 60);
}

const AGENT_SPAWN_TOOLS = new Set(['Agent', 'Task', 'Workflow']);

interface ToolCallWithResultProps {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: ContentBlock[];
  isError?: boolean;
}

export function ToolCallWithResult({ id, name, input, result, isError, paneId = '' }: ToolCallWithResultProps & { paneId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isAgentSpawn = AGENT_SPAWN_TOOLS.has(name);

  // Artifact write tools — render as rich artifact card instead of generic tool card
  if (ARTIFACT_WRITE_TOOLS.has(name) || ARTIFACT_EDIT_TOOLS.has(name)) {
    const filePath = String(input?.file_path || input?.notebook_path || '');
    const content = String(
      input?.content ||       // Write
      input?.new_string ||    // Edit (show what was written)
      input?.source ||        // NotebookEdit
      ''
    );
    const operationType: 'create' | 'modify' = ARTIFACT_WRITE_TOOLS.has(name) ? 'create' : 'modify';
    if (filePath && content) {
      return (
        <ArtifactCard
          toolId={id}
          operationType={operationType}
          filePath={filePath}
          content={content}
          paneId={paneId}
        />
      );
    }
  }
  const hasResult = result && result.length > 0;
  const resultText = extractResultText(result);
  const summary = getToolSummary(name, input);

  // Color coding by tool type
  const borderColor = isError ? '#f85149'
    : isAgentSpawn ? '#58a6ff'
    : name === 'Write' || name === 'Edit' ? '#f0883e'
    : '#30363d';

  const iconColor = isError ? '#f85149'
    : isAgentSpawn ? '#58a6ff'
    : name === 'Write' || name === 'Edit' ? '#f0883e'
    : name === 'Bash' ? '#39d353'
    : '#8b949e';

  return (
    <div
      className="rounded border text-xs overflow-hidden"
      style={{ borderColor, backgroundColor: `${borderColor}08` }}
    >
      {/* Header — always visible */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#161b22] transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ color: iconColor }}>
          <ToolIcon name={name} />
        </span>
        <span className="font-semibold text-[#e6edf3]">{name}</span>
        {summary && (
          <span className="text-[#8b949e] font-mono truncate flex-1 text-[11px]">{summary}</span>
        )}
        {isError && <span className="text-[#f85149] text-[10px] font-medium shrink-0">ERROR</span>}
        {hasResult && !isError && (
          <span className="text-[#484f58] text-[10px] shrink-0">
            {resultText.length > 0 ? `${resultText.split('\n').length} lines` : '✓'}
          </span>
        )}
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-[#484f58] transition-transform', expanded && 'rotate-90')} />
      </button>

      {/* Expanded: input + result */}
      {expanded && (
        <div className="border-t px-3 py-2 space-y-2" style={{ borderColor: `${borderColor}30` }}>
          {/* Input */}
          <div>
            <div className="text-[10px] text-[#484f58] font-semibold mb-1 uppercase tracking-wider">Input</div>
            <pre className="text-[11px] font-mono text-[#c9d1d9] bg-[#0d1117] rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">
              {formatInput(name, input)}
            </pre>
          </div>

          {/* Result */}
          {hasResult && (
            <div>
              <div className={cn(
                'text-[10px] font-semibold mb-1 uppercase tracking-wider',
                isError ? 'text-[#f85149]' : 'text-[#3fb950]'
              )}>
                {isError ? 'Error' : 'Output'}
              </div>
              <pre className={cn(
                'text-[11px] font-mono rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap',
                isError ? 'text-[#f85149] bg-[#f85149]/5' : 'text-[#c9d1d9] bg-[#0d1117]'
              )}>
                {resultText || '(empty)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return String(input.command || '');
  if (name === 'Read') return String(input.file_path || '');
  if (name === 'Write') return `${input.file_path}\n\n${String(input.content || '').slice(0, 300)}${String(input.content || '').length > 300 ? '…' : ''}`;
  if (name === 'Grep') return `pattern: ${input.pattern}\npath: ${input.path || '(all)'}`;
  if (name === 'Glob') return String(input.pattern || '');
  if (name === 'Agent' || name === 'Task') return String(input.prompt || input.description || '');
  return JSON.stringify(input, null, 2);
}
