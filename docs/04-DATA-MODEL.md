# Data Model Specification

## AgentWatch v2.0

**Amendment:** Sections 2.7-2.10 and 6 added per `08-REFINEMENT-AGENT-PANES-SESSION-HISTORY-WORKSPACE-PERSISTENCE.md`

---

## 1. Source Data: Claude Code JSONL Format

### 1.1 File Location

```
~/.claude/projects/
  {encoded-project-path}/                         # See path encoding below
    {session-uuid}.jsonl                           # Root orchestrator conversation
    {session-uuid}/
      subagents/
        agent-{hex16}.jsonl                        # Named Agent/Task subagent
        agent-{hex16}.meta.json                    # { agentType, toolUseId, description }
        workflows/
          {wf-run-id}/
            journal.jsonl                          # { agentId, key } mappings
            agent-{hex16}.jsonl                    # Workflow subagent transcript
            agent-{hex16}.meta.json                # { agentType: "workflow-subagent" }
      workflows/
        {wf-run-id}.json                           # Has workflowProgress[].{ agentId, label }
      tool-results/
        {toolUseId}.txt                            # Large tool results stored externally
```

**Path encoding:** Project directory names use a custom encoding (NOT base64). Special characters in the path are replaced with `-`:
- `:` → `-`
- `\` → `-`
- `/` → `-`

Example: `C:\Users\makum\MyProject` → `C--Users-makum-MyProject`

The parser detects Windows-encoded paths by matching the pattern `^[A-Z]--` and produces a human-readable display form.

**Subagent discovery:** `lib/parser/agent-correlator.ts` finds all subagents by scanning:
1. `{sessionDir}/subagents/agent-*.jsonl` for named Agent/Task subagents
2. `{sessionDir}/subagents/workflows/{wf-id}/agent-*.jsonl` for workflow subagents
3. `{sessionDir}/workflows/{wf-id}.json` → `workflowProgress[].{agentId, label}` for workflow agent labels

The `agentId` in `workflowProgress` is the hex portion only (without `agent-` prefix). The `jsonl_path` for each agent is stored in the database so messages can be read directly from the correct file.

### 1.2 JSONL Line Types

Each line in a `.jsonl` file is a self-contained JSON object. **Critical:** the actual Claude Code format wraps all messages in an outer envelope. The `role` and `content` are inside a nested `message` field — not at the top level.

**Outer envelope (all lines):**
```json
{
  "type": "user" | "assistant" | "queue-operation" | "mode" | ...,
  "message": { /* inner message object */ },
  "uuid": "...",
  "timestamp": "2026-05-30T10:00:00.000Z"
}
```

Only lines with `type === "user"` or `type === "assistant"` contain parseable conversation content. All other `type` values (queue-operation, mode, etc.) are metadata and should be skipped.

**User Message (outer + inner):**
```json
{
  "type": "user",
  "uuid": "msg-abc123",
  "timestamp": "2026-05-30T10:00:00.000Z",
  "message": {
    "role": "user",
    "content": [
      { "type": "text", "text": "Find all payment-related files" }
    ]
  }
}
```

**Assistant Message (outer + inner):**
```json
{
  "type": "assistant",
  "uuid": "msg-def456",
  "timestamp": "2026-05-30T10:00:02.000Z",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "text", "text": "I'll search for payment files." },
      {
        "type": "tool_use",
        "id": "toolu_01XYZ",
        "name": "Grep",
        "input": { "pattern": "PaymentService", "type": "ts" }
      }
    ],
    "model": "claude-opus-4-6",
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 5230,
      "output_tokens": 342,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 4100
    }
  }
}
```

**Tool Result** arrives as a `type: "user"` line whose `message.content` contains tool_result blocks:
```json
{
  "type": "user",
  "uuid": "msg-ghi789",
  "timestamp": "2026-05-30T10:00:03.000Z",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01XYZ",
        "content": [
          { "type": "text", "text": "src/payment/PaymentService.ts\nsrc/api/PaymentController.ts" }
        ],
        "is_error": false
      }
    ]
  }
}
```

**Thinking blocks** appear as `type: "thinking"` inside `message.content` for extended thinking models. The parser filters these out (they are never shown to the user).

### 1.3 Agent Invocation Patterns

**Agent Tool Call (Subagent):**
```json
{
  "type": "tool_use",
  "id": "toolu_01ABC",
  "name": "Agent",
  "input": {
    "description": "Search for payment flow code",
    "prompt": "Find all files that implement the payment flow. Look for PaymentService, PaymentController, and related types.",
    "subagent_type": "Explore",
    "model": "sonnet"
  }
}
```

**Agent Tool Result (Subagent Response):**
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01ABC",
  "content": [
    {
      "type": "text",
      "text": "Found 5 files implementing the payment flow:\n1. src/payment/PaymentService.ts..."
    }
  ]
}
```

