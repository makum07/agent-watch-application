# Functional Specification

## AgentWatch v2.0

---

## 1. System Overview

The system consists of three functional layers:

```
+---------------------------------------------------------------+
|                     Browser (Frontend)                        |
|  Workspace Engine | Visualizations | Search | Agent Views     |
+-------------------------------+-------------------------------+
                                |
                          HTTP + WebSocket
                                |
+-------------------------------+-------------------------------+
|                   Node.js Server (Backend)                    |
|  Session API | Agent Graph | Timeline | Search | WebSocket    |
+-------------------------------+-------------------------------+
                                |
+-------------------------------+-------------------------------+
|                    Data Layer                                 |
|  SQLite (FTS5) | JSONL Parser | File Watcher | Cache         |
+---------------------------------------------------------------+
```

---

## 2. Functional Area: Session Discovery and Import

### 2.1 Session Discovery

**Trigger:** Application startup or manual refresh

**Process:**

1. Scan `~/.claude/projects/` recursively for `.jsonl` files
2. For each file, extract conversation metadata (first/last message timestamps, message count, token usage)
3. Build parent-child relationships by:
   a. Scanning assistant messages for `tool_use` blocks where `name === "Agent"` or `name === "Task"`
   b. Extracting `subagent_type`, `prompt`, `description` from the tool input
   c. Finding the corresponding child conversation JSONL file (matched by tool_use_id correlation in tool_result blocks)
4. Index all conversations into SQLite with FTS5
5. Notify frontend via WebSocket: `session_index_complete`

**Parent-Child Correlation Algorithm:**

```
For each conversation C:
  For each assistant message M in C:
    For each content block B in M:
      If B.type === "tool_use" AND B.name in ["Agent", "Task", "Workflow"]:
        Record pending_agent = {
          parent_conversation_id: C.id,
          tool_use_id: B.id,
          agent_type: B.input.subagent_type,
          prompt: B.input.prompt,
          description: B.input.description,
          model: B.input.model,
          isolation: B.input.isolation
        }
    For each content block B in M:
      If B.type === "tool_result" AND B.tool_use_id matches a pending_agent:
        If B.content contains a conversation reference:
          Link child_conversation_id to parent via pending_agent
```

**Workflow Script Parsing:**

For `Workflow` tool calls, the system extracts:
- `meta.name`, `meta.description`, `meta.phases` from the script
- `agent()` calls within the script body (prompt text, labels, phases)
- `parallel()` and `pipeline()` structure to determine concurrency

### 2.2 Session Import by ID

**Input:** Conversation UUID or session path

**Process:**

1. Look up conversation in the SQLite index
2. If not found, search `~/.claude/projects/` for matching filename
3. Load the full JSONL file
4. Parse all messages and build the agent graph
5. Return structured session data

### 2.3 Session Data Model (API Response)

