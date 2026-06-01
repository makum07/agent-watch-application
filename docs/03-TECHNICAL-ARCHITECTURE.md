# Technical Architecture

## AgentWatch v2.0

**Amendment:** Sections 2.1, 3.1, 4.1 updated per `08-REFINEMENT-AGENT-PANES-SESSION-HISTORY-WORKSPACE-PERSISTENCE.md`
**Superseded:** Frontend architecture (Section 3), Docker architecture (Section 5), and technology choices replaced by `09-NEXTJS-ARCHITECTURE.md`. The Next.js monolith replaces Express + vanilla JS. Backend services (Section 2.2-2.7) remain conceptually identical but are ported to TypeScript under `lib/services/`. API endpoints (Section 2.7) become Next.js API Route Handlers under `app/api/v2/`.

---

## 1. Architecture Overview

### 1.1 High-Level System Diagram

```
+-----------------------------------------------------------------------+
|                           Browser                                     |
|                                                                       |
|  +-------------------+  +-------------------+  +-------------------+  |
|  |  Workspace Engine |  |  Visualization    |  |  State Manager   |  |
|  |  (Pane Manager)   |  |  (Timeline, Graph)|  |  (Session State) |  |
|  +--------+----------+  +--------+----------+  +--------+----------+  |
|           |                      |                      |             |
|  +--------+----------------------+----------------------+----------+  |
|  |                    Frontend Service Layer                       |  |
|  |  SessionService | AgentService | SearchService | WebSocketSvc  |  |
|  +-----------------------------+-----------------------------------+  |
|                                |                                      |
+--------------------------------|--------------------------------------+
                                 | HTTP REST + WebSocket (ws://)
                                 |
+--------------------------------|--------------------------------------+
|                           Docker Container                            |
|                                |                                      |
|  +-----------------------------+-----------------------------------+  |
|  |                    Express.js Server                            |  |
|  |                                                                 |  |
|  |  +-------------+  +---------------+  +----------------------+  |  |
|  |  | Session API |  | Agent Graph   |  | WebSocket Server     |  |  |
|  |  | Routes      |  | Builder       |  | (Real-time events)   |  |  |
|  |  +------+------+  +-------+-------+  +----------+-----------+  |  |
|  |         |                  |                     |              |  |
|  |  +------+------------------+---------------------+-----------+  |  |
|  |  |                   Core Services                           |  |  |
|  |  |                                                           |  |  |
|  |  |  +------------------+  +------------------+               |  |  |
|  |  |  | SessionIngester  |  | AgentGraphEngine |               |  |  |
|  |  |  | (JSONL parsing,  |  | (Parent-child    |               |  |  |
|  |  |  |  correlation)    |  |  relationships,  |               |  |  |
|  |  |  +--------+---------+  |  timeline calc)  |               |  |  |
|  |  |           |            +--------+---------+               |  |  |
|  |  |  +--------+---------+           |                         |  |  |
|  |  |  | ArtifactTracker  |  +--------+---------+               |  |  |
|  |  |  | (File writes,    |  | ContextAnalyzer  |               |  |  |
|  |  |  |  modifications)  |  | (Prompt/response |               |  |  |
|  |  |  +------------------+  |  tracking)       |               |  |  |
|  |  |                        +------------------+               |  |  |
|  |  +-----------------------------------------------------------+  |  |
|  |                              |                                  |  |
|  |  +---------------------------+-------------------------------+  |  |
|  |  |                   Data Layer                              |  |  |
|  |  |                                                           |  |  |
|  |  |  +-----------+  +----------+  +---------+  +-----------+ |  |  |
|  |  |  | SQLite    |  | JSONL    |  | File    |  | DataCache | |  |  |
|  |  |  | (FTS5)    |  | Parser   |  | Watcher |  | (LRU)     | |  |  |
|  |  |  +-----------+  +----------+  +---------+  +-----------+ |  |  |
|  |  +-----------------------------------------------------------+  |  |
|  +------------------------------------------------------------------+  |
|                                                                       |
|  Volumes:                                                             |
|    /home/appuser/.claude (read-only)  --> ~/.claude                   |
|    /data (read-write)                 --> agentwatch-db volume     |
+-----------------------------------------------------------------------+
```

### 1.2 Design Principles