**Workflow Tool Call:**
```json
{
  "type": "tool_use",
  "id": "toolu_01DEF",
  "name": "Workflow",
  "input": {
    "script": "export const meta = { name: 'review', ... }\nconst results = await pipeline(...)...",
    "description": "Review changed files across dimensions"
  }
}
```

**Task Tool Call (Legacy):**
```json
{
  "type": "tool_use",
  "id": "toolu_01GHI",
  "name": "Task",
  "input": {
    "description": "Research payment integration patterns",
    "prompt": "Search for common payment integration patterns...",
    "subagent_type": "general-purpose"
  }
}
```

### 1.4 Subagent Conversation Correlation

When a parent agent invokes `Agent` or `Task`, Claude Code creates a new conversation JSONL file for the child. The child file is in the same project directory as the parent. The correlation is done by:

1. The parent's `tool_use` block has an `id` (e.g., `toolu_01ABC`)
2. The parent's subsequent `tool_result` block has `tool_use_id: "toolu_01ABC"` and contains the child's response
3. The child conversation's JSONL file can be identified by:
   - Being created at approximately the same timestamp as the tool_use
   - Having a first user message that matches the `prompt` from the tool_use input
   - Having a `parentConversationId` metadata field (when available)

---

## 2. Application Data Model

### 2.1 Entity Relationship Diagram

```
+------------------+       +------------------+       +------------------+
|    Session       |       |     Agent        |       |    Message       |
|------------------|       |------------------|       |------------------|
| id (PK)          |<----->| id (PK)          |<----->| id (PK)          |
| project          |  1:N  | session_id (FK)  |  1:N  | agent_id (FK)    |
| created          |       | parent_id (FK)   |       | role             |
| last_modified    |       | conversation_id  |       | content (JSON)   |
| total_tokens     |       | subagent_type    |       | timestamp        |
| total_agents     |       | model            |       | token_usage      |
| total_tool_calls |       | prompt           |       | tool_calls (JSON)|
| duration         |       | status           |       +------------------+
| primary_model    |       | start_time       |
+------------------+       | end_time         |       +------------------+
                           | tokens_total     |       |    Artifact      |
                           | message_count    |       |------------------|
                           | tool_summary     |       | id (PK)          |
                           +------------------+       | session_id (FK)  |
                                |                     | agent_id (FK)    |
                                | 1:N                 | type             |
                                v                     | file_path        |
                           +------------------+       | tool_name        |
                           | TimelineEvent    |       | timestamp        |
                           |------------------|       | content_preview  |
                           | id (PK)          |       | content_size     |
                           | session_id (FK)  |       +------------------+
                           | agent_id (FK)    |
                           | event_type       |       +------------------+
                           | timestamp        |       |    Workflow      |
                           | details (JSON)   |       |------------------|
                           +------------------+       | id (PK)          |
                                                      | session_id (FK)  |
                                                      | agent_id (FK)    |
                                                      | name             |
                                                      | description      |
                                                      | phases (JSON)    |
                                                      | script_preview   |
                                                      +------------------+
```

### 2.2 Session Entity

Represents the root-level conversation and all its descendant agents.