```json
{
  "session": {
    "id": "conv-uuid",
    "project": "/path/to/project",
    "created": "2026-05-30T10:00:00Z",
    "lastModified": "2026-05-30T12:30:00Z",
    "status": "completed",
    "totalMessages": 847,
    "totalTokens": 1250000,
    "totalAgents": 23,
    "totalToolCalls": 312,
    "primaryModel": "claude-opus-4-6",
    "duration": {
      "wallClock": 9000000,
      "agentTime": 7200000
    }
  },
  "agents": [
    {
      "id": "agent-uuid",
      "parentId": null,
      "type": "orchestrator",
      "subagentType": null,
      "model": "claude-opus-4-6",
      "status": "completed",
      "startTime": "2026-05-30T10:00:00Z",
      "endTime": "2026-05-30T12:30:00Z",
      "messageCount": 124,
      "tokenUsage": { "input": 50000, "output": 30000, "total": 80000 },
      "toolCalls": [
        { "name": "Agent", "count": 8 },
        { "name": "Bash", "count": 15 },
        { "name": "Read", "count": 22 }
      ],
      "children": ["child-agent-1", "child-agent-2"],
      "prompt": null,
      "description": null
    },
    {
      "id": "child-agent-1",
      "parentId": "agent-uuid",
      "type": "subagent",
      "subagentType": "Explore",
      "model": "claude-sonnet-4-6",
      "status": "completed",
      "startTime": "2026-05-30T10:05:00Z",
      "endTime": "2026-05-30T10:08:00Z",
      "messageCount": 12,
      "tokenUsage": { "input": 8000, "output": 5000, "total": 13000 },
      "toolCalls": [
        { "name": "Grep", "count": 5 },
        { "name": "Read", "count": 3 }
      ],
      "children": [],
      "prompt": "Find all files that implement the payment flow...",
      "description": "Payment flow code search"
    }
  ],
  "artifacts": [
    {
      "id": "artifact-1",
      "type": "file_write",
      "path": "src/payment.ts",
      "producerAgentId": "child-agent-3",
      "consumerAgentIds": ["child-agent-5"],
      "timestamp": "2026-05-30T10:30:00Z",
      "size": 2048
    }
  ],
  "timeline": [
    {
      "timestamp": "2026-05-30T10:00:00Z",
      "type": "agent_start",
      "agentId": "agent-uuid",
      "details": {}
    }
  ]
}
```

---

## 3. Functional Area: Multi-Pane Workspace

### 3.1 Layout Data Model

The workspace layout is a recursive binary tree:

```json
{
  "type": "split",
  "direction": "horizontal",
  "ratio": 0.5,
  "children": [
    {
      "type": "pane",
      "id": "pane-1",
      "tabs": [
        { "type": "agent", "agentId": "agent-uuid", "label": "Orchestrator" }
      ],
      "activeTab": 0
    },
    {
      "type": "split",
      "direction": "vertical",
      "ratio": 0.33,
      "children": [
        {
          "type": "pane",
          "id": "pane-2",
          "tabs": [
            { "type": "agent", "agentId": "child-1", "label": "Explore Agent" }
          ],
          "activeTab": 0
        },
        {
          "type": "pane",
          "id": "pane-3",
          "tabs": [
            { "type": "timeline", "label": "Timeline" },
            { "type": "agent", "agentId": "child-2", "label": "Plan Agent" }
          ],
          "activeTab": 0
        }
      ]
    }
  ]
}
```

### 3.2 Split Operations

**Horizontal Split:**

```
Before:                After:
+-------------+       +------+------+
|             |       |      |      |
|   Pane A    |  -->  | A    | New  |
|             |       |      |      |
+-------------+       +------+------+
```

1. Replace current pane node with a split node
2. Current pane becomes left child
3. New empty pane becomes right child
4. Default ratio: 0.5
5. Emit `layout_changed` event

**Vertical Split:**

```
Before:                After:
+-------------+       +-------------+
|             |       |      A      |
|   Pane A    |  -->  +-------------+
|             |       |     New     |
+-------------+       +-------------+
```

Same algorithm, direction = "vertical".

### 3.3 Resize Operations

- Drag the divider between sibling panes
- Update the `ratio` field of the parent split node
- Enforce minimum: ratio >= 0.1 and ratio <= 0.9
- Emit `layout_changed` event
- Use CSS `flex-basis` with `resize: none` for performance

### 3.4 Pane Close

1. Remove the pane node from the tree
2. Replace the parent split node with the remaining sibling
3. Emit `layout_changed` event

### 3.5 Layout Presets

| Preset | Description | Structure |
|--------|-------------|-----------|
| Single | Full-screen single pane | 1 pane |
| Side-by-Side | Two equal columns | H-split, 0.5 |
| Three Column | Three equal columns | H-split(H-split(A, B), C) |
| Quad | Four equal panes | H-split(V-split, V-split) |
| Orchestrator + Agents | Left 40% orchestrator, right 60% stacked agents | H-split(A, V-split(B, C, D)) |

### 3.6 Layout Persistence

- Layouts stored in browser `localStorage`
- Key: `cse_layouts`
- Value: `{ [name: string]: LayoutTree }`
- Maximum 20 saved layouts
- Auto-save current layout on change (debounced 2s)