1. **Incremental over Full Rebuild:** Never re-parse a file whose mtime hasn't changed
2. **Lazy Loading:** Load agent message threads on demand, not at session open
3. **Stream, Don't Buffer:** Parse JSONL files line-by-line, never load entire file into memory
4. **Frontend-First Computation:** Timeline layout, graph positioning, and filtering happen in the browser to keep the server stateless
5. **Progressive Enhancement:** Core browsing works without JavaScript visualizations; visualizations enhance the experience

---

## 2. Backend Architecture

### 2.1 Module Structure

```
src/
├── server.js                          # Express app entry point (refactored from chats-mobile.js)
├── routes/
│   ├── sessions.js                    # /api/sessions/* endpoints
│   ├── agents.js                      # /api/agents/* endpoints
│   ├── search.js                      # /api/search endpoints
│   ├── artifacts.js                   # /api/artifacts/* endpoints
│   ├── analytics.js                   # /api/analytics/* endpoints
│   ├── history.js                     # /api/v2/history/* endpoints
│   ├── workspaces.js                  # /api/v2/workspaces/* endpoints
│   ├── preferences.js                 # /api/v2/preferences/* endpoints
│   └── legacy.js                      # /api/conversations/* (backward compat)
├── services/
│   ├── SessionIngester.js             # JSONL parsing + agent graph construction
│   ├── AgentGraphEngine.js            # Parent-child correlation, timeline
│   ├── ArtifactTracker.js             # File write/edit tracking
│   ├── ContextAnalyzer.js             # Context flow analysis
│   ├── DebugAnalyzer.js               # Bottleneck/loop/duplicate detection
│   ├── SessionHistoryService.js       # Session history CRUD + search
│   ├── WorkspaceSnapshotService.js    # Workspace save/restore
│   └── PreferencesService.js          # User preferences
├── analytics/                         # (existing, retained)
│   ├── core/
│   │   ├── ConversationAnalyzer.js
│   │   ├── SessionAnalyzer.js
│   │   ├── AgentAnalyzer.js
│   │   ├── StateCalculator.js
│   │   ├── FileWatcher.js
│   │   └── ProcessDetector.js
│   ├── data/
│   │   ├── DatabaseBackend.js
│   │   ├── DatabaseManager.js
│   │   ├── Indexer.js
│   │   └── DataCache.js
│   ├── notifications/
│   │   ├── WebSocketServer.js
│   │   └── NotificationManager.js
│   └── utils/
│       └── PerformanceMonitor.js
└── analytics-web/                     # Frontend (see Section 3)
```

### 2.2 New Service: SessionIngester

**Responsibility:** Parse a single session's JSONL file(s) and produce a structured session object with full agent graph.

```javascript
class SessionIngester {
  // Parse a session and all its child agent conversations
  async ingestSession(sessionId) {
    // 1. Load main conversation JSONL
    // 2. Parse messages, extracting tool_use blocks for Agent/Task/Workflow
    // 3. For each agent invocation, find child JSONL file
    // 4. Recursively parse child conversations
    // 5. Build agent tree
    // 6. Calculate timeline
    // 7. Extract artifacts
    // 8. Return SessionData object
  }

  // Parse a single JSONL file into structured messages
  async parseConversation(filePath) {
    // Stream-parse JSONL line-by-line
    // Correlate tool_use with tool_result by tool_use_id
    // Extract metadata (tokens, model, timestamps)
    // Return { messages, metadata, toolCalls }
  }

  // Find the JSONL file for a child agent
  async findChildConversation(parentPath, toolUseId) {
    // Search in same project directory
    // Match by examining tool_result blocks
    // Return file path or null
  }
}
```

**Performance Characteristics:**
- Streaming JSONL parsing: O(n) memory where n = single line size
- Agent tree construction: O(a * m) where a = agents, m = average messages per agent
- Caching: Parsed sessions cached by (sessionId, mtime) pair

### 2.3 New Service: AgentGraphEngine

**Responsibility:** Build and query the agent relationship graph.

```javascript
class AgentGraphEngine {
  // Build the full agent hierarchy for a session
  buildGraph(sessionData) {
    // Returns: { nodes: Agent[], edges: Edge[], root: AgentId }
  }

  // Calculate the execution timeline
  buildTimeline(sessionData) {
    // Returns: TimelineEvent[] sorted by timestamp
    // Events: agent_start, agent_end, tool_call, artifact_create
  }

  // Find all descendants of an agent
  getDescendants(agentId) { ... }

  // Find the path from root to an agent
  getAncestorPath(agentId) { ... }

  // Get agents that were concurrent at a given timestamp
  getConcurrentAgents(timestamp) { ... }
}
```

