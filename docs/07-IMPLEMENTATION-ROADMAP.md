# Implementation Roadmap

## AgentWatch v2.0

**Amendment:** Phase effort and feature lists updated per `08-REFINEMENT-AGENT-PANES-SESSION-HISTORY-WORKSPACE-PERSISTENCE.md`
**Amendment:** Phase 1.5 (Improvement Loop) added per `10-IMPROVEMENT-LOOP.md`
**Status:** Phase 1 MVP complete as of 2026-06-01. Phase 1.5 Improvement Loop complete as of 2026-06-08. Phase 2 COMPLETE (2026-06-08). Phase 3 COMPLETE (2026-06-08). Phase 4 COMPLETE (2026-06-09).

---

## Overview

The implementation is divided into four phases, each building on the previous. Each phase produces a usable, shippable increment. Phase 1 is expanded to include foundational session history, workspace persistence, and the agent pane tab rail, as these are critical to daily usability.

```
Phase 1: MVP                     Phase 2: Advanced Viz           Phase 3: Multi-Agent        Phase 4: Analytics
(8-12 weeks)                     (6-8 weeks)                     Analysis (5-7 weeks)        & Debugging (4.5-6.5 wks)
                                                                                              
+---------------------------+    +-------------------------+     +------------------------+  +------------------------+
| Session ingestion         |    | Execution timeline      |     | Context flow view      |  | Debug alerts           |
| Agent graph construction  |    | Agent hierarchy graph   |     | Context tab (in pane)  |  | Bottleneck detection   |
| Multi-pane workspace      |    | Artifact explorer       |     | Artifact lineage       |  | Duplicate work detect  |
| Agent pane tab rail       |    | Timeline zoom/pan       |     | Cross-agent search     |  | Cost breakdown         |
| Inline artifact cards     |    | Agent graph interaction |     | Invocation navigation  |  | Session comparison     |
| Basic agent sidebar       |    | Tool call markers       |     | Workflow visualization |  | Export/reporting       |
| Drag-and-drop to panes    |    | Concurrent execution    |     | Scroll sync            |  | Performance profiling  |
| Layout presets            |    | Per-agent artifacts tab |     | Agent diff view        |  | Pattern detection      |
| Home dashboard (basic)    |    | Per-agent tools tab     |     | Session tagging        |  | Advanced session search|
| Session history tracking  |    | Pinning and favorites   |     | Artifact lineage strip |  | History pruning        |
| Auto-save workspace      |    | Named layout saves      |     +------------------------+  +------------------------+
| Resume dialog             |    +-------------------------+
| Session search (basic)    |
+---------------------------+
```

---

## Phase 1: MVP ✅ COMPLETE (2026-06-01)

### Goal

A user can open the application, see a home dashboard of recent and pinned sessions, open any session, see the full agent hierarchy, drag agents into a multi-pane workspace, inspect each agent's conversation/artifacts/context/tools via a tab rail, and have their workspace automatically saved for next time.

### Features

| Feature | Description | Effort |
|---------|-------------|--------|
| **Session Ingester** | Parse JSONL files, detect Agent/Task/Workflow tool calls, correlate parent-child conversations, build agent tree | 2 weeks |
| **Agent Graph Engine** | Construct agent hierarchy from parsed data, calculate start/end times, aggregate token usage | 1 week |
| **v2 API Layer** | REST endpoints for sessions, agents, agent messages, history, workspaces, preferences | 1.5 weeks |
| **Workspace Engine** | Recursive binary tree layout, horizontal/vertical splits, resize dividers, close panes | 2 weeks |
| **Agent Pane Tab Rail** | Five-tab layout per agent pane: Conversation, Artifacts, Context, Tools, Summary | 1 week |
| **Conversation Tab + Inline Artifacts** | Message thread with inline artifact cards for Write/Edit, preview toggle, open-in-pane | 1.5 weeks |
| **Agent Sidebar** | Collapsible agent hierarchy tree with drag handles and status badges | 1 week |
| **Drag and Drop** | Drag agents from sidebar to panes (center = tab, edges = split) | 0.5 weeks |
| **Layout Presets** | Single, side-by-side, three-column, quad, orchestrator+agents | 0.5 weeks |
| **Home Dashboard** | Recent sessions, pinned sessions, open-by-ID, basic search | 1 week |
| **Session History** | Track opens, auto-title, persist metadata, pin/unpin | 0.5 weeks |
| **Workspace Auto-Save** | Save layout + pane states on change (debounced 2s), restore on reopen | 1 week |
| **Resume Dialog** | Present resume options when reopening: Resume Last, Timeline, Agent Explorer, Fresh | 0.5 weeks |
| **Basic Search** | Full-text search within current session (FTS5-backed) | 0.5 weeks |

