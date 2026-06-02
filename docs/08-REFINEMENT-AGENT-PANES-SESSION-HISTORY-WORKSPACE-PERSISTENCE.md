# Refinement: Agent Pane Artifacts, Session History, Workspace Persistence

## AgentWatch v2.0 - Addendum

**Document Version:** 1.2
**Date:** 2026-06-02
**Status:** Phase 1 implemented. See `07-IMPLEMENTATION-ROADMAP.md` for delivery status.
**Supersedes:** Sections in docs 01-07 where noted

---

## 1. Agent Pane Artifact Management

### 1.1 Design Decision: Hybrid Tab + Inline Approach

After evaluating collapsible sections, tabbed interfaces, split views, and hybrid approaches, the recommended design is a **tab rail with inline artifact cards**.

**Evaluation summary:**

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| Collapsible sections | Familiar, simple, everything in one scroll | Gets long fast; artifacts push messages off-screen; loses scroll position | Rejected for primary view |
| Tabbed interface | Clean separation; scales to many artifacts; constant header height | Context-switch cost; can't see messages and artifacts simultaneously | **Selected as primary** |
| Inline split view | Side-by-side messages + artifacts | Halves the width of both; doesn't fit in narrow panes | Rejected |
| Hybrid: tabs + inline cards | Tabs for dedicated sections, but artifact references appear inline within the message thread | Best of both; messages stay readable, dedicated tab for deep inspection | **Selected** |

**The hybrid approach works as follows:**

1. The agent pane has a **tab rail** below the header with five tabs: `Conversation`, `Artifacts`, `Context`, `Tools`, `Summary`.
2. In the `Conversation` tab, when a tool call produces an artifact (Write, Edit), an **inline artifact card** appears within the message flow showing the file path, operation type, and a preview toggle.
3. The `Artifacts` tab provides a dedicated, filterable list of all artifacts this agent produced or consumed.
4. The `Context` tab shows the prompt received and response returned (previously a separate panel).
5. The `Tools` tab provides a filterable log of every tool call with expandable details.
6. The `Summary` tab shows agent metadata, token usage, duration, and status.

This approach scales well because:
- The `Conversation` tab never gets overloaded — artifact cards are compact (2-3 lines) and collapsible
- The `Artifacts` tab handles agents with 50+ artifacts via virtual scrolling and filtering
- Users can always see the relationship between a message and its artifact without leaving context

### 1.2 Agent Pane Tab Rail

```
+------------------------------------------------------------------+
| [icon] Impl Agent            | Model: opus-4-6 | Tokens: 150K   |
| Parent: Orchestrator         | Duration: 45m   | Status: [done] |
+------------------------------------------------------------------+
| [Conversation] [Artifacts 8] [Context] [Tools 42] [Summary]     |
+------------------------------------------------------------------+
|                                                                    |
|  (tab content rendered here)                                       |
|                                                                    |
+------------------------------------------------------------------+
```

- Tab labels include counts where meaningful (Artifacts count, Tools count)
- Active tab has a bottom border highlight in `--accent-blue`
- Tabs are keyboard-navigable (`Ctrl+1` through `Ctrl+5` within a pane)
- Tab state persists per-pane in the workspace layout

### 1.3 Conversation Tab — Inline Artifact Cards

When a tool call in the message thread writes or modifies a file, an artifact card replaces the generic tool call display:

```
+------------------------------------------------------------------+
| [assistant] 10:35:02                                              |
| I'll create the PaymentService implementation.                    |
|                                                                    |
| +--------------------------------------------------------------+ |
| | ARTIFACT: src/payment/PaymentService.ts              [Created]| |
| | Write | 4.2 KB | 142 lines                                   | |
| |                                                      [Preview]| |
| | +----------------------------------------------------------+ | |
| | |  1  import { Gateway } from './PaymentGateway';           | | |
| | |  2                                                        | | |
| | |  3  export class PaymentService {                         | | |
| | |  4    private gateway: Gateway;                           | | |
| | |  ...  (collapsed, showing first 10 lines)                | | |
| | +----------------------------------------------------------+ | |
| | [Open in Pane]  [View Full]  [Show Lineage]                  | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Now I'll create the controller.                                   |
|                                                                    |
| +--------------------------------------------------------------+ |
| | ARTIFACT: src/api/PaymentController.ts               [Created]| |
| | Write | 2.1 KB | 67 lines                           [Preview]| |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

**Artifact card states:**

| State | Display |
|-------|---------|
| Collapsed (default) | File path, operation badge, size. Single line. |
| Preview | Collapsed + first 10 lines of content with syntax highlighting. |
| Full | Scrollable full content view (capped at 500 lines; "Open in Pane" for more). |

**Artifact card actions:**

| Action | Behavior |
|--------|----------|
| Click card header | Toggle preview |
| `[Open in Pane]` | Open artifact content in an adjacent pane (split or tab) |
| `[View Full]` | Expand to full content within the card |
| `[Show Lineage]` | Expand a lineage strip showing producer, consumers, modifications |

**For Edit operations**, the artifact card shows a unified diff:

```
+--------------------------------------------------------------+
| ARTIFACT: src/api/routes.ts                        [Modified] |
| Edit | +12 -3 lines                               [Preview]  |
| +----------------------------------------------------------+ |
| |  - app.get('/api/payments', oldHandler);                  | |
| |  + app.get('/api/payments', newHandler);                  | |
| |  + app.post('/api/payments', createHandler);              | |
| +----------------------------------------------------------+ |
+--------------------------------------------------------------+
```

### 1.4 Artifacts Tab — Dedicated Artifact List

```
+------------------------------------------------------------------+
| [Conversation] [Artifacts 8] [Context] [Tools 42] [Summary]     |
+------------------------------------------------------------------+
| [Search artifacts...]  [Filter: All v]  [Sort: Time v]           |
+------------------------------------------------------------------+
|                                                                    |
| PRODUCED (5 files)                                                |
| +--------------------------------------------------------------+ |
| | src/payment/PaymentService.ts         [Created] 4.2K  10:35  | |
| | src/api/PaymentController.ts          [Created] 2.1K  10:37  | |
| | src/api/routes.ts                     [Modified] +12  10:40  | |
| | test/payment.test.ts                  [Created] 3.8K  10:42  | |
| | test/payment.fixtures.ts             [Created] 1.1K  10:43  | |
| +--------------------------------------------------------------+ |
|                                                                    |
| CONSUMED (3 files)                                                |
| +--------------------------------------------------------------+ |
| | src/payment/PaymentGateway.ts         [Read]    3.1K  10:34  | |
| | src/types/payment.d.ts               [Read]    0.8K  10:34  | |
| | docs/api-spec.yaml                   [Read]    5.2K  10:35  | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Click any artifact to preview content below                       |
+------------------------------------------------------------------+
| PREVIEW: src/payment/PaymentService.ts                           |
| +--------------------------------------------------------------+ |
| | (syntax-highlighted content)                                  | |
| +--------------------------------------------------------------+ |
| Produced by: this agent (10:35)                                  |
| Consumed by: Review Agent (11:10)                                |
| Modified by: Review Agent (11:15) — [View Diff]                 |
+------------------------------------------------------------------+
```

**Filtering options:**
- All / Produced / Consumed
- By file type (ts, js, md, yaml, etc.)
- By operation (Created, Modified, Read, Deleted)

**Scalability:** For agents with 50+ artifacts, the list uses virtual scrolling and groups artifacts by directory path.

### 1.5 Context Tab

Replaces the separate "Context Inspector" concept. The context tab is always available within the agent pane:

```
+------------------------------------------------------------------+
| [Conversation] [Artifacts 8] [Context] [Tools 42] [Summary]     |
+------------------------------------------------------------------+
|                                                                    |
| RECEIVED FROM PARENT (Orchestrator)                               |
| +--------------------------------------------------------------+ |
| | Implement the payment service refactoring. Use the new        | |
| | gateway interface. Create comprehensive tests.                | |
| +--------------------------------------------------------------+ |
| Tokens: 342 | Schema: none | Model: opus-4-6                    |
|                                                                    |
| RETURNED TO PARENT                                                |
| +--------------------------------------------------------------+ |
| | Implementation complete. Created PaymentService with 5        | |
| | methods, PaymentController with REST endpoints, and 12        | |
| | test cases covering all edge cases.                           | |
| +--------------------------------------------------------------+ |
| Tokens: 1,205 | Duration: 45m 12s                               |
|                                                                    |
| ARTIFACTS TRANSFERRED                                             |
| +--------------------------------------------------------------+ |
| | Files consumed from context:                                  | |
| |   PaymentGateway.ts (from Explore agent, 3.1K)              | |
| |   payment.d.ts (from Explore agent, 0.8K)                   | |
| |                                                               | |
| | Files produced by this agent:                                 | |
| |   PaymentService.ts (4.2K) -> consumed by Review agent       | |
| |   PaymentController.ts (2.1K) -> consumed by Review agent    | |
| +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

### 1.6 Tools Tab

A filterable log of every tool call, grouping related calls:

```
+------------------------------------------------------------------+
| [Conversation] [Artifacts 8] [Context] [Tools 42] [Summary]     |
+------------------------------------------------------------------+
| [Search tools...]  [Filter: All v]  [Group by: Type v]           |
+------------------------------------------------------------------+
|                                                                    |
| Read (12 calls)                                           [v]    |
|   10:34:01  Read  src/payment/PaymentGateway.ts      245 lines   |
|   10:34:03  Read  src/types/payment.d.ts              32 lines   |
|   10:34:05  Read  docs/api-spec.yaml                 180 lines   |
|   ...                                                             |
|                                                                    |
| Bash (8 calls)                                            [v]    |
|   10:36:01  Bash  npm test -- --filter payment        [passed]   |
|   10:38:15  Bash  npm test -- --filter payment        [passed]   |
|   ...                                                             |
|                                                                    |
| Write (5 calls)                                           [v]    |
|   10:35:02  Write  src/payment/PaymentService.ts       4.2 KB    |
|   10:37:01  Write  src/api/PaymentController.ts        2.1 KB    |
|   ...                                                             |
|                                                                    |
| Grep (10 calls)                                          [v]    |
|   10:34:00  Grep  "PaymentService"                    5 matches  |
|   ...                                                             |
|                                                                    |
+------------------------------------------------------------------+
```

### 1.7 Summary Tab

A compact overview of the agent:

```
+------------------------------------------------------------------+
| [Conversation] [Artifacts 8] [Context] [Tools 42] [Summary]     |
+------------------------------------------------------------------+
|                                                                    |
| AGENT METADATA                                                    |
| +--------------------------------------------------------------+ |
| | Type:        general-purpose                                  | |
| | Model:       claude-opus-4-6                                  | |
| | Parent:      Orchestrator (main)                              | |
| | Status:      Completed                                        | |
| | Isolation:   none                                             | |
| +--------------------------------------------------------------+ |
|                                                                    |
| EXECUTION                                                         |
| +--------------------------------------------------------------+ |
| | Started:     2026-05-30 10:33:00                              | |
| | Ended:       2026-05-30 11:18:12                              | |
| | Duration:    45m 12s                                          | |
| | Messages:    67                                               | |
| +--------------------------------------------------------------+ |
|                                                                    |
| TOKEN USAGE                                                       |
| +--------------------------------------------------------------+ |
| | Input:       85,000 tokens                                    | |
| | Output:      65,000 tokens                                    | |
| | Cache Read:  42,000 tokens                                    | |
| | Total:       150,000 tokens                                   | |
| | Est. Cost:   $3.75                                            | |
| +--------------------------------------------------------------+ |
|                                                                    |
| TOOL USAGE                                                        |
| +--------------------------------------------------------------+ |
| | Read: 12  Bash: 8  Write: 5  Grep: 10  Edit: 3  Glob: 4    | |
| +--------------------------------------------------------------+ |
|                                                                    |
| CHILDREN (2 subagents)                                            |
| +--------------------------------------------------------------+ |
| | Explore: Test patterns    | sonnet-4-6 | 12K tok | 2m 15s   | |
| | Explore: DB schema        | sonnet-4-6 | 8K tok  | 1m 45s   | |
| +--------------------------------------------------------------+ |
|                                                                    |
+------------------------------------------------------------------+
```