```typescript
interface Session {
  id: string;                    // Conversation UUID (root)
  project: string;               // Working directory path
  created: string;               // ISO 8601 timestamp
  lastModified: string;          // ISO 8601 timestamp
  status: 'active' | 'idle' | 'completed' | 'errored';
  
  // Aggregate metrics
  totalMessages: number;         // Across all agents
  totalTokens: number;           // Input + output across all agents
  totalAgents: number;           // Including root orchestrator
  totalToolCalls: number;        // Across all agents
  primaryModel: string;          // Most-used model
  
  // Duration
  duration: {
    wallClock: number;           // End - start (ms)
    agentTime: number;           // Sum of all agent durations (ms)
    parallelismFactor: number;   // agentTime / wallClock
  };
  
  // Cost estimation
  estimatedCost: {
    total: number;               // USD
    byModel: Record<string, number>;
  };
}
```

### 2.3 Agent Entity

Represents a single agent (orchestrator or subagent) within a session.

```typescript
interface Agent {
  id: string;                    // Unique agent ID
  sessionId: string;             // Root session ID
  conversationId: string;        // This agent's conversation JSONL ID
  parentId: string | null;       // Parent agent ID (null for root)
  parentConversationId: string | null;
  toolUseId: string | null;      // tool_use block ID in parent
  
  // Classification
  type: 'orchestrator' | 'subagent' | 'workflow';
  subagentType: string | null;   // "Explore", "Plan", "general-purpose", etc.
  
  // Execution
  model: string;                 // Model used
  status: 'running' | 'completed' | 'errored' | 'unknown';
  startTime: string;             // ISO 8601
  endTime: string | null;        // ISO 8601
  durationMs: number;
  
  // Context
  prompt: string | null;         // Prompt received from parent
  description: string | null;    // Description from parent
  response: string | null;       // Final response to parent (truncated)
  schema: object | null;         // Output schema constraint
  isolation: 'worktree' | null;
  
  // Metrics
  messageCount: number;
  tokenUsage: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
    total: number;
  };
  
  // Tool usage summary
  toolCalls: ToolCallSummary[];
  
  // Relationships
  children: string[];            // Child agent IDs
  depth: number;                 // Nesting depth (root = 0)
}

interface ToolCallSummary {
  name: string;                  // Tool name
  count: number;                 // Number of invocations
}
```

### 2.4 Message Entity

Represents a single message within an agent's conversation.

```typescript
interface Message {
  id: string;                    // Message ID
  agentId: string;               // Agent this message belongs to
  role: 'user' | 'assistant' | 'tool';
  timestamp: string;             // ISO 8601
  
  // Content (polymorphic)
  content: ContentBlock[];
  
  // Metadata (assistant messages only)
  model?: string;
  stopReason?: string;
  tokenUsage?: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
  
  // Computed
  isPrompt: boolean;             // First user message = parent's prompt
  isResponse: boolean;           // Last assistant message = response to parent
  toolCalls: ResolvedToolCall[]; // tool_use matched with tool_result
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: ContentBlock[] };

interface ResolvedToolCall {
  id: string;                    // tool_use ID
  name: string;                  // Tool name
  input: any;                    // Tool input parameters
  result: any;                   // Tool result content
  isError: boolean;              // Whether tool returned an error
  durationMs: number | null;     // Time between tool_use and tool_result
  isAgentSpawn: boolean;         // Whether this spawned a child agent
  childAgentId: string | null;   // If isAgentSpawn, the child's agent ID
}
```

### 2.5 Artifact Entity

Represents a file created or modified during the session.

```typescript
interface Artifact {
  id: string;                    // Unique artifact ID
  sessionId: string;             // Root session ID
  agentId: string;               // Agent that performed the operation
  type: 'create' | 'modify' | 'delete';
  filePath: string;              // File path
  toolName: string;              // 'Write', 'Edit', 'NotebookEdit'
  timestamp: string;             // ISO 8601
  contentPreview: string | null; // First 500 characters
  contentSize: number;           // Full content size in bytes
  
  // Lineage (computed)
  createdBy: string;             // Agent ID of first creator
  modifiedBy: string[];          // Agent IDs of subsequent modifiers
  consumedBy: string[];          // Agent IDs that read this file
}
```

### 2.6 Timeline Event Entity

Pre-computed events for the timeline visualization.

