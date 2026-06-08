# Next.js Architecture

## AgentWatch v2.0

**Date:** 2026-06-02
**Status:** Phase 1 MVP — Implemented
**Supersedes:** Frontend sections of `03-TECHNICAL-ARCHITECTURE.md`, Dockerfile/Compose in `06-DEPLOYMENT-ARCHITECTURE.md`

---

## 1. Technology Stack

### 1.1 Core Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Framework | Next.js | 16.2.6 | Full-stack React framework (App Router, Turbopack default) |
| Runtime | Node.js | 22 LTS | Server runtime (22 used in primary dev environment) |
| Language | TypeScript | 5.x | Type safety across client and server |
| UI Library | React | 19.2.4 | Component model |
| Components | Radix UI primitives | latest | Accessible primitives (installed individually, not via shadcn CLI) |
| Styling | Tailwind CSS | 4.x | CSS-first config via `@theme` in globals.css (no tailwind.config.ts) |
| Database | better-sqlite3 | 12.x | SQLite with FTS5 |
| WebSocket | ws | 8.x | Real-time updates (production only) |
| File Watching | chokidar | 5.x | JSONL file monitoring |
| Markdown | react-markdown + remark-gfm | latest | Message rendering |
| Syntax Highlighting | shiki | 4.x | Code block highlighting (same engine as VS Code) |
| Charts | recharts | 3.x | Analytics charts (built on D3) |
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

**Radix UI primitives over shadcn CLI approach:**
- `react-resizable-panels` v4: Used directly (not via shadcn wrapper). v4 exports `Group`/`Panel`/`Separator` with `orientation` prop (not `direction`). Handles horizontal/vertical splits, drag-to-resize, min-size enforcement, keyboard accessibility.
- `@radix-ui/react-collapsible`: Tool call expansion, agent sidebar round groups
- `@radix-ui/react-scroll-area`: Scrollable pane content
- `@radix-ui/react-tabs`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `@radix-ui/react-separator`: Used individually as needed
- `cmdk`: Session search (Command palette pattern)
- Agent tab rails and pane headers use **custom button implementations** (not shadcn Tabs) to support colored active-tab indicators per-agent

**Tailwind v4 over CSS Modules:**
- Tailwind v4 uses CSS-first configuration: design tokens declared via `@theme` in `app/globals.css` — there is **no `tailwind.config.ts`**
- Plugin registration uses `@plugin "tailwindcss-animate"` in CSS (not `plugins: [require(...)]`)
- `cn()` utility for conditional classes (cleaner than CSS Module composition)
- Dark mode always active (no `dark:` variant needed — background is dark by design)

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
|  |  |                          |  |   improvement_stream_event  | |  |
|  |  |                          |  |   improvement_permission_*  | |  |
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

Next.js doesn't natively support WebSocket in API routes. A custom `server.ts` wraps the Next.js request handler and attaches a `ws` WebSocket server to the same HTTP server. This is used **in production only**.

**Critical dev vs production distinction:**

| Mode | Command | Server |
|------|---------|--------|
| Development | `npm run dev` → `next dev -p 3456` | Next.js built-in dev server (Turbopack HMR) |
| Production | `npm start` → `node server.js` | Custom `server.ts` with WebSocket |

In development, the custom server is **not used**. Running `server.ts` in dev caused the WebSocketServer to reject all non-`/ws` WebSocket upgrades including `/_next/webpack-hmr`, which broke HMR and caused constant page reloads. Using `next dev` directly avoids this entirely.