---

## 4. Functional Area: Agent View

### 4.1 Agent Sidebar

**Location:** Left side of workspace, collapsible

**Content:**

```
Session: conv-abc123
Project: /home/user/myproject
Duration: 2h 30m
Agents: 23

[Search agents...]

v Orchestrator (main)                    [completed]
  |-- Explore: Code search              [completed]
  |-- Plan: Architecture review         [completed]
  |   |-- Explore: DB schema lookup     [completed]
  |   |-- Explore: API routes           [completed]
  |-- general-purpose: Implementation   [completed]
  |   |-- Explore: Test patterns        [completed]
  |-- code-reviewer: Final review       [completed]
  v Workflow: review-changes            [completed]
      |-- Phase: Find (3 agents)        [completed]
      |-- Phase: Verify (8 agents)      [completed]
```

**Interactions:**

- Click agent: Opens in focused pane (or first empty pane)
- Drag agent: Shows drop zones on all panes
- Right-click agent: Context menu (Open in new pane, Open in new tab, Copy ID, Jump to invocation)
- Expand/collapse: Toggle children visibility
- Badge colors: Green (completed), Blue (running), Red (errored), Gray (pending)

### 4.2 Agent Message View (Pane Content)

**Header Bar:**

```
+------------------------------------------------------------------+
| [Explore] Code search    | Model: sonnet-4-6 | Tokens: 13K | [x]|
| Parent: Orchestrator     | Duration: 3m 12s  | Tools: 8        |
+------------------------------------------------------------------+
```

**Message Thread:**

Each message rendered as a card:

```
+------------------------------------------------------------------+
| PROMPT (from parent)                                    10:05:00  |
| Find all files that implement the payment flow. Search  |         |
| for PaymentService, PaymentController, and related      |         |
| types. Report file paths and key function signatures.   |         |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
| ASSISTANT                                               10:05:02  |
| I'll search for payment-related files in the codebase.  |         |
|                                                          |         |
| > Tool: Grep                                       [expand v]    |
| > pattern: "PaymentService|PaymentController"           |         |
| > Result: 5 files found                                 |         |
|                                                          |         |
| > Tool: Read                                       [expand v]    |
| > file: src/payment/PaymentService.ts                   |         |
| > Result: (245 lines)                                   |         |
|                                                          |         |
| Found 5 files implementing the payment flow:            |         |
| 1. src/payment/PaymentService.ts - Core service         |         |
| 2. src/api/PaymentController.ts - REST endpoints        |         |
| ...                                                      |         |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
| RESPONSE (to parent)                                    10:08:12  |
| [Final text returned to the orchestrator]               |         |
+------------------------------------------------------------------+
```

**Tool Call Rendering:**

- Collapsed by default (shows tool name + one-line summary)
- Expanded: shows full input parameters and output
- Code outputs get syntax highlighting
- File read results show line numbers
- Bash results show command and stdout/stderr

### 4.3 Drag and Drop

**Drag Source:** Agent sidebar items
**Drop Targets:** Pane areas and split zone indicators

**Drop Zones:**

When dragging over a pane, show four drop zones:

```
+------------------+
|      [top]       |
|  [left]  [right] |
|     [bottom]     |
+------------------+
|    [center]      |
+------------------+
```

- **Top/Bottom/Left/Right:** Split the pane and place agent in new half
- **Center:** Add as tab in existing pane

**Visual Feedback:**
- Blue highlight on valid drop zone
- Opacity 0.5 on dragged item
- Preview outline showing resulting layout

---

## 5. Functional Area: Session Visualization

### 5.1 Agent Hierarchy Tree

**Rendering:** D3.js tree layout or CSS-based collapsible tree

**Node Content:**
```
+----------------------------+
| [icon] Agent Name          |
| Type: Explore              |
| Duration: 3m 12s           |
| Tokens: 13K                |
| Status: completed          |
+----------------------------+
```