```typescript
interface TimelineEvent {
  id: number;                    // Auto-increment ID
  sessionId: string;             // Root session ID
  agentId: string;               // Agent involved
  eventType: 'agent_start' | 'agent_end' | 'tool_call' | 'tool_result' | 'artifact_create' | 'artifact_modify';
  timestamp: string;             // ISO 8601
  details: {
    toolName?: string;
    filePath?: string;
    status?: string;
    tokenCount?: number;
  };
}
```

### 2.7 Workspace Layout Entity (Stored in SQLite)

```typescript
interface WorkspaceLayout {
  name: string;                  // User-defined name
  createdAt: string;             // ISO 8601
  tree: LayoutNode;              // Recursive tree structure
}

type LayoutNode =
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;            // 0.1 to 0.9
      children: [LayoutNode, LayoutNode];
    }
  | {
      type: 'pane';
      id: string;               // Unique pane ID
      tabs: PaneTab[];
      activeTab: number;
    };

type PaneTab =
  | { type: 'agent'; agentId: string; label: string; activeSubTab?: AgentSubTab }
  | { type: 'timeline'; label: string }
  | { type: 'graph'; label: string }
  | { type: 'artifacts'; label: string }
  | { type: 'analytics'; label: string }
  | { type: 'context'; agentId: string; label: string }
  | { type: 'artifact-content'; artifactId: string; label: string }
  | { type: 'artifact-diff'; artifactIds: [string, string]; label: string };

type AgentSubTab = 'conversation' | 'artifacts' | 'context' | 'tools' | 'summary';
```

### 2.8 Session History Entity

Tracks every session the user has opened, enabling the home dashboard and search.

```typescript
interface SessionHistory {
  sessionId: string;             // Conversation UUID
  title: string;                 // Auto-generated or user-edited
  summary: string | null;        // First user message excerpt or user-written
  project: string;               // Working directory path
  
  // Timestamps
  sessionCreated: string;        // When the Claude session started (ISO 8601)
  firstOpened: string;           // When user first opened it in this app (ISO 8601)
  lastOpened: string;            // Most recent open (ISO 8601)
  openCount: number;             // Number of times opened
  
  // Cached metrics
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
  notes: string | null;          // Free-text notes
  
  // Status
  sourceExists: boolean;         // Whether JSONL file still exists
  lastIndexed: string;           // When metadata was last refreshed
}
```

### 2.9 Workspace Snapshot Entity

Captures the full state of a workspace so it can be restored on reopen.

```typescript
interface WorkspaceSnapshot {
  id: string;                    // Unique snapshot ID
  sessionId: string;             // Which session
  savedAt: string;               // ISO 8601
  isAutoSave: boolean;           // Auto-save vs. user-named
  name: string | null;           // User-defined name (null for auto-saves)
  
  // Layout tree
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
  tabs: PaneTab[];
  activeTabIndex: number;
  tabStates: Record<string, TabViewState>;
}

interface TabViewState {
  activeSubTab?: AgentSubTab;
  scrollPosition?: number;
  expandedToolCalls?: string[];
  expandedArtifacts?: string[];
  timelineZoom?: number;
  timelinePanOffset?: number;
  artifactFilter?: string;
  artifactSort?: string;
  selectedArtifactId?: string;
  searchQuery?: string;
}

interface FilterState {
  agentTypes: string[];
  tools: string[];
  timeRange: { start: string; end: string } | null;
  messageRoles: string[];
}
```

### 2.10 User Preferences Entity

```typescript
interface UserPreferences {
  alwaysResumeWorkspace: boolean;  // Skip resume dialog
  defaultLayoutPreset: string;     // 'single', 'side-by-side', etc.
  sidebarWidth: number;            // Pixels
  maxPinnedSessions: number;       // Soft limit (default: 10)
  theme: 'dark';                   // Future: 'light'
}
```

---

## 3. Data Flow

### 3.1 Session Ingestion Pipeline