```typescript
// server.ts (production only)
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

The layout below shows the **actual implemented state** (Phase 1 MVP). Items marked `(Phase 2+)` exist in the plan but are not yet implemented.

```
agentwatch/
├── app/                                    # Next.js App Router
│   ├── layout.tsx                          # Root layout (providers, font)
│   ├── page.tsx                            # Home dashboard
│   ├── globals.css                         # Tailwind v4 @theme tokens + @plugin
│   ├── session/
│   │   └── [id]/
│   │       ├── page.tsx                    # Session entry / resume
│   │       ├── workspace/
│   │       │   └── page.tsx                # Multi-pane workspace (Client)
│   │       ├── timeline/
│   │       │   └── page.tsx                # Full-page timeline (Phase 2+)
│   │       └── analytics/
│   │           └── page.tsx                # Analytics dashboard (Phase 2+)
│   └── api/
│       └── v2/
│           ├── sessions/
│           │   ├── route.ts                # GET /api/v2/sessions
│           │   └── [id]/
│           │       ├── route.ts            # GET /api/v2/sessions/:id
│           │       ├── agents/
│           │       │   └── route.ts        # GET /api/v2/sessions/:id/agents
│           │       └── agent-messages/     # ⚠ FLAT ROUTE — see note below
│           │           └── route.ts        # GET ?agentId=&page=&limit=
│           ├── history/
│           │   ├── route.ts                # GET/POST /api/v2/history
│           │   └── [sessionId]/
│           │       └── route.ts            # PUT/DELETE
│           ├── workspaces/
│           │   └── [sessionId]/
│           │       ├── route.ts            # GET/POST
│           │       └── latest/
│           │           └── route.ts        # GET latest auto-save
│           ├── preferences/
│           │   ├── route.ts                # GET all
│           │   └── [key]/
│           │       └── route.ts            # PUT
│           └── health/
│               └── route.ts               # GET /api/health
│
│   ⚠ Turbopack nested dynamic route limitation:
│     Routes with 2+ dynamic segments in the same path (e.g. /[id]/agents/[agentId]/messages)
│     fail to compile under Turbopack. Agent messages use a FLAT route with query params:
│       GET /api/v2/sessions/:id/agent-messages?agentId=...&page=0&limit=50
│
├── components/
│   ├── ui/                                 # Radix UI wrappers
│   │   ├── collapsible.tsx
│   │   ├── scroll-area.tsx
│   │   ├── separator.tsx
│   │   └── ...
│   ├── home/                               # Home dashboard
│   │   ├── session-card.tsx
│   │   └── open-by-id.tsx
│   ├── session/                            # Session-level UI
│   │   ├── agent-sidebar.tsx               # Round-grouped collapsible sidebar
│   │   └── session-providers.tsx
│   ├── workspace/                          # Multi-pane workspace
│   │   ├── workspace-shell.tsx             # react-resizable-panels Group/Panel/Separator
│   │   ├── pane.tsx                        # Single pane (routes to correct content)
│   │   └── workspace-page.tsx
│   ├── agent/                              # Agent pane content
│   │   ├── agent-view.tsx                  # Pane header + custom tab rail
│   │   ├── conversation-tab.tsx            # Message thread with round grouping
│   │   ├── artifacts-tab.tsx               # Produced artifacts list
│   │   ├── context-tab.tsx                 # Prompt/response viewer
│   │   ├── tools-tab.tsx                   # Tool call log
│   │   ├── summary-tab.tsx                 # Metadata, tokens, duration
│   │   ├── tool-call-with-result.tsx       # Expandable tool call + result
│   │   ├── artifact-card.tsx               # Inline artifact card (Write/Edit tools)
│   │   └── artifact-pane-view.tsx          # Full-pane document viewer
│   └── shared/
│       └── markdown-renderer.tsx           # react-markdown wrapper
│
├── lib/
│   ├── services/
│   │   ├── index.ts                        # Service init + singleton
│   │   ├── session-ingester.ts             # JSONL parsing, DB ingestion, agent correlation
│   │   ├── session-history.ts              # Session history tracking
│   │   ├── workspace-snapshots.ts          # Workspace auto-save/restore
│   │   └── preferences.ts                 # User preferences
│   ├── db/
│   │   └── database.ts                     # SQLite connection + inline migrations (v1, v2)
│   ├── parser/
│   │   ├── jsonl-parser.ts                 # JSONL line parser (handles outer wrapper format)
│   │   ├── agent-correlator.ts             # Subagent file discovery + labelling
│   │   └── artifact-extractor.ts           # Write/Edit tool detection
│   ├── websocket/
│   │   └── ws-server.ts                    # WebSocket server (production)
│   ├── agent-display.ts                    # Agent name/color/initials resolver
│   └── utils.ts                            # cn(), formatTokens(), formatDuration(), etc.
│
├── hooks/
│   ├── use-session.ts                      # Session + agent data
│   ├── use-agent-messages.ts               # Paginated messages (useRef stale-closure fix)
│   └── use-workspace-persistence.ts        # Auto-save to SQLite
│
├── store/
│   ├── workspace-store.ts                  # Zustand: layout tree, pane state, focus
│   └── session-store.ts                    # Zustand: session, agentMap, filters
│
├── types/
│   ├── session.ts                          # Session, Agent, ParsedMessage, Artifact
│   └── workspace.ts                        # LayoutNode, PaneTab, AgentSubTab
│
├── data/                                   # SQLite database (gitignored)
│   └── agentwatch.db
│
├── server.ts                               # Custom server (production WebSocket)
├── next.config.ts                          # Next.js config
├── tsconfig.json
└── package.json
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