### Architecture Changes

| Component | Change |
|-----------|--------|
| Backend | New `src/services/SessionIngester.js`, `AgentGraphEngine.js` |
| Backend | New `src/services/SessionHistoryService.js`, `WorkspaceSnapshotService.js`, `PreferencesService.js` |
| Backend | New `src/routes/sessions.js`, `agents.js`, `history.js`, `workspaces.js`, `preferences.js` |
| Backend | New entry point `src/server.js` (refactored from `chats-mobile.js`) |
| Frontend | New `src/analytics-web/components/workspace/` directory |
| Frontend | New `src/analytics-web/components/agent/` directory (with tab rail, 5 sub-tab components) |
| Frontend | New `src/analytics-web/components/home/` directory (dashboard, cards, search, resume) |
| Frontend | New `src/analytics-web/services/SessionService.js`, `AgentService.js`, `SessionHistoryService.js`, `WorkspaceSnapshotService.js` |
| Frontend | New `Router` class for SPA-style page navigation |
| Database | New `agents`, `session_history`, `session_history_fts`, `workspace_snapshots`, `user_preferences` tables |
| Database | Schema v3 migration (additive, non-breaking) |
| Docker | Memory limit increased from 1GB to 2GB |
| Docker | tmpfs increased from 64MB to 128MB |

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **JSONL correlation** | Parent-child agent matching relies on heuristic (prompt matching, timing). False positives/negatives possible. | Multiple matching strategies with confidence scoring. Manual override for missed matches. |
| **Large session performance** | Sessions with 500+ agents could produce 100K+ DOM nodes. | Virtual scrolling for message threads. Lazy-load agent messages on pane open. |
| **Workspace engine complexity** | Recursive layout with drag-and-drop is non-trivial in vanilla JS. | Thorough testing of edge cases: deep nesting, rapid resize, minimum size enforcement. |
| **Browser memory** | Multiple agents open simultaneously could exceed browser memory. | Message pagination (50/page). Dispose messages when pane closes. Monitor with `performance.memory`. |
| **Workspace snapshot size** | Complex layouts with many expanded items could produce large JSON blobs. | Store only IDs and offsets, not content. Cap snapshot at 100KB with warning. |
| **Tab rail state management** | Five tabs per pane, each with independent scroll/expand state, across 4+ panes. | Centralized pane state store. Tab content lazy-rendered (only active tab in DOM). |

### Deliverables

- [x] Session ingester with parent-child correlation (via `agent-correlator.ts`, full directory structure scan)
- [x] v2 REST API (sessions, agents, agent-messages, history, workspaces, preferences)
- [x] Multi-pane workspace with horizontal/vertical splits and resize (`react-resizable-panels` v4)
- [x] Agent pane with 5-tab rail (custom button tabs with per-agent colors)
- [x] Conversation tab with round-grouped turns (orchestration rounds + EXCHANGE separators)
- [x] Inline artifact cards for Write/Edit tool calls (collapsed → preview → full pane)
- [x] Full-pane document viewer for artifacts (markdown Preview/Source toggle)
- [x] Context tab showing prompt/response
- [x] Summary tab with metadata and token usage
- [x] Tools tab with grouped tool call log
- [x] Agent sidebar — round-grouped collapsible (rounds match conversation display)
- [x] Agent display system (`lib/agent-display.ts`) — name, color, initials per agent type
- [x] Home dashboard with recent sessions and search
- [x] Session history tracking (open/reopen tracking)
- [x] Workspace auto-save and restore
- [x] Database migrations v1 and v2 (including `jsonl_path` column)
- [ ] Drag-and-drop agent placement *(split via sidebar click, not drag-and-drop)*
- [ ] Named layout saves *(Phase 2)*
- [ ] Resume dialog on session reopen *(basic resume — no dialog)*
- [ ] Docker configuration *(native `npm run dev` is primary)*