### 2.4 New Service: ArtifactTracker

**Responsibility:** Track file creation and modification across agents.

```javascript
class ArtifactTracker {
  // Extract all artifacts from a session
  extractArtifacts(sessionData) {
    // Scan all agents' tool calls for Write, Edit, NotebookEdit
    // Track file path, content, agent, timestamp
    // Build producer/consumer relationships
    // Return Artifact[]
  }

  // Get artifacts for a specific agent
  getAgentArtifacts(agentId) { ... }

  // Get the modification history of a file
  getFileHistory(filePath) { ... }
}
```

### 2.5 New Service: ContextAnalyzer

**Responsibility:** Track what context flowed between agents.

```javascript
class ContextAnalyzer {
  // Analyze context flow for an agent
  analyzeContext(agentId, sessionData) {
    // Extract: prompt received from parent
    // Extract: response sent to parent
    // Calculate: token counts
    // Detect: schema constraints
    // Detect: model overrides
    // Return ContextFlowData
  }

  // Build the full context flow graph
  buildContextGraph(sessionData) {
    // Returns edges: { from, to, promptTokens, responseTokens }
  }
}
```

### 2.6 New Service: DebugAnalyzer

**Responsibility:** Detect issues and generate debugging insights.

```javascript
class DebugAnalyzer {
  // Run all debug checks on a session
  analyze(sessionData) {
    return {
      bottlenecks: this.detectBottlenecks(sessionData),
      duplicateWork: this.detectDuplicateWork(sessionData),
      excessiveToolUsage: this.detectExcessiveToolUsage(sessionData),
      potentialLoops: this.detectLoops(sessionData),
      contextBloat: this.detectContextBloat(sessionData),
      failures: this.detectFailures(sessionData)
    };
  }
}
```

### 2.7 API Endpoints (New)

#### Session Endpoints

```
GET    /api/v2/sessions
       Query: ?project=&limit=&offset=&sort=
       Returns: Paginated list of sessions with metadata

GET    /api/v2/sessions/:id
       Returns: Full session data with agent graph

GET    /api/v2/sessions/:id/agents
       Returns: Agent list with hierarchy

GET    /api/v2/sessions/:id/agents/:agentId
       Returns: Single agent with full message thread

GET    /api/v2/sessions/:id/agents/:agentId/messages
       Query: ?page=&limit=
       Returns: Paginated agent messages

GET    /api/v2/sessions/:id/timeline
       Returns: Timeline events for visualization

GET    /api/v2/sessions/:id/artifacts
       Returns: All artifacts with lineage

GET    /api/v2/sessions/:id/artifacts/:artifactId
       Returns: Artifact content and history

GET    /api/v2/sessions/:id/context/:agentId
       Returns: Context flow data for an agent

GET    /api/v2/sessions/:id/analytics
       Returns: Session-level analytics and debug alerts

POST   /api/v2/sessions/:id/search
       Body: { query, agentIds?, toolFilter?, timeRange? }
       Returns: Search results grouped by agent
```

#### Backward Compatibility

All existing `/api/conversations/*` endpoints continue to work unchanged. The v2 API is additive.

---

## 3. Frontend Architecture

### 3.1 Module Structure