All API routes live under `app/api/v2/` and follow Next.js Route Handler conventions. Note the Turbopack limitation:

> **Turbopack nested dynamic route limitation:** Routes with two or more dynamic segments in the same path (e.g. `/sessions/[id]/agents/[agentId]/messages`) fail to compile under Turbopack in Next.js 16. Work around by using a **flat route with query params** for agent messages:
>
> `GET /api/v2/sessions/:id/agent-messages?agentId=...&page=0&limit=50`

```typescript
// app/api/v2/sessions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServices } from '@/lib/services';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }  // Note: params is a Promise in Next.js 16
) {
  const { id } = await params;  // Must await params
  const { sessionIngester } = getServices();
  const session = await sessionIngester.ingestSession(id);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(session);
}
```

> **Next.js 16 breaking change:** Route handler `params` is now a `Promise`. Always `await params` before accessing properties.

---

## 5. Component Architecture

### 5.1 Workspace — react-resizable-panels v4

The multi-pane workspace uses `react-resizable-panels` v4 **directly** (not via a shadcn wrapper).

**v4 API breaking changes vs v2/v3:**
- Exports: `Group` / `Panel` / `Separator` (NOT `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle`)
- Split direction: `orientation="horizontal"` / `orientation="vertical"` (NOT `direction`)

**Single-pane vs split layout:** A single pane must NOT be wrapped in `<Panel>` without a `<Group>` parent — this causes a "Group Context not found" runtime error. The implementation uses two helpers:

```tsx
// components/workspace/workspace-shell.tsx
'use client';

import { Group, Panel, Separator } from 'react-resizable-panels';
import { useWorkspaceStore } from '@/store/workspace-store';
import { Pane } from './pane';

export function WorkspaceShell({ sessionId }: { sessionId: string }) {
  const { layout } = useWorkspaceStore();

  // Root: single pane → plain div (no Panel/Group); split → Group
  function renderRoot(node: LayoutNode): React.ReactNode {
    if (node.type === 'pane') {
      return <div className="h-full"><Pane paneId={node.id} sessionId={sessionId} /></div>;
    }
    return (
      <Group orientation={node.direction === 'horizontal' ? 'horizontal' : 'vertical'}>
        {renderChild(node.children[0])}
        <Separator />
        {renderChild(node.children[1])}
      </Group>
    );
  }

  // Child: always wrapped in Panel (safe because parent Group exists)
  function renderChild(node: LayoutNode): React.ReactNode {
    if (node.type === 'pane') {
      return (
        <Panel key={node.id} id={node.id} minSize={15}>
          <Pane paneId={node.id} sessionId={sessionId} />
        </Panel>
      );
    }
    return (
      <Panel key={node.id} id={node.id} minSize={15}>
        <Group orientation={node.direction === 'horizontal' ? 'horizontal' : 'vertical'}>
          {renderChild(node.children[0])}
          <Separator />
          {renderChild(node.children[1])}
        </Group>
      </Panel>
    );
  }

  return (
    <div className="flex-1 overflow-hidden h-full">
      {layout ? renderRoot(layout) : <EmptyWorkspace />}
    </div>
  );
}
```

### 5.2 Agent Pane — Custom Tab Rail

The agent pane uses a **custom button-based tab rail** (not shadcn Tabs) so the active indicator color can be driven by the agent's type color from `getAgentDisplay()`.

The pane has two rows in its header:
1. **Identity row**: colored swatch + agent name + split/close controls
2. **Metadata strip**: type badge + model + token count + duration + status
3. **Tab rail**: custom `<button>` elements with `borderColor: color.text` on active tab