> **Implementation notes:**
> - Agent sidebar uses round-based grouping (15-min gap) rather than a recursive parent-child tree
> - "Drag to pane" is implemented as click-to-split from the sidebar
> - Workflow subagents discovered via `{sessionDir}/subagents/workflows/{wf-id}/agent-*.jsonl`
> - Named agents discovered via `{sessionDir}/subagents/agent-*.jsonl`
> - DB path: `data/agentwatch.db` (relative to project root; gitignored)
> - `better-sqlite3` requires `npm run rebuild-native` after Node.js version changes

### Definition of Done

A user can:
1. Open the application and see a home dashboard with recent sessions
2. Pin a session for quick access
3. Click a session to see the resume dialog
4. Enter the workspace and see the agent hierarchy in the sidebar
5. Drag 3 agents into a 3-pane layout
6. Read each agent's messages with inline artifact preview cards
7. Switch to the Context tab to see what prompt the agent received
8. Switch to the Summary tab to see token usage and duration
9. Close the browser, reopen, and resume exactly where they left off
10. Search across the session for a keyword

---

## Phase 1.5: Improvement Loop ✅ COMPLETE (2026-06-08)

> Full specification: `10-IMPROVEMENT-LOOP.md`

### Goal

A user can review a session, collect categorized feedback on agent behavior, and apply improvements by resuming the session via Claude Code's structured streaming protocol — with real-time visibility into Claude's thinking, tool calls, and an approval gate for file edits. All activity is persisted and viewable in a collapsible stream log matching the session/agent observation style.

### Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Feedback Collection** | Per-agent categorized notes (10 categories), inline edit/delete, grouped by agent | ✅ |
| **Prompt Generation** | Aggregates feedback into structured improvement prompt, editable before sending | ✅ |
| **Structured Streaming** | `--output-format stream-json` piped through WebSocket to browser in real time | ✅ |
| **Edit Approval Gate** | `--permission-mode default` auto-denies Edit/Write; browser shows diff + approve/deny | ✅ |
| **Rewind** | Truncate session JSONL to pre-cycle snapshot, re-apply with refined prompt | ✅ |
| **Collapsible Activity Log** | Thinking, tool calls (with input/output), text responses — all expandable, color-coded by tool type | ✅ |
| **Persistent Stream Entries** | Full stream log (thinking text, tool calls, results) stored in DB with cycle | ✅ |
| **Files Touched Summary** | Extracted from stream entries, shows files with tool name + approved/denied badge | ✅ |
| **File Content Viewer** | View any project file from within the cycle card (API: path-traversal protected, 500KB cap) | ✅ |
| **File Changes (git diff)** | Captures unstaged + staged + untracked changes at cycle completion | ✅ |
| **Files Referenced (fallback)** | For legacy cycles without stream data: regex-extracts file paths from response text | ✅ |

### Architecture Changes

| Component | Change |
|-----------|--------|
| Database | Schema v7: `stream_entries TEXT` column on `improvement_cycles` |
| Database | Schema v6: `file_changes TEXT` column on `improvement_cycles` |
| API | `app/api/v2/sessions/[id]/improvements/route.ts` — POST spawns Claude CLI with stream-json, manages approval gate, persists stream log |
| API | `app/api/v2/sessions/[id]/file/route.ts` — GET returns file content (path-traversal protected) |
| WebSocket | `lib/websocket/ws-server.ts` — duck-type check for Turbopack compatibility |
| Server | `server.ts` — initializes WsServer, stores on `globalThis.__wss` |
| Store | `store/feedback-store.ts` — Zustand store for feedback, cycles, live stream entries, approvals |
| UI | `components/session/feedback-panel.tsx` — collapsible stream log, approval cards, file viewers |
| Hook | `hooks/use-websocket.ts` — auto-reconnecting WebSocket client |
| Types | `types/feedback.ts` — StreamEntry, ImprovementCycle (with streamEntries field) |
| Types | `types/events.ts` — SessionEvent, StreamEvent, ContentBlock, ClientMessage |

### Deliverables

- [x] Feedback collection with 10 categories, inline edit, per-agent grouping
- [x] Prompt preview and editor
- [x] Real-time structured streaming via WebSocket (Claude stream-json → browser)
- [x] Edit approval gate with diff preview and file viewer
- [x] Multi-turn continuation (approved edits → continuation message → next turn)
- [x] Rewind with JSONL truncation and prompt re-editing
- [x] Collapsible activity log (ThinkingEntry, ToolCallEntry, TextEntry components)
- [x] Tool call pairing with tool_result (input/output in one card)
- [x] Files Touched summary with approved/denied badges
- [x] File content viewer API with security checks
- [x] Git diff capture (unstaged + staged + untracked)
- [x] Persistent stream entries in DB (schema v7)
- [x] Fallback file reference extraction for legacy cycles