```
src/analytics-web/
├── index.html                         # Entry point (v2 workspace)
├── chats_mobile.html                  # Legacy entry point (retained)
├── styles/
│   ├── workspace.css                  # Pane system styles
│   ├── timeline.css                   # Timeline visualization
│   ├── agent-view.css                 # Agent message rendering
│   └── variables.css                  # CSS custom properties (theme)
├── components/
│   ├── App.js                         # (existing, extended)
│   ├── Sidebar.js                     # (existing, extended)
│   ├── DashboardPage.js               # (existing, retained)
│   ├── workspace/
│   │   ├── WorkspaceManager.js        # Layout tree manager
│   │   ├── PaneContainer.js           # Recursive pane renderer
│   │   ├── Pane.js                    # Single pane with tabs
│   │   ├── PaneDivider.js             # Resize handle
│   │   ├── PaneTabBar.js              # Tab management
│   │   └── LayoutPresets.js           # Preset layout definitions
│   ├── agent/
│   │   ├── AgentSidebar.js            # Agent hierarchy panel
│   │   ├── AgentView.js               # Agent message thread renderer
│   │   ├── AgentMessage.js            # Single message card
│   │   ├── ToolCallCard.js            # Tool call display (expandable)
│   │   ├── ContextInspector.js        # Context flow panel
│   │   └── AgentBadge.js              # Status/type badge
│   ├── visualization/
│   │   ├── TimelineView.js            # Execution timeline (Canvas or SVG)
│   │   ├── AgentGraphView.js          # Hierarchy tree / DAG
│   │   ├── ContextFlowView.js         # Context propagation diagram
│   │   └── TokenChart.js              # Token usage charts
│   ├── search/
│   │   ├── GlobalSearch.js            # Session-wide search
│   │   └── PaneSearch.js              # In-pane search
│   ├── artifacts/
│   │   ├── ArtifactList.js            # File list with lineage
│   │   ├── ArtifactViewer.js          # Content viewer with highlighting
│   │   └── ArtifactDiff.js            # Diff view
│   ├── analytics/
│   │   ├── SessionAnalytics.js        # Summary dashboard
│   │   ├── DebugAlerts.js             # Issue detection display
│   │   └── CostBreakdown.js           # Cost analysis
│   └── shared/
│       ├── CodeBlock.js               # Syntax-highlighted code
│       ├── MarkdownRenderer.js        # Markdown to HTML
│       ├── DragDropManager.js         # Drag and drop orchestrator
│       └── TooltipManager.js          # Tooltip system
├── services/
│   ├── WebSocketService.js            # (existing, extended)
│   ├── DataService.js                 # (existing, extended)
│   ├── StateService.js                # (existing, extended)
│   ├── SessionService.js              # Session data fetching/caching
│   ├── AgentService.js                # Agent data management
│   ├── SearchService.js               # Search operations
│   └── LayoutService.js               # Layout persistence
└── utils/
    ├── colors.js                      # Agent type color mapping
    ├── time.js                        # Duration formatting
    └── tokens.js                      # Token count formatting
```

### 3.2 Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| UI Framework | Vanilla JavaScript (ES modules) | Consistency with existing codebase. No build step required. Minimizes container size. |
| CSS | CSS Modules (via `<style>` scoping) + CSS Custom Properties | No preprocessor needed. Theme support via variables. |
| Visualization | Canvas 2D (timeline) + SVG (graph) | Canvas for performance with large timelines. SVG for interactive graph nodes. |
| Markdown | marked.js (existing) | Already in use, proven reliable |
| Syntax Highlighting | Prism.js (lightweight) | 15KB gzipped, supports 200+ languages, no build step |
| Drag & Drop | HTML5 Drag and Drop API | Native, no library needed |
| State | Custom reactive store (observer pattern) | No framework dependency. Simple pub/sub. |

### 3.3 Workspace Engine Architecture

The workspace uses a recursive binary tree rendered with CSS Flexbox:

```javascript
class WorkspaceManager {
  constructor() {
    this.layoutTree = null;     // Root LayoutNode
    this.panes = new Map();     // paneId -> PaneState
    this.focusedPaneId = null;
    this.savedLayouts = {};     // name -> LayoutTree
  }

  // Create initial layout
  initialize(sessionData) {
    this.layoutTree = {
      type: 'pane',
      id: this.generatePaneId(),
      tabs: [{ type: 'agent', agentId: sessionData.rootAgentId }],
      activeTab: 0
    };
    this.render();
  }

  // Split a pane
  splitPane(paneId, direction, newContent) {
    const paneNode = this.findNode(paneId);
    const parent = this.findParent(paneId);
    const newPane = { type: 'pane', id: this.generatePaneId(), tabs: [newContent], activeTab: 0 };
    const splitNode = {
      type: 'split',
      direction: direction,
      ratio: 0.5,
      children: [paneNode, newPane]
    };
    this.replaceNode(parent, paneId, splitNode);
    this.render();
  }

  // Render the layout tree recursively
  render() {
    const container = document.getElementById('workspace');
    container.innerHTML = '';
    container.appendChild(this.renderNode(this.layoutTree));
  }

  renderNode(node) {
    if (node.type === 'pane') {
      return new Pane(node, this).element;
    }
    if (node.type === 'split') {
      const container = document.createElement('div');
      container.className = `split-${node.direction}`;
      container.style.display = 'flex';
      container.style.flexDirection = node.direction === 'horizontal' ? 'row' : 'column';

      const child1 = this.renderNode(node.children[0]);
      child1.style.flexBasis = `${node.ratio * 100}%`;

      const divider = new PaneDivider(node, this).element;

      const child2 = this.renderNode(node.children[1]);
      child2.style.flexBasis = `${(1 - node.ratio) * 100}%`;

      container.append(child1, divider, child2);
      return container;
    }
  }
}
```