```tsx
// components/agent/agent-view.tsx
'use client';
import { getAgentDisplay } from '@/lib/agent-display';

const TABS: { id: AgentSubTab; label: string }[] = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'artifacts',    label: 'Artifacts' },
  { id: 'context',      label: 'Context' },
  { id: 'tools',        label: 'Tools' },
  { id: 'summary',      label: 'Summary' },
];

export function AgentView({ sessionId, agentId, paneId, activeSubTab = 'conversation', onSubTabChange }) {
  const agent = useSessionStore(s => s.agentMap.get(agentId));
  const { name, typeLabel, color } = getAgentDisplay(agent);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d1117]">
      <div className="shrink-0 border-b border-[#21262d]">
        {/* Identity row */}
        <div className="flex items-center gap-2.5 px-3 py-2 bg-[#161b22]">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color.text }} />
          <span className="text-sm font-bold flex-1" style={{ color: color.text }}>{name}</span>
          {/* split / close buttons */}
        </div>
        {/* Metadata strip */}
        <div className="flex items-center gap-3 px-3 py-1" style={{ backgroundColor: `${color.bg}60` }}>
          <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: color.bg, color: color.text, border: `1px solid ${color.border}` }}>
            {typeLabel}
          </span>
          <span className="text-[#8b949e] font-mono">{agent.model?.replace('claude-', '')}</span>
        </div>
        {/* Custom tab rail */}
        <div className="flex items-center px-1 bg-[#0d1117] border-t border-[#21262d]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onSubTabChange?.(tab.id)}
              className="px-3 py-2 text-xs border-b-2"
              style={activeSubTab === tab.id
                ? { color: color.text, borderColor: color.text }
                : { color: '#8b949e', borderColor: 'transparent' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeSubTab === 'conversation' && <ConversationTab sessionId={sessionId} agentId={agentId} paneId={paneId} />}
        {/* ... other tabs */}
      </div>
    </div>
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

### 5.4 Agent Sidebar — Round-Grouped Collapsible

The sidebar does NOT use a recursive tree per-agent. Instead it groups subagents by **orchestration round** (15-minute time-gap clustering). The orchestrator always appears at the top; subagents are grouped under collapsible round sections.

```tsx
// components/session/agent-sidebar.tsx
'use client';

function groupAgentsByRound(agents: Agent[], GAP_MS = 15 * 60 * 1000): Agent[][] {
  // Sort subagents by startTime, then split into rounds on gaps > GAP_MS
  const sorted = [...agents].sort((a, b) =>
    new Date(a.startTime!).getTime() - new Date(b.startTime!).getTime()
  );
  const rounds: Agent[][] = [];
  let current: Agent[] = [];
  for (const agent of sorted) {
    if (current.length === 0) { current.push(agent); continue; }
    const gap = new Date(agent.startTime!).getTime() - new Date(current.at(-1)!.startTime!).getTime();
    if (gap > GAP_MS) { rounds.push(current); current = [agent]; }
    else current.push(agent);
  }
  if (current.length) rounds.push(current);
  return rounds;
}
```

Round numbers in the sidebar match round numbers in the conversation tab. A "round" only counts turns where the orchestrator spawned Workflow/Agent/Task tool calls — plain user↔assistant exchanges are labeled "EXCHANGE" and do not receive a round number.

### 5.5 Agent Display System — lib/agent-display.ts

All agent name/color/initials logic is centralized in `lib/agent-display.ts`:

```typescript
// lib/agent-display.ts
export interface AgentDisplay {
  name: string;       // Full display name, e.g. "Explore: Investigate person-selection..."
  shortName: string;  // Truncated for badges
  typeLabel: string;  // "Orchestrator" | "Explore" | "Plan" | "Workflow Subagent" | etc.
  color: { text: string; bg: string; border: string };
  initials: string;   // 2-char badge, e.g. "EX"
}

// Named types get fixed colors:
//   Orchestrator → #58a6ff (blue)
//   Explore      → #3fb950 (green)
//   Plan         → #f0883e (orange)
//   general-purpose → #bc8cff (purple)
//   code-reviewer → #f85149 (red)
// Workflow subagents get stable palette colors derived from hash of their label
```

`formatAgentLabel(raw: string)` converts kebab-case labels from workflow `workflowProgress` into Title Case with acronym uppercasing (API, UI, DB, etc.).

### 5.6 Artifact System

Write and Edit tool calls in the conversation are rendered as `ArtifactCard` components rather than generic tool-call blocks.

**Inline card** (`components/agent/artifact-card.tsx`):
- `+ Create` / `✎ Edit` operation badge
- File emoji + filename + language chip + line count
- Collapsed by default; expands to show content preview (max 320px)
- Markdown files: Preview/Source toggle with `InlineMarkdown` renderer
- Non-markdown: `InlineCode` with line numbers
- "Open in pane" button: stores content in `window.__artifactCache[toolId]` then calls `splitPane` or `addTabToPane`

**Full pane view** (`components/agent/artifact-pane-view.tsx`):
- Activated via pane tab type `artifact-content` with `artifactId`
- Reads content from `window.__artifactCache[artifactId]`
- Toolbar: file icon + name + path + language chip + Preview/Source toggle + Copy
- Preview: centered paper card (`max-width: 780px`) with custom markdown parser (`parseMarkdownSections`)
- Source: line-numbered code viewer with word-wrap

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

### 7.1 Tailwind v4 CSS-First Configuration

> **There is no `tailwind.config.ts`**. Tailwind v4 uses CSS-first configuration. All design tokens are declared in `app/globals.css` using `@theme`, and plugins are registered with `@plugin`.

```css
/* app/globals.css */
@import "tailwindcss";
@plugin "tailwindcss-animate";