---

## Phase 2: Advanced Visualization ✅ COMPLETE (2026-06-08)

### Goal

Rich visual representations of session execution: interactive timeline, agent hierarchy graph, session-wide artifact explorer, per-agent artifact and tool tabs, and enhanced workspace and session management features.

### Features

| Feature | Description | Effort | Status |
|---------|-------------|--------|--------|
| **Execution Timeline** | Zoom/pan horizontal timeline with agent bars, viewport culling, hover tooltips | 2 weeks | ✅ |
| **Agent Hierarchy Graph** | SVG tree/DAG with bezier edges, zoom/pan, dot-grid canvas, click-to-open | 1.5 weeks | ✅ |
| **Session Artifact Explorer** | Session-wide file tree grouped by directory, inline viewer, filter, agent badges | 1.5 weeks | ✅ |
| **Per-Agent Artifacts Tab** | DB-backed artifact list with filter (all/created/modified), inline file viewer, dedup by path | 0.5 weeks | ✅ |
| **Per-Agent Tools Tab** | Chronological flat list with search filter, load-more pagination | 0.5 weeks | ✅ |
| **Timeline Markers** | Artifact triangles on agent bars (green=create, orange=edit), toggleable, with hover tooltip | 0.5 weeks | ✅ |
| **Concurrent Execution Lanes** | "Lanes" mode toggle — swim lane layout via greedy interval algorithm, multiple agents per row | 0.5 weeks | ✅ |
| **Named Layout Saves** | Save/restore named layouts per session, inline name input, dropdown with delete | 0.5 weeks | ✅ |
| **Pinning and Favorites** | Interactive pin/star buttons on session cards, optimistic update via PUT history API | 0.5 weeks | ✅ |
| **Graph Interactions** | Click node to open agent, hover for tooltip, collapse subtrees | 0.5 weeks | ✅ |
| **Pane Maximize/Restore** | Maximize button in pane header fills workspace; restore button to return | 0.25 weeks | ✅ |
| **Pane Tab Management** | "+" tab button in multi-tab bar with searchable agent picker dropdown | 0.5 weeks | ✅ |

### Architecture Changes

| Component | Change |
|-----------|--------|
| API | New `GET /api/v2/sessions/[id]/agents/[agentId]/artifacts` — queries DB artifacts table directly | ✅ |
| API | New `GET /api/v2/sessions/[id]/artifacts` — session-wide artifacts for explorer + timeline markers | ✅ |
| API | New `DELETE /api/v2/workspaces/[sessionId]/[snapshotId]` — delete named layout snapshot | ✅ |
| Store | `workspace-store.ts` — added `maximizedPaneId`, `maximizePane`, `restorePane` | ✅ |
| UI | `components/agent/artifacts-tab.tsx` — rewritten to use DB endpoint; inline file viewer | ✅ |
| UI | `components/agent/tools-tab.tsx` — chronological flat list with search filter | ✅ |
| UI | `components/agent/agent-view.tsx` — artifact count badge; maximize/restore button | ✅ |
| UI | `components/workspace/workspace-shell.tsx` — maximized pane mode | ✅ |
| UI | `components/workspace/pane.tsx` — timeline/graph/artifacts pane types; "+" tab picker | ✅ |
| UI | `components/home/session-card.tsx` — interactive pin/favorite toggle buttons | ✅ |
| UI | `components/session/session-artifacts-pane.tsx` — new session file explorer pane | ✅ |
| UI | `components/session/execution-timeline.tsx` — Gantt timeline, swim lanes, artifact markers, click-to-open (with router fallback for standalone page) | ✅ |
| UI | `components/session/agent-hierarchy-graph.tsx` — SVG tree with bezier edges, zoom/pan, click-to-open | ✅ |
| UI | `components/session/agent-sidebar.tsx` — Timeline/Graph/Files buttons in footer | ✅ |
| UI | `app/session/[id]/workspace/page.tsx` — SavedLayouts component in workspace header | ✅ |
| UI | `app/session/[id]/timeline/page.tsx` — full-page wrapper for ExecutionTimeline; clicking bar navigates to workspace | ✅ |

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Canvas performance** | Timeline with 500 agents requires efficient rendering. | Viewport culling: only render visible bars. Offscreen canvas for pre-rendering. RequestAnimationFrame for smooth updates. |
| **SVG scaling** | Force-directed graph with 500 nodes may be slow. | Compute layout in Web Worker. Cap visible nodes at 100, show "expand" buttons for large subtrees. |
| **Artifact content size** | Large files (1MB+) in artifact viewer could freeze the browser. | Truncate display to first 10K lines. Lazy-render with virtual scrolling. |

