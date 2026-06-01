# Next.js Architecture

## AgentWatch v2.0

**Date:** 2026-06-01
**Status:** Draft
**Supersedes:** Frontend sections of `03-TECHNICAL-ARCHITECTURE.md`, Dockerfile/Compose in `06-DEPLOYMENT-ARCHITECTURE.md`

---

## 1. Technology Stack

### 1.1 Core Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Framework | Next.js | 15.x | Full-stack React framework (App Router) |
| Runtime | Node.js | 20 LTS | Server runtime |
| Language | TypeScript | 5.x | Type safety across client and server |
| UI Library | React | 19.x | Component model |
| Components | shadcn/ui | latest | Accessible primitives (Radix UI based) |
| Styling | Tailwind CSS | 4.x | Utility-first CSS |
| Database | better-sqlite3 | 12.x | SQLite with FTS5 |
| WebSocket | ws | 8.x | Real-time updates |
| File Watching | chokidar | 3.x | JSONL file monitoring |
| Markdown | react-markdown + remark-gfm | latest | Message rendering |
| Syntax Highlighting | shiki | latest | Code block highlighting (same engine as VS Code) |
| Charts | recharts | 2.x | Analytics charts (built on D3) |
| Canvas | @use-gesture/react + custom | latest | Timeline zoom/pan |

### 1.2 Dev Dependencies

| Tool | Purpose |
|------|---------|
| ESLint + next/eslint | Linting |
| Prettier + prettier-plugin-tailwindcss | Formatting |
| Vitest | Unit/integration testing |
| Playwright | E2E testing |
| @testing-library/react | Component testing |

### 1.3 Why These Choices

**Next.js App Router over Pages Router:**
- Server Components for data-heavy views (dashboard, session list) — zero client JS for read-only pages
- Server Actions for mutations (pin session, save preferences)
- Streaming/Suspense for progressive loading of large sessions
- Built-in file-based routing matches the application's page structure naturally
- Parallel routes for potential future modal patterns

**shadcn/ui over building from scratch:**
- `ResizablePanelGroup` (react-resizable-panels): Near-exact match for the multi-pane workspace. Handles horizontal/vertical splits, resize handles, minimum sizes, keyboard accessibility — all requirements from the PRD.
- `Tabs`: Agent pane tab rail (Conversation, Artifacts, Context, Tools, Summary)
- `Command` (cmdk): Session search with fuzzy matching, keyboard navigation
- `Dialog`: Resume dialog, save layout dialog
- `Collapsible`: Tool call expansion, agent hierarchy tree
- `DropdownMenu`: Layout picker, session card actions
- `Tooltip`: Timeline bar tooltips, agent badges
- `Badge`: Agent status, artifact operation type
- `Card`: Session cards, artifact cards, inline artifact cards
- `ScrollArea`: Virtual scrolling wrapper for long lists
- `Sheet`: Mobile sidebar drawer
- All components are copy-pasted (not npm-installed), fully customizable, and accessible by default.

**Tailwind over CSS Modules:**
- Design token consistency via `tailwind.config.ts` (matches the color palette from the design spec)
- Rapid iteration on layout-heavy UI (the workspace is 90% layout)
- `cn()` utility for conditional classes (cleaner than CSS Module composition)
- Dark mode built-in via `dark:` variant

**TypeScript over JavaScript:**
- The data model has 15+ entity types with complex relationships — TypeScript catches shape mismatches at build time
- API routes benefit from typed request/response bodies
- Component props benefit from type checking (especially the recursive layout tree)

---

## 2. Architecture Overview

### 2.1 Monolith Architecture

```
+-----------------------------------------------------------------------+
|  Docker Container                                                     |
|                                                                       |
|  +----------------------------------------------------------------+  |
|  |  Custom server.js (Node.js)                                    |  |
|  |                                                                |  |
|  |  +--------------------------+  +-----------------------------+ |  |
|  |  | Next.js App              |  | WebSocket Server (ws)       | |  |
|  |  |                          |  |                             | |  |
|  |  | App Router               |  | Real-time events:           | |  |
|  |  |   Server Components      |  |   session_update            | |  |
|  |  |   Client Components      |  |   agent_message             | |  |
|  |  |   API Routes             |  |   tool_call                 | |  |
|  |  |   Server Actions         |  |   artifact_created          | |  |
|  |  +--------------------------+  +-----------------------------+ |  |
|  |                                                                |  |
|  |  +----------------------------------------------------------+ |  |
|  |  |  Service Layer (shared by API routes + Server Components) | |  |
|  |  |                                                          | |  |
|  |  |  SessionIngester   AgentGraphEngine   ArtifactTracker    | |  |
|  |  |  ContextAnalyzer   DebugAnalyzer      SessionHistory     | |  |
|  |  |  WorkspaceSnapshots  Preferences      FileWatcher        | |  |
|  |  +----------------------------------------------------------+ |  |
|  |                                                                |  |
|  |  +----------------------------------------------------------+ |  |
|  |  |  Data Layer                                              | |  |
|  |  |                                                          | |  |
|  |  |  SQLite (better-sqlite3)  |  JSONL Parser  |  DataCache | |  |
|  |  +----------------------------------------------------------+ |  |
|  +----------------------------------------------------------------+  |
|                                                                       |
|  Volumes:                                                             |
|    /home/appuser/.claude  (read-only)  -->  ~/.claude                 |
|    /data                  (read-write) -->  agentwatch-data volume        |
+-----------------------------------------------------------------------+
```