@theme {
  /* Base surfaces */
  --color-background: #0d1117;
  --color-card: #161b22;
  --color-secondary: #21262d;
  --color-accent: #30363d;

  /* Text */
  --color-text-primary: #e6edf3;
  --color-text-secondary: #8b949e;
  --color-text-muted: #484f58;

  /* Accent */
  --color-primary: #58a6ff;
  --color-success: #3fb950;
  --color-warning: #f0883e;
  --color-error: #f85149;
  --color-purple: #bc8cff;

  /* Agent type colors */
  --color-agent-orchestrator: #58a6ff;
  --color-agent-explore: #3fb950;
  --color-agent-plan: #f0883e;
  --color-agent-general: #bc8cff;
  --color-agent-code-reviewer: #f85149;
  --color-agent-workflow: #39d353;
  --color-agent-default: #8b949e;
}
```

Most colors are used inline via `style={{ color: '...' }}` in components rather than Tailwind utility classes, because agent colors are dynamic and Tailwind cannot generate classes for runtime values.

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
  output: 'standalone',

  // better-sqlite3 is a native Node.js add-on — must stay server-side only.
  // serverExternalPackages replaces the old webpack.externals approach for App Router.
  serverExternalPackages: ['better-sqlite3'],

  // Turbopack is the default bundler in Next.js 16.
  // Empty object opts into default Turbopack settings.
  turbopack: {},

  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
```

> **Note on `serverExternalPackages`:** This is the correct way to exclude native modules in Next.js App Router. The old `webpack: (config) => { config.externals.push(...) }` approach still works for Pages Router but is not needed here.

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

### 11.1 package.json (Actual)

```json
{
  "name": "agent-watch",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3456",
    "dev:server": "tsx server.ts",
    "build": "next build",
    "start": "NODE_ENV=production node server.js",
    "lint": "eslint",
    "test": "vitest",
    "rebuild-native": "npm rebuild better-sqlite3",
    "postinstall": "npm rebuild better-sqlite3"
  },
  "dependencies": {
    "next": "16.2.6",
    "react": "19.2.4",
    "react-dom": "19.2.4",

    "better-sqlite3": "^12.10.0",
    "ws": "^8.21.0",
    "chokidar": "^5.0.0",

    "zustand": "^5.0.14",
    "react-resizable-panels": "^4.11.2",
    "cmdk": "^1.1.1",
    "@radix-ui/react-collapsible": "^1.1.12",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-scroll-area": "^1.2.10",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-tooltip": "^1.2.8",

    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1",
    "shiki": "^4.1.0",
    "recharts": "^3.8.1",
    "@use-gesture/react": "^10.3.1",

    "lucide-react": "^1.17.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.6.0",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@testing-library/react": "^16.3.2",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/ws": "^8.18.1",
    "eslint": "^9",
    "eslint-config-next": "16.2.6",
    "tailwindcss": "^4",
    "tsx": "^4.22.4",
    "typescript": "^5",
    "vitest": "^4.1.7"
  }
}
```

> **`postinstall` script:** `better-sqlite3` is a native Node.js add-on compiled against a specific Node.js ABI version. After any Node.js version change or fresh `npm install`, the add-on must be recompiled. The `postinstall` script (`npm rebuild better-sqlite3`) runs automatically on every `npm install`. If you switch Node.js versions with nvm or encounter a 500 error with `"NODE_MODULE_VERSION mismatch"`, run `npm run rebuild-native` manually.

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