### 3.4 State Management

```javascript
class SessionState {
  constructor() {
    this.listeners = new Map();
    this.state = {
      session: null,          // Current session data
      agents: [],             // Agent list with hierarchy
      focusedAgentId: null,   // Currently focused agent
      layout: null,           // Workspace layout tree
      searchQuery: '',        // Current search
      searchResults: null,    // Search results
      filters: {              // Active filters
        agentTypes: [],
        tools: [],
        timeRange: null
      },
      timeline: {             // Timeline state
        zoom: 1,
        panOffset: 0,
        selectedAgentId: null
      }
    };
  }

  // Reactive updates
  set(key, value) {
    this.state[key] = value;
    this.notify(key);
  }

  subscribe(key, callback) {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(callback);
    return () => this.listeners.get(key).delete(callback);
  }

  notify(key) {
    const listeners = this.listeners.get(key);
    if (listeners) listeners.forEach(cb => cb(this.state[key]));
  }
}
```

### 3.5 Rendering Pipeline

```
User Action (click, drag, search)
       |
State Update (SessionState.set)
       |
Notify Subscribers
       |
  +----+----+
  |         |
Pane      Visualization
Update    Re-render
  |         |
DOM Diff  Canvas/SVG
(manual)  Redraw
```

For performance, the system uses manual DOM diffing in agent views:
- Message cards are created once and cached
- Only new messages are appended
- Tool call expansion/collapse is CSS-only (height toggle)
- Timeline uses Canvas for smooth 60fps pan/zoom

---

## 4. Data Model

### 4.1 Database Schema (Extended)

```sql
-- Existing tables retained as-is:
-- conversations, conversation_fts, tool_usage, file_index

-- New: Agent relationship tracking
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,       -- The conversation this agent belongs to
  parent_agent_id TEXT,                -- Parent agent (null for root)
  parent_conversation_id TEXT,         -- Parent conversation that spawned this
  tool_use_id TEXT,                    -- tool_use block ID in parent
  subagent_type TEXT,                  -- e.g., "Explore", "Plan", "general-purpose"
  model TEXT,                          -- Model override if any
  prompt TEXT,                         -- Prompt received from parent
  description TEXT,                    -- Description from parent
  status TEXT DEFAULT 'unknown',       -- completed, errored, running
  start_time INTEGER,                  -- Unix timestamp (ms)
  end_time INTEGER,                    -- Unix timestamp (ms)
  message_count INTEGER DEFAULT 0,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
);

CREATE INDEX idx_agents_conversation ON agents(conversation_id);
CREATE INDEX idx_agents_parent ON agents(parent_agent_id);
CREATE INDEX idx_agents_parent_conversation ON agents(parent_conversation_id);

-- New: Artifact tracking
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,            -- Root conversation ID
  agent_id TEXT NOT NULL,              -- Agent that created/modified
  type TEXT NOT NULL,                  -- 'create', 'modify', 'delete'
  file_path TEXT NOT NULL,             -- File path
  tool_name TEXT NOT NULL,             -- 'Write', 'Edit', 'NotebookEdit'
  timestamp INTEGER NOT NULL,          -- Unix timestamp (ms)
  content_preview TEXT,                -- First 500 chars
  content_size INTEGER,                -- Full content size
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX idx_artifacts_session ON artifacts(session_id);
CREATE INDEX idx_artifacts_agent ON artifacts(agent_id);
CREATE INDEX idx_artifacts_path ON artifacts(file_path);

-- New: Timeline events (materialized for performance)
CREATE TABLE timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,            -- agent_start, agent_end, tool_call, artifact
  timestamp INTEGER NOT NULL,
  details TEXT,                        -- JSON blob
  FOREIGN KEY (session_id) REFERENCES conversations(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX idx_timeline_session ON timeline_events(session_id, timestamp);

-- New: Workflow tracking
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,              -- Agent that ran the workflow
  name TEXT,
  description TEXT,
  phases TEXT,                         -- JSON array of phase names
  script_preview TEXT,                 -- First 1000 chars of script
  FOREIGN KEY (session_id) REFERENCES conversations(id)
);
```

