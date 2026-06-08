# Improvement Loop

## AgentWatch v2.0

**Date:** 2026-06-08
**Status:** Implemented (Phase 1.5 — post-MVP feature)

---

## 1. Overview

The Improvement Loop is a closed-loop feedback system built into AgentWatch. Users review multi-agent sessions, collect feedback on agent behavior, and apply improvements — all without leaving the browser. Improvements are executed by resuming the original Claude Code session with a generated prompt, using Claude's structured streaming protocol and an edit approval gate.

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  1. Review   │───▶│  2. Collect   │───▶│  3. Apply    │───▶│  4. Observe  │
│  Session     │    │  Feedback     │    │  via Claude  │    │  Results     │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       ▲                                                            │
       └────────────────────────────────────────────────────────────┘
                              Rewind & iterate
```

### Key Capabilities

- **Feedback collection** — per-agent, categorized notes (10 categories) stored in SQLite
- **Prompt generation** — aggregates feedback into an improvement prompt for Claude
- **Structured streaming** — uses `--output-format stream-json` to forward Claude's events in real time
- **Edit approval gate** — uses `--permission-mode default` so Edit/Write tools require browser-side approval
- **Rewind** — truncates the session JSONL to before a cycle and re-applies with a refined prompt
- **Artifact viewing** — view files referenced or modified during a cycle
- **Persistent activity log** — every stream event (thinking, tool calls, results) is stored with the cycle for post-hoc review

---

## 2. Architecture

### 2.1 Data Flow

```
Browser (Feedback Panel)
    │
    ├── POST /api/v2/sessions/:id/improvements
    │     └── Spawns: claude --resume <id> -p --output-format stream-json
    │                        --input-format stream-json --verbose
    │                        --permission-mode default
    │
    ├── WebSocket (bidirectional)
    │     ├── Server → Browser: improvement_stream_event (every JSON line from Claude)
    │     ├── Server → Browser: improvement_permission_request (Edit/Write approval needed)
    │     ├── Browser → Server: permission_response (approved/denied)
    │     └── Server → Browser: improvement_complete / improvement_failed
    │
    └── GET /api/v2/sessions/:id/file?path=...
          └── Returns file content for artifact viewing (path-traversal protected)
```

### 2.2 Server-Side Components

| Component | File | Purpose |
|-----------|------|---------|
| Improvements API | `app/api/v2/sessions/[id]/improvements/route.ts` | POST spawns Claude CLI, handles streaming, manages approval gate. GET returns cycle history. POST with `?rewind=` truncates JSONL. DELETE removes cycles. |
| File API | `app/api/v2/sessions/[id]/file/route.ts` | Returns file content for viewing. Resolves project CWD from session's JSONL path slug. Security: resolved path must be within project directory. Caps at 500KB. |
| WebSocket Server | `lib/websocket/ws-server.ts` | Shared via `globalThis.__wss`. Duck-type check (not `instanceof`) for Turbopack module boundary compatibility. |
| Custom Server | `server.ts` | Initializes WsServer on HTTP upgrade, stores on `globalThis.__wss`. |

### 2.3 Client-Side Components

| Component | File | Purpose |
|-----------|------|---------|
| Feedback Store | `store/feedback-store.ts` | Zustand store. Manages feedback items, cycles, live stream entries, pending approvals. Handles all WebSocket event types. |
| Feedback Panel | `components/session/feedback-panel.tsx` | Full UI: feedback tab (categorized notes), history tab (cycle cards with collapsible activity log). |
| WebSocket Hook | `hooks/use-websocket.ts` | Connects to `ws://host/ws`, auto-reconnects on close (3s delay). |

### 2.4 Database Schema