```
~/.claude/projects/{project}/{session}.jsonl
                    |
                    v
         +-------------------+
         | JSONL Stream Parse |
         | (line-by-line)     |
         +--------+----------+
                  |
                  v
         +-------------------+
         | Message Extraction |
         | - Correlate tool_  |
         |   use/result pairs |
         | - Extract metadata |
         +--------+----------+
                  |
                  v
         +-------------------+
         | Agent Detection    |
         | - Find Agent/Task  |
         |   /Workflow calls  |
         | - Match child JSONL|
         |   files            |
         +--------+----------+
                  |
                  v (recursive for each child)
         +-------------------+
         | Agent Graph Build  |
         | - Build tree       |
         | - Calculate timing |
         | - Extract artifacts|
         +--------+----------+
                  |
                  v
         +-------------------+
         | SQLite Persist     |
         | - agents table     |
         | - artifacts table  |
         | - timeline_events  |
         | - FTS5 index       |
         +--------+----------+
                  |
                  v
         +-------------------+
         | Cache + Notify     |
         | - Store in         |
         |   DataCache        |
         | - WebSocket event  |
         +-------------------+
```

### 3.2 Query Data Flow

```
Browser: GET /api/v2/sessions/:id
         |
         v
    Service Cache Hit? ---- Yes ----> Return cached SessionData
         |
         No
         |
         v
    SQLite: SELECT from agents, artifacts, timeline_events
    WHERE session_id = :id
         |
         v
    Build SessionData object in memory
         |
         v
    Cache in DataCache (TTL: 60s)
         |
         v
    Return JSON response
```

### 3.3 Agent Message Lazy Loading

```
Browser: GET /api/v2/sessions/:id/agent-messages?agentId=...&page=0&limit=50
         |                  ↑ flat route — see Turbopack limitation in 09-NEXTJS-ARCHITECTURE.md
         v
    Look up agent's jsonl_path from agents table
    (fall back to conversations table if jsonl_path is null)
         |
         v
    Read JSONL file at jsonl_path, parse from start to offset
    (file-based pagination — no seek; parse sequentially per page)
         |
         v
    Parse 50 messages, correlate tool_use with tool_result
         |
         v
    Return { messages, total, hasMore }
```

---

## 4. Cost Estimation Model

### 4.1 Pricing Table (Configurable)

```javascript
const MODEL_PRICING = {
  'claude-opus-4-6': {
    input: 15.00,     // per 1M tokens
    output: 75.00,    // per 1M tokens
    cacheWrite: 18.75,
    cacheRead: 1.50
  },
  'claude-sonnet-4-6': {
    input: 3.00,
    output: 15.00,
    cacheWrite: 3.75,
    cacheRead: 0.30
  },
  'claude-haiku-4-5': {
    input: 0.80,
    output: 4.00,
    cacheWrite: 1.00,
    cacheRead: 0.08
  }
};
```

### 4.2 Cost Calculation

```
For each agent:
  model = agent.model (resolved to pricing key)
  cost = (agent.tokenUsage.input * pricing.input / 1_000_000)
       + (agent.tokenUsage.output * pricing.output / 1_000_000)
       + (agent.tokenUsage.cacheCreation * pricing.cacheWrite / 1_000_000)
       + (agent.tokenUsage.cacheRead * pricing.cacheRead / 1_000_000)

session.estimatedCost = sum(agent costs)
```

---

## 5. Implemented SQL Schema

### 5.0 Schema Versioning and Migrations

Migrations run automatically on startup via `lib/db/database.ts`. The current version is **v2**.

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

**v1 (initial):** Creates `conversations`, `agents` (without `jsonl_path`), `session_history`, `workspace_snapshots`, `user_preferences` tables.

**v2 (additive):** Adds `jsonl_path TEXT` column to `agents` table. This column stores the absolute path to the JSONL file for each agent, enabling direct file access for subagents deep in the directory hierarchy (e.g. `~/.claude/projects/X/session-id/subagents/workflows/wf-id/agent-hex.jsonl`).

```sql
-- Added in v2 migration
ALTER TABLE agents ADD COLUMN jsonl_path TEXT;
```

`getAgentMessages()` in `session-ingester.ts` uses `jsonl_path` directly when available, falling back to the `conversations` table lookup only for legacy records.

### 5.A Core Tables (v1)

### 5.B Session History