### 2.2 Custom Server

Next.js doesn't natively support WebSocket in API routes. A custom `server.ts` wraps the Next.js request handler and attaches a `ws` WebSocket server to the same HTTP server:

```typescript
// server.ts
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { initServices } from './lib/services';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url!, true));
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  const services = initServices(wss);

  // Attach services to global for access from API routes
  (globalThis as any).__services = services;

  server.listen(3456, () => {
    console.log('> Ready on http://localhost:3456');
  });
});
```

### 2.3 Server vs Client Component Split

The key architectural decision is which components render on the server vs. client:

| Component | Rendering | Rationale |
|-----------|-----------|-----------|
| Root layout (sidebar) | Server | Static navigation, no interactivity |
| Home dashboard | Server | Data fetching, list rendering |
| Session cards | Server | Read-only display |
| Session search | Client | Keyboard events, real-time filtering |
| Resume dialog | Client | User interaction |
| Workspace container | Client | Complex state: drag-and-drop, resize, pane management |
| Agent pane (all tabs) | Client | Scroll state, expand/collapse, WebSocket updates |
| Timeline | Client | Canvas rendering, zoom/pan gestures |
| Agent graph | Client | SVG rendering, force layout, zoom/pan |
| Artifact viewer | Server (content) + Client (interactions) | Content is static, interactions are not |
| Analytics charts | Client | Interactive charts |
| Session-wide search results | Client | Real-time filtering |
| Global search (Command) | Client | Keyboard events, fuzzy search |

**Rule of thumb:** If a component needs `useState`, `useEffect`, event handlers, or browser APIs, it's a Client Component. Everything else is a Server Component.

---

## 3. Project Structure

### 3.1 Directory Layout