### Deliverables

- [x] Interactive execution timeline — zoom/pan, row-per-agent, hover tooltips, click-to-open
- [x] Agent hierarchy graph — SVG tree with bezier edges, dot-grid canvas, zoom/pan
- [x] Session artifact explorer — file tree by directory, inline viewer, filter, agent badges
- [x] Timeline markers — artifact triangles on agent bars, toggleable Markers button, legend
- [x] Concurrent execution lanes — Lanes toggle in toolbar, greedy swim lane assignment
- [x] Pane tab management — "+" button in tab bar with searchable agent/view picker
- [x] Per-agent artifacts tab — DB-backed, filter by type, inline file viewer (click to expand)
- [x] Per-agent tools tab — chronological flat list, search filter, load-more
- [x] Named layout saves — save/restore/delete via workspace header
- [x] Pinning and favorites — interactive toggle on session cards
- [x] Pane maximize/restore — maximize button fills workspace area
- [x] Graph interactions — click node opens agent, hover tooltip, status indicators

> **Implementation notes:**
> - Artifacts tab reads from `artifacts` DB table via new API endpoint (not message scan), fixing badge/content count mismatch
> - Tools tab shows tool calls in execution order (message order), not grouped
> - Artifact count badge in tab rail counts `Write + Edit + NotebookEdit` (matches `artifact-extractor.ts`)
> - Pane maximize stores `maximizedPaneId` in workspace store; workspace shell renders only that pane when set
> - Named layout saves use existing `workspace_snapshots` table (`is_auto_save = 0`); delete route added
> - Timeline/graph click-to-open: in a workspace pane, `findOtherPane` opens the agent in a sibling pane (not the timeline pane itself); on the standalone `/timeline` page, sets layout then `router.push` to workspace
> - Timeline markers use artifact timestamps from the `artifacts` table (populated during ingestion); `timeline_events` table has `tool_call` event type defined but not yet populated — tool call markers deferred to a future cycle
> - Swim lanes use greedy interval scheduling: each agent assigned to the earliest lane whose last occupant has already ended, minimising lane count

### Definition of Done

A user can:
1. View a full execution timeline with all agents
2. Zoom into a specific time range and see tool call details
3. View the agent hierarchy as an interactive graph
4. Click any timeline bar or graph node to open the agent
5. Browse artifacts, see which agent created each file
6. View file contents with syntax highlighting
7. Save and restore custom workspace layouts

---

## Phase 3: Multi-Agent Analysis ✅ COMPLETE (2026-06-08)

### Goal

Deep analysis of multi-agent coordination: context flow tracking, cross-agent search with filtering, invocation navigation, and workflow visualization.

### Features

| Feature | Description | Effort |
|---------|-------------|--------|
| **Context Flow View** | DAG visualization showing prompt/response flow between agents with token counts | 1.5 weeks |
| **Context Inspector** | Per-agent panel showing received prompt, returned response, schema, model | 1 week |
| **Cross-Agent Search** | Search with filters: agent type, tool name, time range, message role | 1 week |
| **Invocation Navigation** | "Jump to parent" from child agent, highlighting the tool_use block | 0.5 weeks |
| **Workflow Visualization** | Parse Workflow scripts, show phases, pipeline/parallel structure | 1.5 weeks |
| **Scroll Sync** | Optional synchronized scrolling across panes (by timestamp) | 0.5 weeks |
| **Agent Comparison** | Side-by-side diff of two agents' messages and metrics | 1 week |
| **Search Highlighting** | Highlight search matches across all open panes simultaneously | 0.5 weeks |

### Architecture Changes