### 1.8 Artifact Interaction: Cross-Agent Operations

**Open in Pane:**
When the user clicks `[Open in Pane]` on an artifact card, the system:
1. Creates a new pane (split from current) or a new tab in an existing pane
2. Renders the artifact content with syntax highlighting
3. Shows a lineage header: who produced, who consumed, modification history

**Compare across agents:**
When a file is modified by multiple agents:
1. The artifact card shows a "Compare" action
2. Clicking it opens a diff view pane showing the file as written by agent A vs. agent B
3. Alternatively, the user can drag two artifact cards to the same pane for side-by-side comparison

**Trace lineage:**
Clicking `[Show Lineage]` expands a horizontal strip below the artifact card:

```
+--------------------------------------------------------------+
| LINEAGE: src/payment/PaymentService.ts                       |
|                                                                |
| [Explore] ──Read──> [Impl] ──Write──> [Review] ──Edit──>     |
|  10:05           10:35              11:15                      |
|                                                                |
| Click any agent to open it                                    |
+--------------------------------------------------------------+
```

---

## 2. Session History and Navigation

### 2.1 Home Dashboard

The Home Dashboard replaces the simple session list as the landing page. It is designed for repeat users who come back daily to inspect new sessions.

```
+-----------------------------------------------------------------------+
| AgentWatch                                     [?] [cog] |
+----+------------------------------------------------------------------+
|    |                                                                   |
| N  |  +-----------------------------------------------------------+   |
| A  |  | [Search sessions by ID, title, agent, artifact, keyword]  |   |
| V  |  +-----------------------------------------------------------+   |
|    |                                                                   |
| +--+  PINNED SESSIONS                                    [Manage]     |
| |  |  +---------------------------+  +---------------------------+   |
| |H |  | Payment API Refactor      |  | Auth Migration            |   |
| |o |  | myproject | 23 agents     |  | auth-service | 45 agents  |   |
| |m |  | Last: 2h ago  | 1.2M tok  |  | Last: 1d ago  | 2.8M tok  |   |
| |e |  | [Open Last] [Fresh]       |  | [Open Last] [Fresh]       |   |
| |  |  +---------------------------+  +---------------------------+   |
| |  |                                                                   |
| |D |  RECENT SESSIONS                                                  |
| |a |  +---------------------------------------------------------------+
| |s |  | Bug Fix: Auth token expiry               Today 08:15          |
| |h |  | webapp | 3 agents | 85K tokens           [Open] [Pin]       |
| |b |  +---------------------------------------------------------------+
| |o |  | Sprint Review: PR batch                  Today 07:30          |
| |a |  | monorepo | 12 agents | 450K tokens       [Open] [Pin]       |
| |r |  +---------------------------------------------------------------+
| |d |  | Migrate DB schema                        Yesterday 16:45      |
| |  |  | backend | 8 agents | 220K tokens         [Open] [Pin]       |
| |  |  +---------------------------------------------------------------+
| |  |  | Infrastructure audit                     Yesterday 14:00      |
| |  |  | infra | 31 agents | 1.5M tokens          [Open] [Pin]       |
| |  |  +---------------------------------------------------------------+
| |  |                                                                   |
| |  |  OPEN BY SESSION ID                                               |
| |  |  +-----------------------------------------------------------+   |
| |  |  | [Enter session ID or paste path]            [Open]        |   |
| |  |  +-----------------------------------------------------------+   |
| |  |                                                                   |
+----+------------------------------------------------------------------+
```

### 2.2 Session Metadata Storage

Each session that a user has opened gets a metadata record persisted in SQLite:

```typescript
interface SessionHistory {
  sessionId: string;             // Conversation UUID
  title: string;                 // Auto-generated or user-edited
  summary: string | null;        // First user message excerpt (auto) or user-written
  project: string;               // Working directory path
  
  // Timestamps
  sessionCreated: string;        // When the Claude session started (ISO 8601)
  firstOpened: string;           // When user first opened it in this app (ISO 8601)
  lastOpened: string;            // Most recent open (ISO 8601)
  openCount: number;             // Number of times opened
  
  // Metrics (cached from session data)
  agentCount: number;
  artifactCount: number;
  totalTokens: number;
  totalToolCalls: number;
  durationMs: number;
  primaryModel: string;
  estimatedCost: number;         // USD
  
  // User organization
  isPinned: boolean;
  isFavorite: boolean;
  tags: string[];                // User-defined tags
  notes: string | null;          // User notes (free text)
  
  // Status
  sourceExists: boolean;         // Whether JSONL file still exists
  lastIndexed: string;           // When metadata was last refreshed
}
```

**Title auto-generation:**
1. Use the first user message (truncated to 60 characters)
2. If the first message is generic ("help me with..."), use `{project name} - {date}`
3. Users can override with a custom title via inline edit

### 2.3 Session Search

The home dashboard search bar supports multiple query types:

| Query Type | Example | Behavior |
|------------|---------|----------|
| Free text | `payment refactor` | Searches title, summary, project name |
| Session ID | `conv-abc123` | Exact match on session ID |
| Agent filter | `agent:Explore` | Sessions containing Explore agents |
| Artifact filter | `artifact:PaymentService` | Sessions where PaymentService.ts was created/modified |
| Tag filter | `tag:sprint-review` | Sessions with matching tag |
| Date filter | `date:today`, `date:2026-05-30` | Sessions from specific date |
| Combined | `payment agent:Explore date:today` | AND combination of all filters |

Search results appear below the search bar, replacing the default sections:

```
+-----------------------------------------------------------------------+
| Search: "payment agent:Explore"                          [Clear]      |
+-----------------------------------------------------------------------+
| 3 results                                                              |
+-----------------------------------------------------------------------+
| Payment API Refactor               Today 10:00                        |
| myproject | 23 agents (3 Explore) | 1.2M tokens                      |
| Matched: 3 Explore agents, "payment" in title                        |
| [Open Last] [Fresh] [Pin]                                            |
+-----------------------------------------------------------------------+
| Payment Gateway Integration        Yesterday 14:30                    |
| payment-svc | 8 agents (2 Explore) | 320K tokens                     |
| Matched: 2 Explore agents, "payment" in title                        |
| [Open Last] [Fresh] [Pin]                                            |
+-----------------------------------------------------------------------+
```

### 2.4 Session Organization

**Pinning:**
- Click the pin icon on any session card
- Pinned sessions appear in a dedicated section at the top of the home dashboard
- Maximum 10 pinned sessions (soft limit, user can configure)
- Pin state persists in SQLite

**Favorites:**
- Star icon on session card header
- Favorites filter in the sidebar: `[All] [Favorites] [Pinned]`
- Favorites differ from pins: favorites is a long-term bookmark, pins are the "currently working on" set

**Tagging:**
- Click `[+tag]` on a session card or in the session header
- Tags are free-text, auto-completing from existing tags
- Filter by tag from the sidebar or search bar
- Tags are colored consistently (hash-based color assignment)
- Common workflow: tag sessions by sprint, project, or review type

**Filtering sidebar:**

```
+------------------------+
| FILTERS                |
|                        |
| View:                  |
|  [All] [Pinned] [Fav] |
|                        |
| Tags:                  |
|  [sprint-8]       (4)  |
|  [code-review]    (7)  |
|  [migration]      (2)  |
|  [debug]          (3)  |
|                        |
| Projects:              |
|  [myproject]     (15)  |
|  [webapp]         (8)  |
|  [infra]          (5)  |
|                        |
| Date:                  |
|  [Today]         (5)   |
|  [This Week]    (12)   |
|  [This Month]   (28)   |
|  [Custom...]           |
|                        |
| Agents:                |
|  [Has 10+ agents] (8)  |
|  [Has workflows]  (3)  |
|                        |
+------------------------+
```

---

## 3. Workspace Persistence

### 3.1 What Gets Persisted

When a user is viewing a session, the following state is captured continuously (debounced, 2-second delay):

```typescript
interface WorkspaceSnapshot {
  sessionId: string;             // Which session
  snapshotId: string;            // Unique snapshot ID
  savedAt: string;               // ISO 8601
  
  // Layout tree (recursive)
  layout: LayoutNode;
  
  // Per-pane state
  paneStates: Record<string, PaneState>;
  
  // Global view state
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  globalSearchQuery: string | null;
  activeFilters: FilterState;
}

interface PaneState {
  paneId: string;
  
  // Tab state
  tabs: PaneTabState[];
  activeTabIndex: number;
  
  // Per-tab state
  tabStates: Record<string, TabViewState>;
}

interface PaneTabState {
  type: 'agent' | 'timeline' | 'graph' | 'artifacts' | 'analytics' | 'context' | 'artifact-content';
  agentId?: string;
  artifactId?: string;
  label: string;
}

interface TabViewState {
  // Conversation tab
  activeSubTab?: 'conversation' | 'artifacts' | 'context' | 'tools' | 'summary';
  scrollPosition?: number;
  expandedToolCalls?: string[];     // IDs of expanded tool call cards
  expandedArtifacts?: string[];     // IDs of expanded artifact cards
  
  // Timeline tab
  timelineZoom?: number;
  timelinePanOffset?: number;
  timelineSelectedAgentId?: string;
  
  // Artifacts tab
  artifactFilter?: string;
  artifactSort?: string;
  selectedArtifactId?: string;
  
  // Search state
  searchQuery?: string;
  searchHighlightIndex?: number;
}

interface FilterState {
  agentTypes: string[];
  tools: string[];
  timeRange: { start: string; end: string } | null;
  messageRoles: string[];
}
```

### 3.2 Storage Location

Workspace snapshots are stored **in SQLite** (not localStorage) to survive browser cache clears and to support sessions with large state:

```sql
CREATE TABLE workspace_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  saved_at INTEGER NOT NULL,          -- Unix timestamp (ms)
  is_auto_save BOOLEAN DEFAULT 1,     -- Auto-save vs. user-named save
  name TEXT,                           -- User-defined name (null for auto-saves)
  snapshot_data TEXT NOT NULL,         -- JSON blob (WorkspaceSnapshot)
  snapshot_size INTEGER,               -- Size in bytes for cleanup
  FOREIGN KEY (session_id) REFERENCES conversations(id)
);

CREATE INDEX idx_workspace_session ON workspace_snapshots(session_id, saved_at DESC);
```

**Auto-save rules:**
- Save on every layout change (split, close, resize) — debounced 2 seconds
- Save on tab switch
- Save on scroll position change — debounced 5 seconds
- Save on filter change
- Keep only the most recent auto-save per session (overwrite)

**Named saves:**
- User clicks "Save Layout" in the workspace header
- Prompted for a name
- Stored separately from auto-saves
- No limit on named saves per session

### 3.3 Storage Budget