```sql
CREATE TABLE session_history (
  session_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  project TEXT NOT NULL,
  session_created INTEGER,
  first_opened INTEGER NOT NULL,
  last_opened INTEGER NOT NULL,
  open_count INTEGER DEFAULT 1,
  agent_count INTEGER DEFAULT 0,
  artifact_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_tool_calls INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  primary_model TEXT,
  estimated_cost REAL DEFAULT 0,
  is_pinned BOOLEAN DEFAULT 0,
  is_favorite BOOLEAN DEFAULT 0,
  tags TEXT DEFAULT '[]',
  notes TEXT,
  source_exists BOOLEAN DEFAULT 1,
  last_indexed INTEGER
);

CREATE INDEX idx_session_history_last_opened ON session_history(last_opened DESC);
CREATE INDEX idx_session_history_pinned ON session_history(is_pinned, last_opened DESC);
CREATE INDEX idx_session_history_project ON session_history(project);

CREATE VIRTUAL TABLE session_history_fts USING fts5(
  session_id, title, summary, project, tags,
  tokenize='unicode61 remove_diacritics 2'
);
```

### 5.C Workspace Snapshots

```sql
CREATE TABLE workspace_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  is_auto_save BOOLEAN DEFAULT 1,
  name TEXT,
  snapshot_data TEXT NOT NULL,
  snapshot_size INTEGER,
  FOREIGN KEY (session_id) REFERENCES session_history(session_id)
);

CREATE INDEX idx_workspace_session ON workspace_snapshots(session_id, saved_at DESC);
```

### 5.D User Preferences

```sql
CREATE TABLE user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 5.E Agent Artifact Cross-Reference

```sql
-- Track which agents consumed (read) which files
CREATE TABLE agent_artifact_reads (
  agent_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  tool_name TEXT NOT NULL,         -- 'Read', 'Grep', 'Glob'
  timestamp INTEGER NOT NULL,
  message_index INTEGER,           -- Index in message thread
  PRIMARY KEY (agent_id, artifact_id, timestamp),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (session_id) REFERENCES conversations(id)
);

CREATE INDEX idx_agent_reads_session ON agent_artifact_reads(session_id);
CREATE INDEX idx_agent_reads_file ON agent_artifact_reads(file_path);
```

---

## 6. Data Retention and Cleanup

### 6.1 Source Data

Source `.jsonl` files are mounted read-only. The application never modifies, deletes, or moves source data. Claude Code manages its own retention (30-day default).

### 6.2 Index Data

The SQLite database (`/data/conversations.db`) caches parsed data. It can be deleted at any time and will be rebuilt on next startup. The database grows proportionally to the number of conversations (approximately 1KB per conversation + 500 bytes per agent + FTS5 index).

### 6.3 Stale Data Handling

When a source `.jsonl` file is deleted (e.g., by Claude Code's retention policy), the corresponding database records become stale. The system handles this by:

1. On startup: Running a reconciliation pass that deletes database records for missing files
2. On file watch: FileWatcher `unlink` event triggers record deletion
3. On query: If an agent's JSONL file is missing, return metadata from database but flag messages as unavailable

### 6.4 Session History Retention

Session history records and workspace snapshots are managed separately from the session index:

1. **Session history auto-prune:** Records not opened in 180 days are soft-deleted (marked `source_exists = 0`)
2. **Workspace snapshot cleanup:** When a session history record is deleted, its workspace snapshots are cascade-deleted
3. **Orphaned snapshots:** On startup, delete snapshots whose `session_id` has no matching `session_history` record
4. **Storage budget:** Typical user with 100 sessions generates ~5 MB of history + snapshot data

### 6.5 Storage Budget Summary

| Data | Typical Size per Session | Growth Rate |
|------|------------------------|-------------|
| Session history record | 0.5 KB | 1 per Claude session |
| FTS5 index entry | 0.3 KB | 1 per session |
| Auto-save snapshot | 2-10 KB | 1 per session (overwritten) |
| Named save snapshots | 2-10 KB each | User-driven, max 20 per session |
| Agent artifact reads | 0.1 KB per read | Proportional to agent count |