| Component | Change |
|-----------|--------|
| Backend | New `src/services/ContextAnalyzer.js` |
| Backend | Extended search API with multi-field filtering |
| Backend | Workflow script parsing (extract meta, phases, agent calls) |
| Frontend | New `src/analytics-web/components/search/GlobalSearch.js` |
| Frontend | New context flow visualization component |
| Frontend | Scroll sync manager across panes |
| Database | `workflows` table populated during ingestion |

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Workflow script parsing** | Workflow scripts are arbitrary JavaScript. Parsing `agent()`, `pipeline()`, `parallel()` calls from source requires AST analysis. | Use regex-based extraction for common patterns. Fall back to displaying raw script for complex cases. |
| **Context flow accuracy** | Child agent's received context may differ from parent's sent prompt due to system prompt injection. | Display what we can observe: the `input.prompt` field from the tool_use block and the first user message in the child's JSONL. Note discrepancies. |
| **Scroll sync performance** | Synchronizing scroll across 4+ panes by timestamp requires efficient timestamp-to-offset mapping. | Pre-compute timestamp index per agent. Use binary search for nearest timestamp. Debounce sync events. |

### Deliverables

- [x] Context flow DAG visualization (`components/session/context-flow.tsx` — token-annotated edges, edge-click drawer, new `context-flow` pane type)
- [x] Context inspector panel per agent — `context-tab.tsx` enhanced with parent link, invocation chain breadcrumb, toolUseId
- [x] Advanced search with filters (`app/api/v2/sessions/[id]/search/route.ts` + `components/session/cross-agent-search.tsx` — role/type filters, scroll-to-message)
- [x] Invocation navigation (jump to parent) — "Called from" badge in Context tab; `session-store.getAncestors()` chain
- [x] Workflow structure visualization — phase overlay toggle on `agent-hierarchy-graph.tsx`; `lib/services/workflow-parser.ts`; `app/api/v2/sessions/[id]/workflow/route.ts`
- [x] Optional scroll synchronization — `scrollSyncEnabled`/`broadcastScrollTimestamp` in workspace store; sync line in timeline; IntersectionObserver emit in conversation tab
- [x] Agent comparison view — `components/agent/comparison-view.tsx`; Compare button + picker in agent-view header; new `comparison` pane type
- [x] Cross-pane search highlighting — `highlightTerms` prop in `MarkdownRenderer` via rehype plugin; wired to `globalSearchQuery` in conversation tab

> **Implementation notes:**
> - Search API reads JSONL files on demand (no message FTS table); filters by agentTypes and message roles
> - Context flow reuses `buildSubtree`/`assignX` layout algorithm from hierarchy graph; adds edge token labels + side drawer
> - Workflow phase assignment uses regex extraction of `meta.phases` titles + agent description heuristic matching
> - Scroll sync uses `scrollSyncEnabled` flag in workspace store; conversation tab uses `IntersectionObserver` approach via top-visible-message detection; timeline shows a blue dashed sync line at the current timestamp
> - Agent comparison pane type includes `agentAId`/`agentBId`; accessible via Compare button (Columns2 icon) in agent-view header

### Definition of Done

A user can:
1. See what prompt each agent received and what it returned
2. Visualize context flow as a graph with token volumes
3. Search for a term and filter by agent type and tool
4. Click "Jump to parent" on a child agent to see where it was spawned
5. View workflow structure: phases, pipeline, parallel
6. Enable scroll sync and scrub through two agents in parallel
7. Compare two agents' outputs side-by-side

---

## Phase 4: Analytics and Debugging ✅ COMPLETE (2026-06-09)

### Goal

Automated analysis and debugging insights: bottleneck detection, duplicate work identification, cost optimization, session comparison, and export.

### Features

| Feature | Description | Effort | Status |
|---------|-------------|--------|--------|
| **Session Analytics Dashboard** | Summary metrics: duration, tokens, cost, parallelism factor, model breakdown, cache efficiency | 1 week | ✅ |
| **Debug Analyzer** | Automated detection of bottlenecks, loops, duplicate work, excessive tool usage, context bloat, long chains | 2 weeks | ✅ |
| **Debug Alerts UI** | Alert cards with severity, description, and navigation to relevant agent | 0.5 weeks | ✅ |
| **Cost Breakdown** | Detailed cost by agent, by model, by phase, with recharts pie/bar charts | 1 week | ✅ |
| **Session Comparison** | Compare two sessions side-by-side: metrics, alerts, cost deltas | 1 week | ✅ |
| **Export** | Export session data as JSON, Markdown, or HTML report | 0.5 weeks | ✅ |
| **Performance Profiling** | Critical path identification (longest chain from root to leaf) | 0.5 weeks | ✅ |
| **Pattern Detection** | Cross-session pattern detection: tool sequences, topologies, cost outliers, regressions | 1 week | ✅ |

### Architecture Changes