```sql
-- Schema v3: feedback_items
CREATE TABLE feedback_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  message_id TEXT,
  artifact_id TEXT,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  agent_name TEXT,
  created_at INTEGER NOT NULL
);

-- Schema v3: improvement_cycles
CREATE TABLE improvement_cycles (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  cycle_number INTEGER NOT NULL,
  feedback_ids TEXT NOT NULL DEFAULT '[]',
  generated_prompt TEXT NOT NULL,
  claude_response TEXT,
  status TEXT DEFAULT 'pending',    -- applying | completed | failed | rewound
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Schema v4: JSONL snapshot for rewind
ALTER TABLE improvement_cycles ADD COLUMN jsonl_snapshot_size INTEGER;

-- Schema v6: git diff capture
ALTER TABLE improvement_cycles ADD COLUMN file_changes TEXT;   -- JSON array of FileChange

-- Schema v7: persisted stream log
ALTER TABLE improvement_cycles ADD COLUMN stream_entries TEXT;  -- JSON array of StreamEntry
```

---

## 3. Functional Specification

### 3.1 Feedback Collection

Users can add feedback from the **Feedback** tab in any agent pane. Each item has:

| Field | Description |
|-------|-------------|
| `category` | One of 10 types: Missing Context, Incorrect Assumption, Hallucinated Conclusion, Weak Validation, Missing Edge Case, Missing Artifact, Missing Code Exploration, Missing Test Coverage, Workflow Improvement, Other |
| `text` | Free-text note |
| `agentId` | Which agent the note is about |
| `sessionId` | Which session |

Feedback items are editable (category + text) and deletable.

### 3.2 Prompt Generation & Editing

**Apply Improvements** aggregates all feedback items into a structured prompt for Claude. The user can edit the prompt before sending. The prompt includes:

- Session context (which agents, what the session was about)
- Categorized feedback items grouped by agent
- Instructions for Claude to implement improvements

### 3.3 Structured Streaming

When the user confirms the prompt, the server:

1. Records JSONL file size as a snapshot (for future rewind)
2. Spawns `claude --resume <sessionId> -p` with `--output-format stream-json --input-format stream-json --verbose --permission-mode default`
3. Sends the prompt as a `stream-json` user message on stdin
4. Parses newline-delimited JSON from stdout
5. Broadcasts each event to the browser via WebSocket
6. Accumulates events in a server-side `streamLog` array

**Stream event types forwarded to browser:**

| Claude Event Type | Extracted As | Contains |
|-------------------|-------------|----------|
| `system` | `system` entry | Session init info (model) |
| `assistant` → `text` block | `text` entry | Response text |
| `assistant` → `thinking` block | `thinking` entry | Full reasoning text |
| `assistant` → `tool_use` block | `tool_use` entry | Tool name, input, tool_use_id |
| `user` → `tool_result` block | `tool_result` entry | Result content, error flag, tool_use_id |
| `result` | Triggers approval gate or stdin close | Exit signal |

### 3.4 Edit Approval Gate

Claude runs with `--permission-mode default`, which auto-denies Edit/Write tool calls in `-p` mode. When the `result` event arrives with denied tool calls:

1. Server iterates each denied Edit/Write call
2. Broadcasts `improvement_permission_request` (toolName, toolInput, requestId) to browser
3. Browser shows an **ApprovalCard** with:
   - File path and tool name
   - Diff preview (old_string → new_string for Edit, content preview for Write)
   - "View File" toggle to see the full current file
   - Approve / Deny buttons
4. User's response sent back via WebSocket → server resolves the approval
5. If approved: server applies the edit locally via `applyEditLocally()` (direct file write)
6. Server builds a continuation message listing approved/denied edits and writes it to Claude's stdin
7. Claude continues with another turn

### 3.5 Cycle Completion & Persistence

When the Claude process exits:

1. **File changes** captured via `git diff -U3` (unstaged) + `git diff --cached -U3` (staged) + untracked files
2. **Stream entries** persisted as JSON in `stream_entries` column
3. **Response text** (concatenated text blocks) stored in `claude_response`
4. Cycle status set to `completed` or `failed`
5. `improvement_complete` event broadcast to browser

### 3.6 Rewind