| Data | Typical Size | Max Stored |
|------|-------------|------------|
| Auto-save per session | 2-10 KB | 1 per session (latest only) |
| Named save | 2-10 KB | 20 per session |
| Session history record | 0.5 KB | Unlimited (pruned after 180 days of inactivity) |

Total storage for a user with 100 sessions and 5 named saves each: approximately 5 MB.

---

## 4. Session Resume Experience

### 4.1 Resume Flow

When a user opens a previously-viewed session (from home dashboard, sidebar, or direct ID):

**If a workspace snapshot exists:**

```
+-----------------------------------------------------------------------+
| Opening: Payment API Refactor                                         |
+-----------------------------------------------------------------------+
|                                                                        |
|  A previous workspace was found for this session.                     |
|  Last viewed: 2 hours ago                                             |
|                                                                        |
|  +-------------------------------------------+                       |
|  | [>>>] Resume Last Workspace               |   <- Primary action   |
|  |       3 panes: Orchestrator, Impl, Review |                       |
|  |       Artifacts tab open on Impl          |                       |
|  +-------------------------------------------+                       |
|                                                                        |
|  Or start with a view:                                                |
|                                                                        |
|  [Timeline]  [Agent Explorer]  [Artifact Explorer]  [Fresh Workspace] |
|                                                                        |
+-----------------------------------------------------------------------+
```

**If no snapshot exists (first time):**

```
+-----------------------------------------------------------------------+
| Opening: Payment API Refactor                                         |
+-----------------------------------------------------------------------+
|                                                                        |
|  Choose a starting view:                                              |
|                                                                        |
|  [>>>] Agent Explorer (Recommended)                                   |
|        Orchestrator in main pane, agent sidebar open                  |
|                                                                        |
|  [Timeline]          [Artifact Explorer]         [Fresh Workspace]    |
|  See execution flow  Browse generated files      Empty workspace      |
|                                                                        |
+-----------------------------------------------------------------------+
```

**Behavior of each option:**

| Option | What it does |
|--------|-------------|
| **Resume Last Workspace** | Restores the exact layout, open agents, tab states, scroll positions, expanded sections. Feels like the user never left. |
| **Timeline** | Opens a single-pane workspace with the timeline view. Agent sidebar open. |
| **Agent Explorer** | Opens the orchestrator agent in the main pane. Agent sidebar open. Conversation tab active. |
| **Artifact Explorer** | Opens the session-wide artifact browser in the main pane. |
| **Fresh Workspace** | Empty workspace with agent sidebar open. No panes pre-populated. |

### 4.2 Quick Resume (Skip Dialog)

For power users who always want to resume:

- **Setting:** "Always resume last workspace" (stored in user preferences)
- When enabled, opening a session with an existing snapshot skips the dialog and immediately restores the workspace
- The setting is toggleable from the workspace header: `[Layout v] > Always Resume: On/Off`

### 4.3 Named Layout Recall

From the workspace header's layout dropdown:

```
+----------------------------------+
| Layout                           |
+----------------------------------+
| SAVED FOR THIS SESSION           |
|   > Review Mode (3 panes)       |
|   > Debug Mode (timeline + 2)   |
+----------------------------------+
| PRESETS                          |
|   > Single Pane                 |
|   > Side by Side                |
|   > Three Column                |
|   > Quad                        |
|   > Orchestrator + Agents       |
+----------------------------------+
| ACTIONS                         |
|   > Save Current Layout...      |
|   > Always Resume: Off          |
+----------------------------------+
```

---

## 5. Updated Data Model

### 5.1 New Entities

**Session History (SQLite):**

```sql
CREATE TABLE session_history (
  session_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  project TEXT NOT NULL,
  
  -- Timestamps
  session_created INTEGER,           -- When Claude session started (ms)
  first_opened INTEGER NOT NULL,     -- When user first opened in this app (ms)
  last_opened INTEGER NOT NULL,      -- Most recent open (ms)
  open_count INTEGER DEFAULT 1,
  
  -- Cached metrics
  agent_count INTEGER DEFAULT 0,
  artifact_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_tool_calls INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  primary_model TEXT,
  estimated_cost REAL DEFAULT 0,
  
  -- Organization
  is_pinned BOOLEAN DEFAULT 0,
  is_favorite BOOLEAN DEFAULT 0,
  tags TEXT DEFAULT '[]',            -- JSON array of strings
  notes TEXT,
  
  -- Status
  source_exists BOOLEAN DEFAULT 1,
  last_indexed INTEGER
);

CREATE INDEX idx_session_history_last_opened ON session_history(last_opened DESC);
CREATE INDEX idx_session_history_pinned ON session_history(is_pinned, last_opened DESC);
CREATE INDEX idx_session_history_project ON session_history(project);
```

**Session History FTS (for search):**

```sql
CREATE VIRTUAL TABLE session_history_fts USING fts5(
  session_id,
  title,
  summary,
  project,
  tags,
  tokenize='unicode61 remove_diacritics 2'
);
```

**Workspace Snapshots (SQLite):**

```sql
CREATE TABLE workspace_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  is_auto_save BOOLEAN DEFAULT 1,
  name TEXT,
  snapshot_data TEXT NOT NULL,        -- JSON blob
  snapshot_size INTEGER,
  FOREIGN KEY (session_id) REFERENCES session_history(session_id)
);

CREATE INDEX idx_workspace_session ON workspace_snapshots(session_id, saved_at DESC);
```

**User Preferences (SQLite):**

```sql
CREATE TABLE user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                -- JSON value
  updated_at INTEGER NOT NULL
);

-- Known keys:
-- 'always_resume_workspace' -> 'true' | 'false'
-- 'default_layout_preset' -> 'single' | 'side-by-side' | ...
-- 'sidebar_width' -> '280'
-- 'theme' -> 'dark'
-- 'max_pinned_sessions' -> '10'
```