| Component | Change | Status |
|-----------|--------|--------|
| Backend | New `lib/services/debug-analyzer.ts` — 6 detection functions + critical path finder | ✅ |
| Backend | New `lib/services/pattern-detector.ts` — cross-session pattern detection (4 types) | ✅ |
| API | New `GET /api/v2/sessions/[id]/analytics` — computed SessionAnalytics endpoint | ✅ |
| API | New `GET /api/v2/sessions/[id]/export?format=json|markdown|html` — session export | ✅ |
| API | New `GET /api/v2/sessions/compare?a=X&b=Y` — session comparison | ✅ |
| API | New `GET /api/v2/sessions/patterns` — cross-session patterns | ✅ |
| Frontend | New `components/session/analytics-dashboard.tsx` — main analytics pane component | ✅ |
| Frontend | New `components/session/debug-alerts.tsx` — filterable alert cards with agent navigation | ✅ |
| Frontend | New `components/session/cost-breakdown.tsx` — recharts pie + bar charts (by model/agent/phase) | ✅ |
| Frontend | New `app/session/compare/page.tsx` — session comparison page with picker + deltas | ✅ |
| Frontend | Modified `components/workspace/pane.tsx` — analytics pane type + picker entry | ✅ |
| Frontend | Modified `components/session/agent-sidebar.tsx` — Analytics button in footer | ✅ |
| Types | New `types/analytics.ts` — DebugAlert, SessionAnalytics, SessionComparisonData, CrossSessionPattern | ✅ |

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Duplicate work detection** | Determining if two agents did "duplicate" work is imprecise. Similar tool calls don't always mean redundancy. | Use Jaccard similarity on tool call sets. Report as "potential" with overlap percentage. |
| **Loop detection** | Agent loops may be intentional (iterative refinement) or accidental. | Threshold at 10+ calls of same tool per agent. Flag as warning, not error. |
| **Cost estimation accuracy** | Model pricing changes over time. | Pricing table in `lib/utils.ts` and `lib/services/session-ingester.ts`. Display as "estimated". |
| **Cross-session perf** | Loading 15 sessions for pattern detection could be slow. | Cap at 15 sessions. Patterns computed on-demand via API (not persisted). |

### Deliverables

- [x] Session analytics dashboard with summary metrics (`components/session/analytics-dashboard.tsx` — 8 stat cards, sortable agent table, critical path visualization, export buttons)
- [x] Debug analyzer with 6 detection types (`lib/services/debug-analyzer.ts` — bottleneck, loop, duplicate-work, excessive-tools, context-bloat, long-chain)
- [x] Debug alerts UI with severity and navigation (`components/session/debug-alerts.tsx` — severity/category filters, expandable cards, click-to-navigate agent links)
- [x] Cost breakdown charts (`components/session/cost-breakdown.tsx` — recharts PieChart by model, BarChart by agent top-15, BarChart by phase/round)
- [x] Session comparison view (`app/session/compare/page.tsx` + `app/api/v2/sessions/compare/route.ts` — session picker, side-by-side metrics, delta cards)
- [x] Export to JSON/Markdown/HTML (`app/api/v2/sessions/[id]/export/route.ts` — Content-Disposition download, dark-themed HTML)
- [x] Critical path identification (`lib/services/debug-analyzer.ts:findCriticalPath` — longest duration chain root→leaf, visualized in dashboard)
- [x] Cross-session pattern detection (`lib/services/pattern-detector.ts` — common tool sequences, recurring topologies, cost outliers, performance regressions)

> **Implementation notes:**
> - Analytics dashboard works both as standalone page (`/session/{id}/analytics`) and as a workspace pane (analytics tab type)
> - Debug analyzer is pure-function: takes Session, returns DebugAlert[]. No DB writes, no side effects.
> - Cost breakdown uses recharts v3 (first usage in codebase): PieChart for model split, horizontal BarChart for top agents, vertical BarChart for round/phase costs
> - Session comparison is a standalone page at `/session/compare?a=X&b=Y` (not a pane — spans two sessions)
> - Pattern detection loads last 15 sessions via `discoverSessions()` + `ingestSession()`. Four detectors: tool bigram frequency, topology hash grouping, cost z-score outliers, same-project regression analysis
> - Export markdown/HTML includes summary table, agents table sorted by cost, critical path chain, and debug alerts with severity icons
> - Analytics button added to sidebar footer (BarChart3 icon, pink accent) and to pane tab picker dropdown

### Definition of Done