Users can rewind any completed or failed cycle:

1. Server reads the cycle's `jsonl_snapshot_size`
2. Truncates the session JSONL file to that byte offset
3. Marks the cycle (and any later cycles) as `rewound`
4. Opens the prompt editor pre-filled with the cycle's prompt
5. User edits and re-applies — creates a new cycle

### 3.7 Artifact Viewing

Three levels of artifact visibility:

| Context | Data Source | What's Shown |
|---------|------------|--------------|
| **Live stream** (cycle applying) | In-memory `streamEntries` from WebSocket | Collapsible tool calls with "View File" button |
| **Completed cycle with stream log** | Persisted `stream_entries` from DB | "Files Touched" summary + collapsible activity log with tool calls |
| **Completed cycle without stream log** (legacy) | `claude_response` text parsing | "Files Referenced" — regex-extracted file paths with expandable file viewer |
| **File changes** (git diff) | `file_changes` from DB | `FileDiffViewer` — expandable diff per file with "View File" toggle |

**File API** (`/api/v2/sessions/:id/file?path=...`):
- Resolves project directory from session's JSONL path slug
- Security: resolved absolute path must start with project directory
- Max file size: 500KB
- Returns: `{ content, path, size, ext }`

---

## 4. UI Components

### 4.1 Feedback Panel Layout

```
┌─────────────────────────────────────┐
│ 📋 Feedback Review              2  ×│
├─────────────────────────────────────┤
│  [ Feedback ]  [ History (15) ]     │
├─────────────────────────────────────┤
│                                     │
│  (Tab content area)                 │
│                                     │
├─────────────────────────────────────┤
│  ⚡ Apply Improvements (2)          │
└─────────────────────────────────────┘
```

### 4.2 History Tab — Cycle Card (Expanded)

```
┌─────────────────────────────────────┐
│ #15  Completed  CURRENT    Jun 8 ▾  │
│ ↻ Rewind                        🗑  │
├─────────────────────────────────────┤
│ ▸ Generated Prompt       3,827 chars│
├─────────────────────────────────────┤
│ 📄 FILES TOUCHED (3)               │
│ ┌─────────────────────────────────┐ │
│ │ 📄 .claude/skills/agent.md Edit▸│ │
│ │ 📄 src/config.ts          Read ▸│ │
│ │ 📄 src/workflow.ts    Edit  ✓  ▸│ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ ▸ Activity Log          (42 events) │
│   ┌───────────────────────────────┐ │
│   │ 🧠 Thinking  Let me analyze…▸│ │
│   │ 🔧 Read  src/config.ts  done▸│ │
│   │ 🔧 Edit  agent.md (edit) ✓  ▸│ │
│   │ 💬 Response               ▾  │ │
│   │   (markdown rendered)         │ │
│   └───────────────────────────────┘ │
├─────────────────────────────────────┤
│ Completed Jun 8, 12:53 PM          │
└─────────────────────────────────────┘
```

### 4.3 Collapsible Stream Entry Types

| Entry Type | Icon | Color | Collapsible Content |
|------------|------|-------|---------------------|
| **Thinking** | 🧠 Brain | Purple `#d2a8ff` | Full reasoning text (actual `thinking` content from Claude) |
| **Tool Call** | 🔧 Tool-specific | Color-coded by tool | Input parameters + paired tool_result output. "View File" button for file-based tools. |
| **Text Response** | 💬 MessageSquare | White `#c9d1d9` | Markdown-rendered response text |
| **System** | Terminal | Gray `#484f58` | One-line session init info |
| **Permission Request** | ShieldCheck | Orange `#f0883e` | ApprovalCard with diff preview, file viewer, approve/deny buttons |

**Tool color coding:**

| Tool | Border/Icon Color |
|------|------------------|
| Bash | Green `#39d353` |
| Read | Blue `#79c0ff` |
| Edit, Write | Orange `#f0883e` |
| Grep, Glob | Purple `#d2a8ff` |
| Agent | Blue `#58a6ff` |
| Others | Gray `#30363d` |