### 5.2 Updated Entity Relationship Diagram

```
+------------------+       +------------------+       +------------------+
|  SessionHistory  |       |    Session       |       |     Agent        |
|------------------|       |------------------|       |------------------|
| session_id (PK)  |<----->| id (PK)          |<----->| id (PK)          |
| title            |  1:1  | project          |  1:N  | session_id (FK)  |
| summary          |       | created          |       | parent_id (FK)   |
| project          |       | last_modified    |       | conversation_id  |
| first_opened     |       | total_tokens     |       | subagent_type    |
| last_opened      |       | total_agents     |       | model            |
| open_count       |       | ...              |       | prompt           |
| is_pinned        |       +------------------+       | ...              |
| is_favorite      |                                   |                  |
| tags             |       +------------------+       | ARTIFACTS (1:N)  |
| notes            |       | WorkspaceSnapshot|       |  produced[]      |
| ...              |       |------------------|       |  consumed[]      |
+------------------+       | id (PK)          |       +------------------+
        |                  | session_id (FK)  |
        | 1:N              | saved_at         |       +------------------+
        +----------------->| is_auto_save     |       |    Artifact      |
                           | name             |       |------------------|
                           | snapshot_data    |       | id (PK)          |
                           +------------------+       | session_id (FK)  |
                                                      | agent_id (FK)    |
+------------------+                                  | type             |
| UserPreferences  |                                  | file_path        |
|------------------|                                  | ...              |
| key (PK)         |                                  +------------------+
| value            |
| updated_at       |
+------------------+
```

### 5.3 Updated Agent Entity

The Agent entity gains artifact tracking:

```typescript
interface Agent {
  // ... (all existing fields) ...
  
  // Artifact tracking (new)
  artifacts: {
    produced: ArtifactRef[];     // Files this agent created or modified
    consumed: ArtifactRef[];     // Files this agent read
  };
}

interface ArtifactRef {
  artifactId: string;
  filePath: string;
  operation: 'create' | 'modify' | 'read' | 'delete';
  toolName: string;              // 'Write', 'Edit', 'Read', 'Grep'
  timestamp: string;
  messageIndex: number;          // Index in message thread for navigation
}
```

### 5.4 Updated Workspace Layout Entity

The PaneTab type gains support for the new tab rail and artifact content views:

```typescript
type PaneTab =
  | { type: 'agent'; agentId: string; label: string; activeSubTab?: AgentSubTab }
  | { type: 'timeline'; label: string }
  | { type: 'graph'; label: string }
  | { type: 'artifacts'; label: string }      // Session-wide artifact explorer
  | { type: 'analytics'; label: string }
  | { type: 'artifact-content'; artifactId: string; label: string }  // Single artifact view
  | { type: 'artifact-diff'; artifactIds: [string, string]; label: string };  // Diff view

type AgentSubTab = 'conversation' | 'artifacts' | 'context' | 'tools' | 'summary';
```

---

## 6. Updated Frontend Architecture

### 6.1 New and Modified Components

```
src/analytics-web/
├── components/
│   ├── home/                              # NEW: Home Dashboard
│   │   ├── HomeDashboard.js               # Main home page
│   │   ├── SessionCard.js                 # Session card with actions
│   │   ├── PinnedSessions.js              # Pinned sessions section
│   │   ├── RecentSessions.js              # Recent sessions list
│   │   ├── SessionSearch.js               # Search bar with filters
│   │   ├── SessionFilters.js              # Sidebar filter panel
│   │   ├── TagManager.js                  # Tag CRUD + autocomplete
│   │   └── ResumeDialog.js               # Session resume chooser
│   ├── agent/
│   │   ├── AgentView.js                   # MODIFIED: Now a tab container
│   │   ├── AgentTabRail.js                # NEW: Tab rail component
│   │   ├── ConversationTab.js             # NEW: Messages + inline artifacts
│   │   ├── ArtifactsTab.js                # NEW: Agent artifact list
│   │   ├── ContextTab.js                  # NEW: Context inputs/outputs
│   │   ├── ToolsTab.js                    # NEW: Tool call log
│   │   ├── SummaryTab.js                  # NEW: Agent metadata summary
│   │   ├── InlineArtifactCard.js          # NEW: Artifact card in message flow
│   │   ├── ArtifactLineage.js             # NEW: Horizontal lineage strip
│   │   ├── AgentMessage.js                # (existing, retained)
│   │   ├── ToolCallCard.js                # (existing, retained)
│   │   ├── ContextInspector.js            # DEPRECATED: Merged into ContextTab
│   │   └── AgentBadge.js                  # (existing, retained)
│   ├── workspace/
│   │   ├── WorkspaceManager.js            # MODIFIED: Snapshot save/restore
│   │   ├── WorkspacePersistence.js         # NEW: Auto-save + named saves
│   │   ├── LayoutDropdown.js              # NEW: Layout picker with saved layouts
│   │   ├── PaneContainer.js               # (existing, retained)
│   │   ├── Pane.js                        # (existing, retained)
│   │   ├── PaneDivider.js                 # (existing, retained)
│   │   ├── PaneTabBar.js                  # (existing, retained)
│   │   └── LayoutPresets.js               # (existing, retained)
│   ├── artifacts/
│   │   ├── ArtifactList.js                # MODIFIED: Support agent-scoped view
│   │   ├── ArtifactViewer.js              # (existing, retained)
│   │   ├── ArtifactDiff.js                # (existing, retained)
│   │   └── ArtifactContentPane.js         # NEW: Dedicated artifact pane view
│   └── ...
├── services/
│   ├── SessionHistoryService.js           # NEW: Session history CRUD
│   ├── WorkspaceSnapshotService.js        # NEW: Snapshot save/restore API
│   ├── PreferencesService.js              # NEW: User preferences API
│   ├── LayoutService.js                   # MODIFIED: Delegates to SnapshotService
│   └── ...
```