### 4.2 In-Memory Data Structures

```javascript
// Session graph (built by AgentGraphEngine)
const sessionGraph = {
  root: 'agent-001',
  nodes: new Map([
    ['agent-001', {
      id: 'agent-001',
      conversationId: 'conv-abc',
      parentId: null,
      children: ['agent-002', 'agent-003'],
      type: 'orchestrator',
      subagentType: null,
      model: 'claude-opus-4-6',
      status: 'completed',
      startTime: 1717056000000,
      endTime: 1717065000000,
      messageCount: 124,
      tokenUsage: { input: 50000, output: 30000, total: 80000 },
      toolCalls: { Bash: 15, Read: 22, Agent: 8 },
      prompt: null
    }],
    // ... more agents
  ]),
  edges: [
    { from: 'agent-001', to: 'agent-002', type: 'spawn', toolUseId: 'tu-1' },
    { from: 'agent-001', to: 'agent-003', type: 'spawn', toolUseId: 'tu-2' }
  ],
  timeline: [
    { timestamp: 1717056000000, type: 'agent_start', agentId: 'agent-001' },
    { timestamp: 1717056300000, type: 'agent_start', agentId: 'agent-002' },
    // ...
  ]
};

// Agent messages (lazy-loaded per agent)
const agentMessages = {
  'agent-002': [
    {
      id: 'msg-1',
      role: 'user',
      timestamp: 1717056300000,
      content: [{ type: 'text', text: 'Find payment files...' }],
      isPrompt: true  // First user message = prompt from parent
    },
    {
      id: 'msg-2',
      role: 'assistant',
      timestamp: 1717056302000,
      content: [
        { type: 'text', text: 'I\'ll search for payment files.' },
        { type: 'tool_use', id: 'tu-10', name: 'Grep', input: { pattern: 'PaymentService' } }
      ],
      toolCalls: [{
        id: 'tu-10',
        name: 'Grep',
        input: { pattern: 'PaymentService' },
        result: { files: ['src/payment.ts'] },
        duration: 150
      }]
    }
  ]
};
```

---

## 5. Docker Architecture

### 5.1 Container Topology

```
+-------------------------------------------------------------------+
|  Host Machine                                                     |
|                                                                   |
|  ~/.claude/projects/ (read-only mount)                            |
|  agentwatch-db (named volume)                                  |
|                                                                   |
|  +-------------------------------------------------------------+  |
|  |  agentwatch (container)                        |  |
|  |                                                             |  |
|  |  Node.js 20 Alpine                                         |  |
|  |  Express.js server (port 3456)                             |  |
|  |                                                             |  |
|  |  /home/appuser/.claude  <-- ~/.claude (read-only)          |  |
|  |  /data                  <-- agentwatch-db (read-write)  |  |
|  |                                                             |  |
|  |  Capabilities: dropped ALL                                 |  |
|  |  Security: no-new-privileges, read-only rootfs             |  |
|  |  Memory: 2GB limit (up from 1GB for large sessions)        |  |
|  |  Temp: /tmp (noexec, 128MB - up from 64MB)                 |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  Port mapping: 3456:3456                                          |
+-------------------------------------------------------------------+
```

### 5.2 Docker Compose (Extended)

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
      - LOG_LEVEL=${LOG_LEVEL:-info}
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
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3456/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  agentwatch-data:
    name: agentwatch-db
```

### 5.3 Dockerfile (Extended)

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
ARG APP_UID=1000
ARG APP_GID=1000
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .

# Stage 2: Runtime
FROM node:20-alpine
ARG APP_UID=1000
ARG APP_GID=1000
RUN addgroup -g ${APP_GID} appgroup && \
    adduser -u ${APP_UID} -G appgroup -s /bin/sh -D appuser && \
    mkdir -p /data && chown appuser:appgroup /data
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/src ./src
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
USER appuser
EXPOSE 3456
CMD ["node", "src/server.js"]
```

### 5.4 Persistence Strategy