```
agentwatch/
├── app/                                    # Next.js App Router
│   ├── layout.tsx                          # Root layout (AppShell, providers)
│   ├── page.tsx                            # Home dashboard (Server Component)
│   ├── loading.tsx                         # Home loading skeleton
│   ├── session/
│   │   └── [id]/
│   │       ├── layout.tsx                  # Session layout (sidebar + content)
│   │       ├── page.tsx                    # Resume dialog / entry point
│   │       ├── loading.tsx                 # Session loading skeleton
│   │       ├── workspace/
│   │       │   └── page.tsx                # Workspace view (Client Component)
│   │       ├── timeline/
│   │       │   └── page.tsx                # Full-page timeline
│   │       ├── artifacts/
│   │       │   └── page.tsx                # Session artifact explorer
│   │       └── analytics/
│   │           └── page.tsx                # Session analytics
│   ├── api/
│   │   └── v2/
│   │       ├── sessions/
│   │       │   ├── route.ts                # GET /api/v2/sessions
│   │       │   └── [id]/
│   │       │       ├── route.ts            # GET /api/v2/sessions/:id
│   │       │       ├── agents/
│   │       │       │   ├── route.ts        # GET /api/v2/sessions/:id/agents
│   │       │       │   └── [agentId]/
│   │       │       │       ├── route.ts    # GET agents/:agentId
│   │       │       │       ├── messages/
│   │       │       │       │   └── route.ts
│   │       │       │       └── artifacts/
│   │       │       │           └── route.ts
│   │       │       ├── timeline/
│   │       │       │   └── route.ts
│   │       │       ├── artifacts/
│   │       │       │   └── route.ts
│   │       │       ├── analytics/
│   │       │       │   └── route.ts
│   │       │       └── search/
│   │       │           └── route.ts
│   │       ├── history/
│   │       │   ├── route.ts                # GET/POST /api/v2/history
│   │       │   ├── search/
│   │       │   │   └── route.ts            # POST /api/v2/history/search
│   │       │   └── [sessionId]/
│   │       │       └── route.ts            # GET/PUT/DELETE
│   │       ├── workspaces/
│   │       │   └── [sessionId]/
│   │       │       ├── route.ts            # GET/POST
│   │       │       ├── latest/
│   │       │       │   └── route.ts        # GET latest auto-save
│   │       │       └── [snapshotId]/
│   │       │           └── route.ts        # PUT/DELETE
│   │       └── preferences/
│   │           ├── route.ts                # GET all
│   │           └── [key]/
│   │               └── route.ts            # PUT
│   └── globals.css                         # Tailwind directives + CSS variables
│
├── components/                             # React components
│   ├── ui/                                 # shadcn/ui primitives (auto-generated)
│   │   ├── badge.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── collapsible.tsx
│   │   ├── command.tsx
│   │   ├── dialog.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── resizable.tsx                   # ResizablePanelGroup
│   │   ├── scroll-area.tsx
│   │   ├── separator.tsx
│   │   ├── sheet.tsx
│   │   ├── tabs.tsx
│   │   ├── tooltip.tsx
│   │   └── ...
│   ├── home/                               # Home dashboard components
│   │   ├── session-card.tsx
│   │   ├── pinned-sessions.tsx
│   │   ├── recent-sessions.tsx
│   │   ├── session-search.tsx              # Uses Command (cmdk)
│   │   ├── session-filters.tsx
│   │   ├── tag-manager.tsx
│   │   └── open-by-id.tsx
│   ├── session/                            # Session-level components
│   │   ├── resume-dialog.tsx
│   │   ├── session-header.tsx
│   │   ├── agent-sidebar.tsx
│   │   ├── agent-tree.tsx                  # Recursive tree with Collapsible
│   │   └── agent-tree-node.tsx
│   ├── workspace/                          # Multi-pane workspace
│   │   ├── workspace-provider.tsx          # Context provider for workspace state
│   │   ├── workspace-shell.tsx             # ResizablePanelGroup orchestrator
│   │   ├── pane.tsx                        # Single pane wrapper
│   │   ├── pane-header.tsx                 # Title bar with controls
│   │   ├── pane-tab-bar.tsx                # Tab bar for stacked views
│   │   ├── layout-dropdown.tsx             # Layout picker (presets + saved)
│   │   ├── drop-zone-overlay.tsx           # Drag-and-drop target zones
│   │   └── workspace-persistence.tsx       # Auto-save hook
│   ├── agent/                              # Agent pane content
│   │   ├── agent-view.tsx                  # Tab container (uses shadcn Tabs)
│   │   ├── conversation-tab.tsx            # Message thread
│   │   ├── artifacts-tab.tsx               # Produced/consumed list
│   │   ├── context-tab.tsx                 # Prompt/response
│   │   ├── tools-tab.tsx                   # Tool call log
│   │   ├── summary-tab.tsx                 # Metadata
│   │   ├── agent-message.tsx               # Single message card
│   │   ├── tool-call-card.tsx              # Expandable tool call
│   │   ├── inline-artifact-card.tsx        # Artifact in message flow
│   │   ├── artifact-lineage.tsx            # Horizontal lineage strip
│   │   └── agent-badge.tsx                 # Status/type badge
│   ├── visualization/                      # Data visualizations
│   │   ├── timeline-view.tsx               # Canvas timeline
│   │   ├── timeline-canvas.tsx             # Canvas rendering logic
│   │   ├── agent-graph-view.tsx            # SVG hierarchy graph
│   │   ├── context-flow-view.tsx           # Context DAG
│   │   └── token-chart.tsx                 # Token usage (recharts)
│   ├── artifacts/                          # Session-wide artifact views
│   │   ├── artifact-explorer.tsx           # File tree + preview
│   │   ├── artifact-viewer.tsx             # Content viewer
│   │   ├── artifact-diff.tsx               # Diff view
│   │   └── artifact-content-pane.tsx       # Dedicated pane view
│   ├── analytics/                          # Analytics components
│   │   ├── session-analytics.tsx           # Summary dashboard
│   │   ├── debug-alerts.tsx                # Issue detection
│   │   └── cost-breakdown.tsx              # Cost analysis
│   └── shared/                             # Shared utilities
│       ├── code-block.tsx                  # Shiki syntax highlighting
│       ├── markdown-renderer.tsx           # react-markdown wrapper
│       ├── virtual-list.tsx                # Virtual scrolling
│       ├── drag-drop-context.tsx           # DnD provider
│       └── websocket-provider.tsx          # WebSocket context
│
├── lib/                                    # Server-side logic
│   ├── services/                           # Business logic (runs on server only)
│   │   ├── index.ts                        # Service initialization + singleton
│   │   ├── session-ingester.ts
│   │   ├── agent-graph-engine.ts
│   │   ├── artifact-tracker.ts
│   │   ├── context-analyzer.ts
│   │   ├── debug-analyzer.ts
│   │   ├── session-history.ts
│   │   ├── workspace-snapshots.ts
│   │   ├── preferences.ts
│   │   └── file-watcher.ts
│   ├── db/                                 # Database layer
│   │   ├── database.ts                     # SQLite connection + schema
│   │   ├── migrations.ts                   # Schema migrations
│   │   ├── queries/                        # Prepared statements
│   │   │   ├── sessions.ts
│   │   │   ├── agents.ts
│   │   │   ├── artifacts.ts
│   │   │   ├── history.ts
│   │   │   ├── workspaces.ts
│   │   │   └── search.ts
│   │   └── cache.ts                        # LRU cache
│   ├── parser/                             # JSONL parsing
│   │   ├── jsonl-parser.ts                 # Stream parser
│   │   ├── agent-correlator.ts             # Parent-child matching
│   │   └── artifact-extractor.ts           # File write/edit detection
│   └── websocket/                          # WebSocket server
│       ├── ws-server.ts                    # WebSocket setup
│       └── events.ts                       # Event types and handlers
│
├── hooks/                                  # React hooks
│   ├── use-session.ts                      # Session data fetching
│   ├── use-agent-messages.ts               # Paginated agent messages
│   ├── use-workspace.ts                    # Workspace layout state
│   ├── use-workspace-persistence.ts        # Auto-save/restore
│   ├── use-websocket.ts                    # WebSocket connection
│   ├── use-search.ts                       # Search state
│   └── use-preferences.ts                  # User preferences
│
├── types/                                  # TypeScript types
│   ├── session.ts                          # Session, Agent, Message, Artifact
│   ├── workspace.ts                        # LayoutNode, PaneTab, WorkspaceSnapshot
│   ├── history.ts                          # SessionHistory
│   ├── api.ts                              # API request/response types
│   └── events.ts                           # WebSocket event types
│
├── store/                                  # Client-side state management
│   ├── workspace-store.ts                  # Zustand store for workspace
│   ├── session-store.ts                    # Current session state
│   └── search-store.ts                     # Search state
│
├── server.ts                               # Custom server (Next.js + WebSocket)
├── next.config.ts                          # Next.js configuration
├── tailwind.config.ts                      # Tailwind + design tokens
├── tsconfig.json                           # TypeScript config
├── components.json                         # shadcn/ui config
├── package.json
├── Dockerfile
├── docker-compose.yml
└── ...
```