### 6.2 State Management Updates

The `SessionState` class gains new state slices:

```javascript
class SessionState {
  constructor() {
    this.state = {
      // ... existing state ...
      
      // Home Dashboard (new)
      home: {
        recentSessions: [],        // SessionHistory[]
        pinnedSessions: [],        // SessionHistory[]
        searchQuery: '',
        searchResults: null,
        activeFilters: {
          view: 'all',             // 'all' | 'pinned' | 'favorites'
          tags: [],
          projects: [],
          dateRange: null,
          agentCountMin: null
        }
      },
      
      // Workspace persistence (new)
      workspace: {
        currentSnapshot: null,     // WorkspaceSnapshot
        savedSnapshots: [],        // WorkspaceSnapshot[] for current session
        autoSaveEnabled: true,
        alwaysResume: false
      },
      
      // Agent pane tab state (new)
      agentPaneStates: new Map()   // agentId -> { activeSubTab, expandedItems, scrollPositions }
    };
  }
}
```

### 6.3 New API Endpoints

```
# Session History
GET    /api/v2/history
       Query: ?limit=&offset=&sort=&filter=&search=
       Returns: Paginated SessionHistory[]

GET    /api/v2/history/:sessionId
       Returns: Single SessionHistory

PUT    /api/v2/history/:sessionId
       Body: { title?, isPinned?, isFavorite?, tags?, notes? }
       Returns: Updated SessionHistory

DELETE /api/v2/history/:sessionId
       Removes history record (not the session data)

POST   /api/v2/history/search
       Body: { query, filters }
       Returns: Search results with highlighting

# Workspace Snapshots
GET    /api/v2/workspaces/:sessionId
       Returns: All snapshots for a session (auto + named)

GET    /api/v2/workspaces/:sessionId/latest
       Returns: Most recent auto-save snapshot

POST   /api/v2/workspaces/:sessionId
       Body: WorkspaceSnapshot
       Returns: Saved snapshot

PUT    /api/v2/workspaces/:sessionId/:snapshotId
       Body: Partial WorkspaceSnapshot update
       Returns: Updated snapshot

DELETE /api/v2/workspaces/:sessionId/:snapshotId
       Deletes a named snapshot

# User Preferences
GET    /api/v2/preferences
       Returns: All preferences as key-value map

PUT    /api/v2/preferences/:key
       Body: { value }
       Returns: Updated preference

# Agent Artifacts (scoped to agent)
GET    /api/v2/sessions/:id/agents/:agentId/artifacts
       Returns: { produced: Artifact[], consumed: Artifact[] }
```

### 6.4 Navigation Architecture

The application gains a router to manage page transitions:

```javascript
class Router {
  routes = {
    '/':                          'HomeDashboard',
    '/session/:id':               'ResumeDialog',       // Shows resume options
    '/session/:id/workspace':     'Workspace',           // Workspace view
    '/session/:id/timeline':      'Timeline',            // Full-page timeline
    '/session/:id/artifacts':     'ArtifactExplorer',    // Full-page artifacts
    '/session/:id/analytics':     'SessionAnalytics',    // Full-page analytics
  };
  
  // URL state is managed via History API (pushState/popState)
  // No page reloads; all transitions are SPA-style
}
```

---

## 7. Updated Backend Architecture

### 7.1 New Services

```javascript
class SessionHistoryService {
  // Record that a user opened a session
  async recordOpen(sessionId) {
    // Upsert into session_history
    // Increment open_count
    // Update last_opened
    // If first time: generate title, cache metrics
  }
  
  // Search session history
  async search(query, filters) {
    // FTS5 search across title, summary, project, tags
    // Apply filters (pinned, favorite, date range, project)
    // Return ranked results
  }
  
  // Update user organization (pin, tag, etc.)
  async update(sessionId, updates) { ... }
  
  // Clean up stale history (source files deleted)
  async reconcile() { ... }
  
  // Prune old history (sessions not opened in 180 days)
  async prune() { ... }
}

class WorkspaceSnapshotService {
  // Save workspace state
  async saveSnapshot(sessionId, snapshot, isAutoSave = true) {
    // If auto-save: upsert (replace previous auto-save for this session)
    // If named: insert new record
    // Enforce storage limits
  }
  
  // Load most recent snapshot for a session
  async getLatestSnapshot(sessionId) { ... }
  
  // Load all named snapshots for a session
  async getNamedSnapshots(sessionId) { ... }
  
  // Delete a snapshot
  async deleteSnapshot(snapshotId) { ... }
  
  // Clean up orphaned snapshots (session history deleted)
  async cleanup() { ... }
}

class PreferencesService {
  // Get all preferences
  async getAll() { ... }
  
  // Get a single preference
  async get(key, defaultValue) { ... }
  
  // Set a preference
  async set(key, value) { ... }
}
```

### 7.2 New Routes

```
src/routes/
├── history.js                     # /api/v2/history/* endpoints
├── workspaces.js                  # /api/v2/workspaces/* endpoints
├── preferences.js                 # /api/v2/preferences/* endpoints
└── ...
```

---

## 8. Scalability Considerations

### 8.1 Large Sessions (500+ Agents)

**Agent Sidebar:**
- Virtual scrolling for the agent hierarchy tree
- Collapse all children by default; expand on click
- Search within the sidebar filters the tree (matches expand parents)
- Estimated rendering: ~100 visible nodes at a time (even with 500 agents)

**Agent Pane Tabs:**
- Conversation tab: Virtual scrolling for messages (50 per page, load on scroll)
- Artifacts tab: Virtual scrolling for artifact list; grouped by directory to reduce row count
- Tools tab: Virtual scrolling; grouped by tool type with collapsible groups

### 8.2 Thousands of Artifacts