---

## 5. Known Limitations

| Limitation | Reason | Workaround |
|------------|--------|------------|
| Old cycles have no stream entries | `stream_entries` column added in schema v7; older cycles only have `claude_response` text | Regex fallback extracts file paths from response text. "Files Referenced" section shown when file paths are found. |
| Old cycles have no file changes | `captureFileChanges` runs `git diff` at cycle completion; if changes were already committed or working tree was clean, nothing is captured | Fixed in current version to also capture staged changes (`git diff --cached`). |
| Duplicate WebSocket events in dev | Fast Refresh creates multiple `useWebSocket` hook instances | Dev-only issue. The 3-second reconnect timer handles recovery. Not a production concern. |
| `instanceof WsServer` fails across Turbopack boundaries | API routes get a different module instance than custom server | Duck-type check: `typeof g.broadcast === 'function'` instead of `instanceof`. |
| File viewer limited to 500KB | Large files would produce huge API payloads | Returns 413 error for files over 500KB. |

---

## 6. Event Types Reference

### 6.1 Server → Browser (WebSocket)

| Event Type | Payload | When |
|------------|---------|------|
| `improvement_started` | `{ sessionId, cycleId }` | Cycle begins |
| `improvement_stream_event` | `{ sessionId, cycleId, event }` | Every Claude stream-json line |
| `improvement_permission_request` | `{ sessionId, cycleId, requestId, toolName, toolInput }` | Edit/Write needs approval |
| `improvement_permission_resolved` | `{ sessionId, cycleId, requestId, approved }` | Approval decision made |
| `improvement_complete` | `{ sessionId, cycleId, status, response, fileChanges }` | Cycle finished |
| `improvement_failed` | `{ sessionId, cycleId, error }` | Cycle errored |

### 6.2 Browser → Server (WebSocket)

| Message Type | Payload | When |
|-------------|---------|------|
| `permission_response` | `{ sessionId, cycleId, requestId, approved }` | User approves/denies an edit |

### 6.3 REST API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v2/sessions/:id/improvements` | List all cycles for a session |
| POST | `/api/v2/sessions/:id/improvements` | Create cycle (body: `{ prompt }`) or preview prompt (body: `{ preview: true }`) |
| POST | `/api/v2/sessions/:id/improvements?rewind=<cycleId>` | Rewind a cycle |
| DELETE | `/api/v2/sessions/:id/improvements?cycle=<cycleId>` | Delete a cycle |
| DELETE | `/api/v2/sessions/:id/improvements?clearRewound=true` | Delete all rewound cycles |
| GET | `/api/v2/sessions/:id/file?path=<relativePath>` | Read a file from the project directory |

---

## 7. Type Definitions

### StreamEntry

```typescript
interface StreamEntry {
  id: string;
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'system' | 'permission_request';
  timestamp: number;
  text?: string;                         // text, thinking, system
  toolName?: string;                     // tool_use
  toolInput?: Record<string, unknown>;   // tool_use
  toolUseId?: string;                    // tool_use, tool_result
  content?: string;                      // tool_result
  isError?: boolean;                     // tool_result
  requestId?: string;                    // permission_request
  approved?: boolean | null;             // permission_request (null = pending)
}
```

### ImprovementCycle

```typescript
interface ImprovementCycle {
  id: string;
  sessionId: string;
  cycleNumber: number;
  feedbackIds: string[];
  generatedPrompt: string;
  claudeResponse: string | null;
  status: 'applying' | 'completed' | 'failed' | 'rewound';
  createdAt: string;
  completedAt: string | null;
  snapshotSize: number | null;
  fileChanges: FileChange[] | null;
  streamEntries: StreamEntry[] | null;
}
```

### FileChange

```typescript
interface FileChange {
  filePath: string;
  type: 'create' | 'modify' | 'delete';
  additions: number;
  deletions: number;
  diff: string;
}
```