| Data | Storage | Lifecycle |
|------|---------|-----------|
| SQLite database | Docker named volume `agentwatch-data` | Persists across container restarts. Survives `docker compose down`. Destroyed only by `docker volume rm`. |
| Parsed session cache | In-memory (DataCache) | Lost on container restart. Rebuilt lazily on demand. |
| User workspace layouts | Browser localStorage | Per-browser, per-origin. Survives container restarts. |
| Saved searches | Browser localStorage | Same as layouts. |

### 5.5 Upgrade Strategy

```bash
# 1. Stop the running container
docker compose down

# 2. Pull/extract new source code
# (overwrite src/ directory)

# 3. Rebuild and start
docker compose up --build -d

# Database migrations run automatically on startup
# Existing indexed data is preserved
# New schema additions are applied incrementally
```

### 5.6 Backup Strategy

```bash
# Backup the database
docker compose exec agentwatch \
  cp /data/conversations.db /tmp/backup.db

docker compose cp agentwatch:/tmp/backup.db ./backup/

# Or directly backup the volume
docker run --rm -v agentwatch-db:/data -v $(pwd)/backup:/backup \
  alpine cp /data/conversations.db /backup/
```

---

## 6. Performance Architecture

### 6.1 Large Session Handling

For sessions with 500+ agents and 10K+ messages:

**Backend:**
- Agent list: Always loaded fully (agent metadata is small: ~500 bytes per agent)
- Agent messages: Loaded on demand per agent, with pagination (50 messages per page)
- Timeline events: Pre-computed during ingestion, stored in `timeline_events` table
- Search: FTS5 index handles 100K+ messages efficiently

**Frontend:**
- Timeline visualization: Canvas rendering with viewport culling (only draw visible agents)
- Agent sidebar: Virtual scrolling for 500+ agents
- Message thread: Virtual scrolling for long conversations
- Graph view: Force-directed layout computed in Web Worker to avoid UI jank

### 6.2 Caching Strategy

```
Request Flow:

Browser Request
     |
     v
Service Layer Cache (DataCache)
     |  TTL: 60s for session data, 300s for static data
     |  LRU: 100 entries max
     |
     v (cache miss)
SQLite Query
     |  Pre-indexed data
     |  FTS5 for text search
     |
     v (index miss for new sessions)
JSONL File Parse
     |  Stream parsing
     |  Result cached in DataCache + indexed in SQLite
```

### 6.3 Memory Budget (2GB container)

| Component | Allocation | Notes |
|-----------|------------|-------|
| Node.js heap | 1.5GB | `--max-old-space-size=2048` minus overhead |
| SQLite cache | 256MB | Configured via `PRAGMA cache_size` |
| DataCache (LRU) | 128MB | 100 entries with eviction |
| JSONL parsing buffer | 64MB | Stream parsing, one line at a time |
| OS + overhead | 64MB | Alpine + Node.js runtime |

---

## 7. Security Architecture

### 7.1 Threat Model

Since this is a local-only application, the threat surface is minimal:

| Threat | Mitigation |
|--------|------------|
| Container escape | All capabilities dropped, read-only filesystem, no-new-privileges |
| Data exfiltration | No network egress (no external calls) |
| JSONL injection | All JSONL content sanitized before HTML rendering (marked.js + DOMPurify) |
| XSS via user content | Content-Security-Policy headers, sanitized markdown rendering |
| SQLite injection | Parameterized queries only (better-sqlite3 prepared statements) |
| Path traversal | File access restricted to `CLAUDE_HOME` via path validation |

### 7.2 Content Security Policy

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self' ws://localhost:3456;
  font-src 'self';
```

Note: `unsafe-inline` is required for the vanilla JS approach (inline event handlers and style blocks). A future migration to a build system would eliminate this.

---

## 8. Extensibility

### 8.1 Plugin Points

The architecture supports future extensibility at these points:

1. **Custom Visualizations:** New visualization components can be added under `components/visualization/` and registered as pane content types
2. **Custom Agent Type Handlers:** `AgentGraphEngine` uses a registry pattern for agent type-specific parsing
3. **Export Formats:** `SessionIngester` produces a structured JSON object that can be serialized to any format
4. **Custom Debug Checks:** `DebugAnalyzer` uses a chain-of-responsibility pattern; new checks can be appended

### 8.2 Future API Extension

The `/api/v2/` prefix allows the API to evolve without breaking the legacy `/api/conversations/` interface. Future versions can introduce `/api/v3/` when needed.