**Session-Wide Artifact Explorer:**
- File tree view uses lazy expansion (don't render children until expanded)
- Flat list mode for searching/filtering (virtual scrolled)
- Artifact content loaded on demand (not preloaded)
- Content preview limited to first 500 lines; "Open in Pane" for full view

**Per-Agent Artifact Tab:**
- Produced and Consumed sections separately scrollable
- Collapsed by default if either section has > 20 items
- Filter bar reduces visible items before rendering

### 8.3 Workspace Snapshot Size

For a session with 500 agents and 10 open panes:
- Layout tree: ~2 KB
- Per-pane state (10 panes x 500 bytes): ~5 KB
- Total snapshot: ~7 KB
- Well within the storage budget

**Mitigation for edge cases:**
- Snapshot data > 100 KB triggers a warning
- Scroll positions are stored as offsets (4 bytes each), not as content
- Expanded item lists store only IDs, not content

### 8.4 Session History Growth

- 100 sessions/month x 12 months = ~1,200 records = ~600 KB
- FTS5 index adds ~50% overhead = ~900 KB total
- Auto-prune after 180 days of inactivity keeps the table bounded
- Source reconciliation on startup removes entries for deleted JSONL files

### 8.5 Performance Budgets

| Operation | Budget | Mechanism |
|-----------|--------|-----------|
| Home dashboard load | < 500ms | Session history query is indexed; cached after first load |
| Session resume (with snapshot) | < 2 seconds | Layout restored from JSON; agent messages loaded lazily per pane |
| Artifact tab open (50 artifacts) | < 300ms | Artifact metadata cached during session ingestion |
| Search across history (1000 sessions) | < 200ms | FTS5 index on session_history_fts |
| Auto-save snapshot | < 100ms | Debounced; single upsert; small JSON payload |
| Pin/tag/favorite toggle | < 50ms | Single row update on indexed column |

---

## 9. Impact on Implementation Roadmap

### Phase 1 Additions (MVP)

The following features move into Phase 1 since they're foundational to daily usability:

| Feature | Description | Added Effort |
|---------|-------------|--------------|
| **Agent pane tab rail** | Five-tab layout within each agent pane | +1 week |
| **Inline artifact cards** | Artifact cards in conversation messages | +0.5 weeks |
| **Home Dashboard (basic)** | Recent sessions, open by ID, basic search | +1 week |
| **Session history tracking** | Record opens, auto-title, persist metadata | +0.5 weeks |
| **Auto-save workspace** | Save layout on change, restore on reopen | +1 week |
| **Resume dialog** | Present resume options when reopening session | +0.5 weeks |

**Revised Phase 1 effort: 8-12 weeks** (was 6-8)

### Phase 2 Additions (Advanced Visualization)

| Feature | Description | Added Effort |
|---------|-------------|--------------|
| **Artifacts tab (per-agent)** | Produced/consumed artifact lists within agent pane | +0.5 weeks |
| **Tools tab** | Grouped, filterable tool call log | +0.5 weeks |
| **Pinning and favorites** | Pin/favorite session actions with filtered views | +0.5 weeks |
| **Named layout saves** | Save/restore named layouts per session | +0.5 weeks |

**Revised Phase 2 effort: 6-8 weeks** (was 4-6)

### Phase 3 Additions (Multi-Agent Analysis)

| Feature | Description | Added Effort |
|---------|-------------|--------------|
| **Context tab** | Prompt/response/artifacts-transferred view | Already planned (moved from separate panel) |
| **Artifact lineage strip** | Horizontal lineage visualization on artifact cards | +0.5 weeks |
| **Cross-agent artifact comparison** | Diff view for files modified by multiple agents | Already planned |
| **Session tagging** | Full tag CRUD with autocomplete | +0.5 weeks |

**Revised Phase 3 effort: 5-7 weeks** (was 4-6)

### Phase 4 Additions (Analytics & Debugging)

| Feature | Description | Added Effort |
|---------|-------------|--------------|
| **Session search (advanced)** | Multi-field search with agent/artifact/tag filters | +0.5 weeks |
| **History pruning** | Auto-clean stale history records | +0.25 weeks |
| **Always-resume preference** | Skip resume dialog setting | Already trivial with snapshot infrastructure |

**Revised Phase 4 effort: 4.5-6.5 weeks** (was 4-6)

### Revised Total Timeline

**23.5-33.5 weeks** (one developer) vs. original 18-26 weeks. The 5-week increase is front-loaded in Phase 1 where session history, workspace persistence, and the tab rail are foundational infrastructure that all subsequent phases benefit from.

With two developers: **14-20 weeks.**

---

## 10. Database Migration

### v2 -> v3 Migration

```sql
-- New tables (additive, non-breaking)
CREATE TABLE IF NOT EXISTS session_history (...);
CREATE VIRTUAL TABLE IF NOT EXISTS session_history_fts USING fts5(...);
CREATE TABLE IF NOT EXISTS workspace_snapshots (...);
CREATE TABLE IF NOT EXISTS user_preferences (...);

-- Backfill session_history from existing conversations table
INSERT OR IGNORE INTO session_history (session_id, title, project, session_created, first_opened, last_opened, ...)
SELECT id, 
       SUBSTR(filename, 1, 60),   -- Title from filename
       project,
       created,
       created,                    -- first_opened = session_created for backfill
       last_modified,
       ...
FROM conversations
WHERE is_subagent = 0;

-- Index new tables
CREATE INDEX IF NOT EXISTS idx_session_history_last_opened ON session_history(last_opened DESC);
CREATE INDEX IF NOT EXISTS idx_session_history_pinned ON session_history(is_pinned, last_opened DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_session ON workspace_snapshots(session_id, saved_at DESC);
```

Migration is additive and non-destructive. Existing data is preserved. The backfill populates history records for all existing sessions so they appear in the home dashboard immediately.