### 3.2 Key Architectural Boundaries

```
                    ┌─────────────────────────────────────┐
                    │        "use client" boundary         │
                    │                                     │
  Server            │  Client                             │
  ──────            │  ──────                             │
                    │                                     │
  app/page.tsx      │  components/workspace/*             │
  app/session/      │  components/agent/*                 │
    [id]/page.tsx   │  components/visualization/*         │
  app/api/v2/*      │  components/home/session-search.tsx │
  lib/services/*    │  store/*                            │
  lib/db/*          │  hooks/*                            │
  lib/parser/*      │                                     │
                    │                                     │
                    └─────────────────────────────────────┘

  Server Components          Client Components
  fetch data directly        use hooks, state, effects
  from lib/services          call API routes for mutations
  via function calls         connect to WebSocket
  zero client JS             full interactivity
```

---

## 4. Routing

### 4.1 Page Routes

| Route | Component | Rendering | Description |
|-------|-----------|-----------|-------------|
| `/` | `app/page.tsx` | Server | Home dashboard with recent/pinned sessions |
| `/session/[id]` | `app/session/[id]/page.tsx` | Server + Client | Resume dialog (fetches session + snapshot) |
| `/session/[id]/workspace` | `app/session/[id]/workspace/page.tsx` | Client | Multi-pane workspace |
| `/session/[id]/timeline` | `app/session/[id]/timeline/page.tsx` | Client | Full-page timeline |
| `/session/[id]/artifacts` | `app/session/[id]/artifacts/page.tsx` | Server + Client | Artifact explorer |
| `/session/[id]/analytics` | `app/session/[id]/analytics/page.tsx` | Server + Client | Analytics dashboard |

### 4.2 Session Layout

`app/session/[id]/layout.tsx` wraps all session pages with:
- Session header (title, project, quick stats)
- Agent sidebar (collapsible)
- Shared session data provider

```tsx
// app/session/[id]/layout.tsx
import { getSession } from '@/lib/services';
import { AgentSidebar } from '@/components/session/agent-sidebar';
import { SessionHeader } from '@/components/session/session-header';

export default async function SessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const session = await getSession(params.id);

  return (
    <div className="flex h-screen">
      <AgentSidebar session={session} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <SessionHeader session={session} />
        {children}
      </div>
    </div>
  );
}
```

### 4.3 API Routes

All API routes live under `app/api/v2/` and follow Next.js Route Handler conventions:

```typescript
// app/api/v2/sessions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServices } from '@/lib/services';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { sessionIngester } = getServices();
  const session = await sessionIngester.ingestSession(params.id);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(session);
}
```

---

## 5. Component Architecture

### 5.1 Workspace — shadcn ResizablePanelGroup

The multi-pane workspace maps directly to shadcn's `ResizablePanelGroup`:

```tsx
// components/workspace/workspace-shell.tsx
'use client';

import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useWorkspace } from '@/hooks/use-workspace';
import { Pane } from './pane';

export function WorkspaceShell() {
  const { layout, updateRatio } = useWorkspace();

  function renderNode(node: LayoutNode): React.ReactNode {
    if (node.type === 'pane') {
      return (
        <ResizablePanel key={node.id} minSize={15}>
          <Pane paneId={node.id} tabs={node.tabs} activeTab={node.activeTab} />
        </ResizablePanel>
      );
    }

    return (
      <ResizablePanelGroup
        key={`split-${node.children[0].id}`}
        direction={node.direction}
        onLayout={(sizes) => updateRatio(node, sizes)}
      >
        {renderNode(node.children[0])}
        <ResizableHandle withHandle />
        {renderNode(node.children[1])}
      </ResizablePanelGroup>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      {layout ? renderNode(layout) : <EmptyWorkspace />}
    </div>
  );
}
```

This replaces the custom workspace engine from the vanilla JS architecture. `react-resizable-panels` (which powers shadcn's `Resizable`) handles:
- Horizontal and vertical splits
- Drag-to-resize handles
- Minimum size enforcement
- Keyboard accessibility
- Nested panel groups (recursive splits)

### 5.2 Agent Pane — shadcn Tabs

```tsx
// components/agent/agent-view.tsx
'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ConversationTab } from './conversation-tab';
import { ArtifactsTab } from './artifacts-tab';
import { ContextTab } from './context-tab';
import { ToolsTab } from './tools-tab';
import { SummaryTab } from './summary-tab';

interface AgentViewProps {
  sessionId: string;
  agentId: string;
  activeSubTab?: string;
  onSubTabChange?: (tab: string) => void;
}

export function AgentView({ sessionId, agentId, activeSubTab = 'conversation', onSubTabChange }: AgentViewProps) {
  const { agent } = useAgent(sessionId, agentId);

  return (
    <Tabs value={activeSubTab} onValueChange={onSubTabChange} className="flex flex-col h-full">
      <TabsList className="border-b rounded-none bg-transparent px-2">
        <TabsTrigger value="conversation">Conversation</TabsTrigger>
        <TabsTrigger value="artifacts">
          Artifacts
          {agent?.artifacts.produced.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-xs">
              {agent.artifacts.produced.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="context">Context</TabsTrigger>
        <TabsTrigger value="tools">
          Tools
          {agent?.toolCallCount > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-xs">
              {agent.toolCallCount}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="summary">Summary</TabsTrigger>
      </TabsList>

      <TabsContent value="conversation" className="flex-1 overflow-hidden mt-0">
        <ConversationTab sessionId={sessionId} agentId={agentId} />
      </TabsContent>
      <TabsContent value="artifacts" className="flex-1 overflow-hidden mt-0">
        <ArtifactsTab sessionId={sessionId} agentId={agentId} />
      </TabsContent>
      <TabsContent value="context" className="flex-1 overflow-hidden mt-0">
        <ContextTab sessionId={sessionId} agentId={agentId} />
      </TabsContent>
      <TabsContent value="tools" className="flex-1 overflow-hidden mt-0">
        <ToolsTab sessionId={sessionId} agentId={agentId} />
      </TabsContent>
      <TabsContent value="summary" className="flex-1 overflow-hidden mt-0">
        <SummaryTab sessionId={sessionId} agentId={agentId} />
      </TabsContent>
    </Tabs>
  );
}
```

### 5.3 Session Search — shadcn Command

The home dashboard search uses shadcn's `Command` component (wraps cmdk):

```tsx
// components/home/session-search.tsx
'use client';

import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { useRouter } from 'next/navigation';

export function SessionSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { results, isLoading } = useSessionSearch(query);

  return (
    <Command className="rounded-lg border shadow-md">
      <CommandInput
        placeholder="Search sessions by ID, title, agent, artifact..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No sessions found.</CommandEmpty>
        {results?.pinned.length > 0 && (
          <CommandGroup heading="Pinned">
            {results.pinned.map(session => (
              <CommandItem
                key={session.sessionId}
                onSelect={() => router.push(`/session/${session.sessionId}`)}
              >
                {session.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Recent">
          {results?.recent.map(session => (
            <CommandItem
              key={session.sessionId}
              onSelect={() => router.push(`/session/${session.sessionId}`)}
            >
              {session.title}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
```

### 5.4 Agent Hierarchy — shadcn Collapsible

```tsx
// components/session/agent-tree-node.tsx
'use client';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AgentTreeNode({ agent, depth, onDragStart, onClick }) {
  const [isOpen, setIsOpen] = useState(depth < 2);
  const hasChildren = agent.children.length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab hover:bg-accent',
          'text-sm'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        draggable
        onDragStart={(e) => onDragStart(e, agent)}
        onClick={() => onClick(agent)}
      >
        {hasChildren && (
          <CollapsibleTrigger asChild>
            <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} />
          </CollapsibleTrigger>
        )}
        <Badge variant="outline" className={agentTypeColor(agent.subagentType)}>
          {agent.subagentType || 'Main'}
        </Badge>
        <span className="truncate flex-1">{agent.description || agent.subagentType || 'Orchestrator'}</span>
        <span className="text-muted-foreground text-xs">{formatTokens(agent.tokenUsage.total)}</span>
      </div>

      {hasChildren && (
        <CollapsibleContent>
          {agent.children.map(child => (
            <AgentTreeNode key={child.id} agent={child} depth={depth + 1} onDragStart={onDragStart} onClick={onClick} />
          ))}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
```

---

## 6. State Management

### 6.1 Zustand Stores

Zustand is the recommended state manager for Client Components. It's minimal, TypeScript-first, and works well with React Server Components (stores are client-only).

```typescript
// store/workspace-store.ts
import { create } from 'zustand';
import type { LayoutNode, PaneState } from '@/types/workspace';

interface WorkspaceStore {
  layout: LayoutNode | null;
  paneStates: Map<string, PaneState>;
  focusedPaneId: string | null;

  setLayout: (layout: LayoutNode) => void;
  splitPane: (paneId: string, direction: 'horizontal' | 'vertical', content: PaneTab) => void;
  closePane: (paneId: string) => void;
  setFocusedPane: (paneId: string) => void;
  updatePaneState: (paneId: string, updates: Partial<PaneState>) => void;
  addTabToPane: (paneId: string, tab: PaneTab) => void;
  setActiveTab: (paneId: string, index: number) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  layout: null,
  paneStates: new Map(),
  focusedPaneId: null,

  setLayout: (layout) => set({ layout }),

  splitPane: (paneId, direction, content) => {
    set(state => ({
      layout: splitNodeInTree(state.layout!, paneId, direction, content),
    }));
  },

  closePane: (paneId) => {
    set(state => ({
      layout: removeNodeFromTree(state.layout!, paneId),
      paneStates: (() => {
        const next = new Map(state.paneStates);
        next.delete(paneId);
        return next;
      })(),
    }));
  },

  // ... other actions
}));
```

```typescript
// store/session-store.ts
import { create } from 'zustand';

interface SessionStore {
  session: Session | null;
  agents: Agent[];
  agentMap: Map<string, Agent>;
  searchQuery: string;
  searchResults: SearchResult[] | null;
  filters: FilterState;

  setSession: (session: Session) => void;
  setSearchQuery: (query: string) => void;
  setFilters: (filters: Partial<FilterState>) => void;
}
```

### 6.2 Data Fetching Patterns

**Server Components (read-only pages):**
```tsx
// app/page.tsx (Home Dashboard)
import { getSessionHistory, getPinnedSessions } from '@/lib/services';

export default async function HomePage() {
  const [recent, pinned] = await Promise.all([
    getSessionHistory({ limit: 20, sort: 'lastOpened' }),
    getPinnedSessions(),
  ]);

  return (
    <div>
      <PinnedSessions sessions={pinned} />
      <RecentSessions sessions={recent} />
    </div>
  );
}
```

**Client Components (interactive data):**
```tsx
// hooks/use-agent-messages.ts
export function useAgentMessages(sessionId: string, agentId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    const res = await fetch(`/api/v2/sessions/${sessionId}/agents/${agentId}/messages?page=${page}&limit=50`);
    const data = await res.json();
    setMessages(prev => [...prev, ...data.messages]);
    setHasMore(data.hasMore);
    setPage(prev => prev + 1);
    setIsLoading(false);
  }, [sessionId, agentId, page, isLoading, hasMore]);

  useEffect(() => { loadMore(); }, [agentId]);

  return { messages, loadMore, hasMore, isLoading };
}
```

**Server Actions (mutations):**
```tsx
// app/actions.ts
'use server';

import { getServices } from '@/lib/services';
import { revalidatePath } from 'next/cache';

export async function pinSession(sessionId: string) {
  const { history } = getServices();
  await history.update(sessionId, { isPinned: true });
  revalidatePath('/');
}

export async function saveWorkspaceSnapshot(sessionId: string, snapshot: WorkspaceSnapshot) {
  const { workspaces } = getServices();
  await workspaces.saveSnapshot(sessionId, snapshot, true);
}
```

---

## 7. Tailwind Configuration

### 7.1 Design Tokens

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // shadcn/ui semantic colors (CSS variables set in globals.css)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },

        // Agent type colors
        agent: {
          orchestrator: '#58a6ff',
          explore: '#3fb950',
          plan: '#f0883e',
          general: '#bc8cff',
          'code-reviewer': '#f85149',
          workflow: '#39d353',
          default: '#8b949e',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'SF Mono', 'Cascadia Code', 'monospace'],
        sans: ['var(--font-sans)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

### 7.2 CSS Variables (Dark Theme)

```css
/* app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 92%;
    --card: 222.2 84% 6.5%;
    --card-foreground: 210 40% 92%;
    --popover: 222.2 84% 6.5%;
    --popover-foreground: 210 40% 92%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 84% 4.9%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 92%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 55.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 92%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 92%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
    --radius: 0.5rem;
  }
}
```

---

## 8. Docker Configuration

### 8.1 Dockerfile

```dockerfile
# ============================================================
# Stage 1: Dependencies
# ============================================================
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ============================================================
# Stage 2: Build
# ============================================================
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ============================================================
# Stage 3: Production Runtime
# ============================================================
FROM node:20-alpine AS runner

ARG APP_UID=1000
ARG APP_GID=1000

RUN addgroup -g ${APP_GID} appgroup && \
    adduser -u ${APP_UID} -G appgroup -s /bin/sh -D appuser && \
    mkdir -p /data && chown appuser:appgroup /data

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built Next.js output
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3456/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

EXPOSE 3456

# Use custom server for WebSocket support
CMD ["node", "server.js"]
```

**Key difference from the Express Dockerfile:** Next.js `standalone` output mode produces a self-contained `server.js` with all dependencies bundled. The image only needs the standalone output, static assets, and public directory — no `node_modules` folder in the final image.

### 8.2 next.config.ts

```typescript
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',  // Required for Docker (self-contained output)

  // Custom server port
  env: {
    PORT: '3456',
  },

  // Disable image optimization (no external image service needed)
  images: {
    unoptimized: true,
  },

  // Webpack configuration for better-sqlite3 (native module)
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('better-sqlite3');
    }
    return config;
  },

  // Experimental features
  experimental: {
    // Server Actions for mutations
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
```

### 8.3 Docker Compose

```yaml
version: '3.8'

services:
  agentwatch:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        APP_UID: ${APP_UID:-1000}
        APP_GID: ${APP_GID:-1000}
    container_name: agentwatch
    ports:
      - "${PORT:-3456}:3456"
    volumes:
      - "${CLAUDE_HOME:-~/.claude}:/home/appuser/.claude:ro"
      - "agentwatch-data:/data"
    environment:
      - NODE_ENV=production
      - CLAUDE_HOME=/home/appuser/.claude
      - CLAUDE_DB_PATH=/data/conversations.db
      - NODE_OPTIONS=--max-old-space-size=2048
      - PORT=3456
      - NEXT_TELEMETRY_DISABLED=1
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:noexec,nosuid,size=128m
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 512M
    restart: unless-stopped

volumes:
  agentwatch-data:
    name: agentwatch-db
```

### 8.4 Image Size

| Layer | Size |
|-------|------|
| Alpine base + Node.js | ~170 MB |
| Next.js standalone output | ~30 MB |
| Static assets (CSS, fonts) | ~5 MB |
| better-sqlite3 native module | ~8 MB |
| **Total** | **~213 MB** |

Smaller than the Express version (~252 MB) because `standalone` output bundles only the required dependencies, eliminating the full `node_modules`.

---

## 9. WebSocket Integration

### 9.1 Server Setup

```typescript
// lib/websocket/ws-server.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { SessionEvent } from '@/types/events';

export class WsServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('pong', () => { /* keepalive */ });
    });

    setInterval(() => {
      this.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      });
    }, 30000);
  }

  broadcast(event: SessionEvent) {
    const data = JSON.stringify(event);
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  }
}
```

### 9.2 Client Hook

```typescript
// hooks/use-websocket.ts
'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { SessionEvent } from '@/types/events';

export function useWebSocket(onEvent: (event: SessionEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onmessage = (e) => {
      const event: SessionEvent = JSON.parse(e.data);
      onEvent(event);
    };

    ws.onclose = () => {
      reconnectTimeout.current = setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, [onEvent]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      clearTimeout(reconnectTimeout.current);
    };
  }, [connect]);
}
```

---

## 10. Migration from Existing Codebase

### 10.1 What Gets Kept

| Existing File | Disposition |
|---------------|-------------|
| `src/analytics/core/ConversationAnalyzer.js` | Port to TypeScript as `lib/parser/jsonl-parser.ts` |
| `src/analytics/core/AgentAnalyzer.js` | Port to `lib/services/agent-graph-engine.ts` |
| `src/analytics/core/SessionAnalyzer.js` | Port to `lib/services/session-ingester.ts` |
| `src/analytics/data/DatabaseManager.js` | Port to `lib/db/database.ts` |
| `src/analytics/data/DatabaseBackend.js` | Port to `lib/db/database.ts` (merge) |
| `src/analytics/data/Indexer.js` | Port to `lib/services/session-ingester.ts` |
| `src/analytics/data/DataCache.js` | Port to `lib/db/cache.ts` |
| `src/analytics/core/FileWatcher.js` | Port to `lib/services/file-watcher.ts` |
| `src/analytics/notifications/WebSocketServer.js` | Port to `lib/websocket/ws-server.ts` |
| `src/chats-mobile.js` | Replaced entirely by Next.js app |
| `src/analytics-web/` | Replaced entirely by `app/` + `components/` |
| `test/` | Port tests to Vitest + @testing-library/react |

### 10.2 Migration Strategy

Phase 1 of the implementation starts fresh with the Next.js project structure. The existing JavaScript services are ported to TypeScript incrementally:

1. **Week 1:** Scaffold Next.js project, configure Tailwind + shadcn/ui, set up custom server with WebSocket
2. **Week 2:** Port DatabaseManager + Indexer to TypeScript (`lib/db/`)
3. **Week 2:** Port ConversationAnalyzer to TypeScript (`lib/parser/`)
4. **Week 3:** Build new SessionIngester and AgentGraphEngine services
5. **Week 4+:** Build UI components using ported services

The legacy Express server (`src/chats-mobile.js`) and vanilla JS frontend (`src/analytics-web/`) remain functional during development. They can be accessed on a different port for comparison. Once Phase 1 is complete, the legacy code is removed.

---

## 11. Package Dependencies

### 11.1 package.json (Production)

```json
{
  "name": "agentwatch",
  "version": "2.0.0",
  "private": true,
  "scripts": {
    "dev": "node server.ts",
    "build": "next build",
    "start": "NODE_ENV=production node server.js",
    "lint": "next lint",
    "test": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",

    "better-sqlite3": "^12.0.0",
    "ws": "^8.18.0",
    "chokidar": "^3.5.0",

    "zustand": "^5.0.0",
    "react-resizable-panels": "^2.0.0",
    "cmdk": "^1.0.0",
    "@radix-ui/react-collapsible": "^1.0.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-dropdown-menu": "^2.0.0",
    "@radix-ui/react-tabs": "^1.0.0",
    "@radix-ui/react-tooltip": "^1.0.0",
    "@radix-ui/react-scroll-area": "^1.0.0",

    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "shiki": "^1.0.0",
    "recharts": "^2.12.0",
    "@use-gesture/react": "^10.0.0",

    "lucide-react": "^0.400.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0",
    "tailwindcss-animate": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/ws": "^8.0.0",

    "tailwindcss": "^4.0.0",
    "postcss": "^8.0.0",
    "autoprefixer": "^10.0.0",

    "eslint": "^9.0.0",
    "eslint-config-next": "^15.0.0",
    "prettier": "^3.0.0",
    "prettier-plugin-tailwindcss": "^0.6.0",

    "vitest": "^2.1.0",
    "@testing-library/react": "^16.0.0",
    "@playwright/test": "^1.45.0",

    "tsx": "^4.0.0"
  }
}
```

### 11.2 Dependency Count

| Category | Count | Combined Size (gzipped) |
|----------|-------|------------------------|
| Next.js + React | 3 | ~300 KB client JS |
| Radix UI (6 primitives) | 6 | ~40 KB |
| shadcn utilities (cva, clsx, tw-merge) | 3 | ~5 KB |
| Data viz (recharts, @use-gesture) | 2 | ~80 KB |
| Markdown (react-markdown, remark-gfm) | 2 | ~30 KB |
| Syntax highlighting (shiki) | 1 | ~100 KB (with 10 language grammars) |
| State (zustand) | 1 | ~3 KB |
| Icons (lucide-react) | 1 | tree-shaken, ~2 KB per 20 icons |
| **Total client bundle** | | **~560 KB gzipped** |

Server-only dependencies (better-sqlite3, ws, chokidar) are excluded from the client bundle by Next.js automatically.

---

## 12. Performance Considerations

### 12.1 Server Components Win

Pages that are Server Components send zero JavaScript to the client for data-fetching logic:

| Page | Rendering | Client JS Saved |
|------|-----------|----------------|
| Home dashboard (session list) | Server | ~50 KB (no fetch, no state) |
| Session entry page | Server | ~30 KB |
| Artifact content viewer | Server | ~40 KB |

### 12.2 Code Splitting

Next.js App Router automatically code-splits per route:

- `/` loads: home components (~30 KB)
- `/session/[id]/workspace` loads: workspace + agent + visualization (~300 KB)
- `/session/[id]/timeline` loads: timeline canvas (~100 KB)

Users navigating from the home dashboard to a workspace only download workspace code on demand.

### 12.3 Streaming and Suspense

Large session loads use React Suspense for progressive rendering:

```tsx
// app/session/[id]/page.tsx
import { Suspense } from 'react';
import { SessionSkeleton } from '@/components/session/session-skeleton';
import { ResumeDialog } from '@/components/session/resume-dialog';

export default function SessionPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<SessionSkeleton />}>
      <ResumeDialog sessionId={params.id} />
    </Suspense>
  );
}
```

The browser shows the skeleton immediately while the server fetches session data and streams the dialog content.

### 12.4 Canvas Timeline Performance

The timeline remains a Canvas 2D component (not DOM-based) for performance with 500+ agents. React manages the Canvas element lifecycle; the rendering logic is imperative:

```tsx
// components/visualization/timeline-canvas.tsx
'use client';

export function TimelineCanvas({ agents, events }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bind = useGesture({ onDrag, onPinch, onWheel });

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    renderTimeline(ctx, agents, events, viewport);
  }, [agents, events, viewport]);

  return <canvas ref={canvasRef} {...bind()} className="w-full h-full" />;
}
```