**Edges:** Solid lines from parent to child, labeled with invocation order

**Interactions:**
- Click node: Open agent in workspace pane
- Hover: Show tooltip with prompt excerpt
- Collapse/expand subtrees
- Zoom and pan

### 5.2 Execution Timeline

**X-axis:** Time (absolute or relative to session start)
**Y-axis:** Agent rows (one per agent, nested by hierarchy)

```
Time:    0s     30s    60s    90s    120s   150s   180s
         |      |      |      |      |      |      |
Main     [======================================== ]
  Explore  [====]
  Plan       [========]
    Explore    [===]
    Explore      [==]
  Impl              [===============]
    Explore           [====]
  Review                             [======]
```

**Bar Decorations:**
- Tool call markers: Small diamonds on the bar
- Artifact creation markers: Small squares on the bar
- Color: By agent type

**Interactions:**
- Hover bar: Tooltip with agent info
- Click bar: Open agent in pane
- Drag to select time range: Zoom into range
- Mouse wheel: Zoom in/out
- Shift+drag: Pan

### 5.3 Context Flow Diagram

**Type:** Directed graph (DAG)

**Nodes:** Agents
**Edges:** Context flow (prompt sent, result returned)
**Edge Labels:** Token count of context transferred

```
                    Orchestrator
                   /     |      \
                  /      |       \
            Explore    Plan    Impl
            (8K)      (12K)   (25K)
                      /    \
                 Explore  Explore
                 (5K)     (4K)
```

**Edge Thickness:** Proportional to token count
**Node Size:** Proportional to total token usage

---

## 6. Functional Area: Search and Filtering

### 6.1 Global Session Search

**UI:** Search bar at top of workspace

**Input:** Free text query
**Scope:** All messages across all agents in the current session
**Results:** Grouped by agent, showing:
- Agent name and type
- Message excerpt with highlighted match
- Timestamp
- Match count per agent

**Actions:**
- Click result: Navigate to message in agent's pane
- Filter results by agent type
- Filter results by message role

### 6.2 Per-Pane Search

**UI:** Ctrl+F within a focused pane

**Behavior:** Standard find-in-page within the current agent's message thread
- Highlight all matches
- Previous/Next navigation
- Match count display

### 6.3 Invocation Navigation

**"Jump to Invocation" feature:**

From a child agent, navigate to the exact location in the parent agent's message thread where the `tool_use` block that spawned this child appears.

1. User right-clicks child agent or clicks "Jump to parent" button
2. System looks up `parentId` and `tool_use_id`
3. Opens parent agent in the adjacent pane (or focused pane)
4. Scrolls to and highlights the `tool_use` block

---

## 7. Functional Area: Artifact Exploration

### 7.1 Artifact Detection

Artifacts are detected from tool calls:

| Tool | Artifact Type |
|------|---------------|
| Write | File creation |
| Edit | File modification |
| NotebookEdit | Notebook modification |
| Bash (with redirect) | File creation (if `>` or `>>` detected) |

### 7.2 Artifact List View

```
+------------------------------------------------------------------+
| Artifacts (23 files, 15 created, 8 modified)                     |
+------------------------------------------------------------------+
| File                        | Created By    | Modified By | Size |
|-----------------------------+---------------+-------------+------|
| src/payment/service.ts      | Impl Agent    | Review      | 4.2K |
| src/payment/controller.ts   | Impl Agent    | -           | 2.1K |
| test/payment.test.ts        | Impl Agent    | -           | 3.8K |
| docs/api.md                 | Docs Agent    | -           | 1.5K |
+------------------------------------------------------------------+
```

### 7.3 Artifact Detail View

- Full content with syntax highlighting
- Timeline of modifications (if modified by multiple agents)
- Diff view between versions
- Link to the agent message that created/modified the artifact

---

## 8. Functional Area: Context Tracking

### 8.1 Context Inspector Panel

Available in each agent pane via a "Context" tab:

```
+------------------------------------------------------------------+
| Context Inspector: Explore Agent (child-1)                       |
+------------------------------------------------------------------+
| RECEIVED FROM PARENT:                                            |
| Prompt: "Find all files that implement the payment flow..."      |
| Token count: 342 tokens                                         |
| Schema: { type: "object", properties: { files: [...] } }        |
| Model override: sonnet-4-6                                      |
+------------------------------------------------------------------+
| RETURNED TO PARENT:                                              |
| Response: "Found 5 files implementing the payment flow:..."     |
| Token count: 1,205 tokens                                      |
| Structured output: { files: [...] }                             |
+------------------------------------------------------------------+
| TOOLS USED:                                                      |
| Grep x5, Read x3                                                |
+------------------------------------------------------------------+
```

### 8.2 Context Flow Overlay

When enabled, draws arrows on the timeline visualization showing:
- Prompt delivery (parent -> child)
- Response delivery (child -> parent)
- Shared artifact references

---

## 9. Functional Area: Analytics and Debugging

### 9.1 Session Summary Dashboard

```
+------------------------------------------------------------------+
| Session Analytics                                                |
+------------------------------------------------------------------+
| Total Duration     | 2h 30m          | Wall clock time            |
| Active Agent Time  | 1h 45m          | Sum of agent durations     |
| Parallelism Factor | 2.3x            | Agent time / wall time     |
| Total Tokens       | 1,250,000       | Input + output             |
| Estimated Cost     | $12.50          | Based on model pricing     |
| Total Agents       | 23              | Including subagents        |
| Total Tool Calls   | 312             | Across all agents          |
| Unique Tools       | 8               | Different tool types       |
+------------------------------------------------------------------+
```

### 9.2 Token Breakdown

| View | Content |
|------|---------|
| By Agent | Bar chart: token usage per agent (sorted descending) |
| By Model | Pie chart: token usage by model (opus, sonnet, haiku) |
| By Role | Stacked bar: input vs. output vs. cache per agent |
| Over Time | Line chart: cumulative token usage over session duration |

### 9.3 Debugging Alerts

The system automatically detects and surfaces:

| Alert | Detection Logic | Severity |
|-------|----------------|----------|
| Long-running agent | Duration > 2x median agent duration | Warning |
| High token agent | Tokens > 3x median | Warning |
| Excessive tool calls | Same tool > 20 calls in one agent | Info |
| Potential loop | Agent prompt similarity > 90% across 3+ iterations | Warning |
| Context bloat | Agent received > 100K tokens of context | Info |
| Duplicate work | Two agents with > 80% similar tool call patterns | Info |
| Failed agent | Agent ended with error status | Error |

---

## 10. Functional Area: Real-Time Updates

### 10.1 WebSocket Events (New)

| Event | Payload | Description |
|-------|---------|-------------|
| `session_update` | `{ sessionId, agents, timeline }` | Session data changed |
| `agent_started` | `{ agentId, parentId, type, prompt }` | New agent spawned |
| `agent_completed` | `{ agentId, status, duration, tokens }` | Agent finished |
| `agent_message` | `{ agentId, message }` | New message in agent |
| `tool_call` | `{ agentId, toolName, input }` | Tool invocation |
| `tool_result` | `{ agentId, toolName, result }` | Tool result received |
| `artifact_created` | `{ agentId, path, type }` | File written |
| `session_index_complete` | `{ count }` | Indexing finished |

---

## 11. Functional Area: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+\` | Toggle agent sidebar |
| `Ctrl+Shift+H` | Split pane horizontally |
| `Ctrl+Shift+V` | Split pane vertically |
| `Ctrl+W` | Close focused pane |
| `Ctrl+F` | Search in focused pane |
| `Ctrl+Shift+F` | Global search |
| `Ctrl+Tab` | Next tab in pane |
| `Ctrl+Shift+Tab` | Previous tab in pane |
| `Ctrl+1..9` | Focus pane by index |
| `Ctrl+Shift+M` | Maximize/restore pane |
| `Escape` | Close search, close modal |
| `T` | Toggle timeline view |
| `G` | Toggle agent graph view |