A user can:
1. View session analytics: duration, tokens, cost, parallelism
2. See automated debug alerts: "Agent X took 3x longer than average"
3. Click an alert to navigate to the relevant agent
4. View cost breakdown by agent and model
5. Compare two sessions side-by-side
6. Export a session report as HTML
7. See the critical path through the agent hierarchy

---

## Summary Timeline

```
Week:  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34
       |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
Phase 1 [======================================]
  Ingester  [=======]
  Agent Graph  [====]
  API          [======]
  Workspace       [==========]
  Tab Rail           [====]
  Inline Artifacts      [======]
  Sidebar                  [====]
  Home Dashboard              [====]
  History + Resume               [====]
  Workspace Persist.                [====]
  DnD + Presets                        [==]
  Search                                  [=]

Phase 2                                       [==============================]
  Timeline                                    [==========]
  Agent Graph                                    [=======]
  Session Artifacts                                 [=======]
  Agent Artifacts + Tools Tabs                         [====]
  Markers + Lanes                                         [===]
  Pinning + Favorites                                        [==]
  Named Layouts + Tabs                                          [===]

Phase 3                                                                        [==========================]
  Context Flow                                                                 [=======]
  Context Tab (in pane)                                                           [====]
  Search Filters                                                                     [====]
  Navigation                                                                            [==]
  Workflow Viz                                                                             [=======]
  Tagging + Lineage + Compare                                                                 [====]

Phase 4                                                                                                    [========================]
  Analytics Dashboard                                                                                      [====]
  Debug Analyzer                                                                                              [==========]
  Cost + Alerts                                                                                                  [=======]
  Comparison + Export                                                                                               [=======]
  Advanced Search + Pruning                                                                                            [===]
```

**Total estimated duration: 23.5-33.5 weeks** (one developer full-time)

With two developers working in parallel (one backend, one frontend), the timeline compresses to approximately **14-20 weeks**.

The 5-week increase over the original estimate is front-loaded in Phase 1 where session history, workspace persistence, and the agent pane tab rail are foundational infrastructure that all subsequent phases benefit from. Phases 2-4 are only marginally larger because they reuse the tab rail, snapshot, and history infrastructure built in Phase 1.

---

## Technology Stack

See `09-NEXTJS-ARCHITECTURE.md` for full details.

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.6 (App Router, Turbopack default, Server Components, Server Actions) |
| Language | TypeScript 5 |
| UI Components | Radix UI primitives (installed individually) + Tailwind CSS 4 (CSS-first `@theme`) |
| Workspace Layout | react-resizable-panels v4 (`Group`/`Panel`/`Separator`, `orientation` prop) |
| State Management | Zustand v5 |
| Database | SQLite (better-sqlite3 v12) with FTS5 |
| WebSocket | ws v8 (custom `server.ts`, production only — dev uses `next dev` directly) |
| Visualization | Canvas 2D (timeline) + SVG (graph) + recharts v3 (charts) |
| Syntax Highlighting | shiki v4 |
| Testing | Vitest v4 + @testing-library/react |

---

## Development Environment Setup

### Prerequisites

```bash
# Required
node >= 20.0.0
npm >= 10.0.0
docker >= 20.10
docker compose >= 2.0

# Recommended
git
```

### Local Development

```bash
# Install dependencies (postinstall auto-rebuilds better-sqlite3)
npm install

# Start development server (next dev -p 3456, no custom server in dev)
npm run dev
# → http://localhost:3456

# If you switch Node.js versions, rebuild the native module:
npm run rebuild-native

# Run tests
npm test
```

### Development with Docker

```bash
# Build and start
docker compose up --build

# docker-compose.dev.yml overrides (for live reload):
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
# - Mounts app/ and components/ for Next.js HMR
# - Sets NODE_ENV=development
# - Enables debug logging
```

### Testing Strategy

| Layer | Framework | Coverage Target |
|-------|-----------|-----------------|
| Unit (services) | Vitest | 80% |
| Unit (components) | Vitest + @testing-library/react | 60% |
| Integration (API routes) | Vitest + next/test | 70% |
| E2E (browser) | Playwright | Key flows only |

### Quality Gates

Before each phase ships:

- [ ] All tests pass
- [ ] `next build` succeeds with zero TypeScript errors
- [ ] `next lint` passes
- [ ] No P0/P1 known bugs
- [ ] Performance targets met (see PRD section 2.2)
- [ ] Docker build succeeds (standalone output)
- [ ] Manual testing of all new features
- [ ] Existing features regression-tested
