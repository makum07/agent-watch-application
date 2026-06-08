'use client';

import { Group, Panel, Separator } from 'react-resizable-panels';
import { GripVertical } from 'lucide-react';
import { useWorkspaceStore } from '@/store/workspace-store';
import { Pane } from './pane';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LayoutNode } from '@/types/workspace';

interface WorkspaceShellProps {
  sessionId: string;
}

function findPaneById(node: LayoutNode, paneId: string): Extract<LayoutNode, { type: 'pane' }> | null {
  if (node.type === 'pane') return node.id === paneId ? node : null;
  return findPaneById(node.children[0], paneId) ?? findPaneById(node.children[1], paneId);
}

export function WorkspaceShell({ sessionId }: WorkspaceShellProps) {
  const { layout, maximizedPaneId } = useWorkspaceStore();

  if (!layout) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground flex-col gap-3">
        <Plus className="h-8 w-8 opacity-20" />
        <p className="text-sm opacity-50">Drag agents from the sidebar to create panes</p>
      </div>
    );
  }

  // Maximized mode — render only the focused pane full-height
  if (maximizedPaneId) {
    const pane = findPaneById(layout, maximizedPaneId);
    if (pane) {
      return (
        <div className="h-full overflow-hidden">
          <Pane paneId={pane.id} tabs={pane.tabs} activeTab={pane.activeTab} sessionId={sessionId} />
        </div>
      );
    }
  }

  return (
    <div className="h-full p-1 overflow-hidden">
      {renderRoot(layout, sessionId)}
    </div>
  );
}

// Root node: single pane renders as plain div (no Panel/Group needed).
// Split renders as a Group directly.
function renderRoot(node: LayoutNode, sessionId: string): React.ReactNode {
  if (node.type === 'pane') {
    return (
      <div className="h-full overflow-hidden">
        <Pane
          paneId={node.id}
          tabs={node.tabs}
          activeTab={node.activeTab}
          sessionId={sessionId}
        />
      </div>
    );
  }

  return (
    <Group
      id={node.id}
      orientation={node.direction}
      className="h-full"
      style={{ display: 'flex', flexDirection: node.direction === 'vertical' ? 'column' : 'row', height: '100%' }}
    >
      {renderChild(node.children[0], sessionId)}
      <ResizeSeparator />
      {renderChild(node.children[1], sessionId)}
    </Group>
  );
}

// Child node: always wrapped in Panel (required by react-resizable-panels).
// Nested splits wrap the inner Group in a Panel.
function renderChild(node: LayoutNode, sessionId: string): React.ReactNode {
  if (node.type === 'pane') {
    return (
      <Panel key={node.id} id={node.id} minSize={10} defaultSize={50}>
        <div className="h-full overflow-hidden">
          <Pane
            paneId={node.id}
            tabs={node.tabs}
            activeTab={node.activeTab}
            sessionId={sessionId}
          />
        </div>
      </Panel>
    );
  }

  // Nested split: wrap the inner Group in a Panel so the parent Group can resize it
  return (
    <Panel key={node.id} id={node.id} minSize={10} defaultSize={50}>
      <Group
        id={`inner-${node.id}`}
        orientation={node.direction}
        style={{ display: 'flex', flexDirection: node.direction === 'vertical' ? 'column' : 'row', height: '100%', width: '100%' }}
      >
        {renderChild(node.children[0], sessionId)}
        <ResizeSeparator />
        {renderChild(node.children[1], sessionId)}
      </Group>
    </Panel>
  );
}

function ResizeSeparator() {
  return (
    <Separator
      className={cn(
        'relative flex items-center justify-center bg-border flex-shrink-0',
        'data-[orientation=horizontal]:w-1 data-[orientation=horizontal]:cursor-col-resize',
        'data-[orientation=vertical]:h-1 data-[orientation=vertical]:w-full data-[orientation=vertical]:cursor-row-resize',
        'hover:bg-primary/50 transition-colors'
      )}
    >
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border opacity-70">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    </Separator>
  );
}
