# Implementation Roadmap

## AgentWatch v2.0

**Amendment:** Phase effort and feature lists updated per `08-REFINEMENT-AGENT-PANES-SESSION-HISTORY-WORKSPACE-PERSISTENCE.md`
**Amendment:** Phase 1.5 (Improvement Loop) added per `10-IMPROVEMENT-LOOP.md`
**Status:** Phase 1 MVP complete as of 2026-06-01. Phase 1.5 Improvement Loop complete as of 2026-06-08.

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

## Phase 2: Advanced Visualization (6-8 weeks)

### Goal

Rich visual representations of session execution: interactive timeline, agent hierarchy graph, session-wide artifact explorer, per-agent artifact and tool tabs, and enhanced workspace and session management features.

### Features

| Feature | Description | Effort |
|---------|-------------|--------|
| **Execution Timeline** | Canvas-based horizontal timeline with agent bars, zoom, pan, viewport culling | 2 weeks |
| **Agent Hierarchy Graph** | SVG-based tree/DAG layout with force-directed positioning, zoom, pan | 1.5 weeks |
| **Session Artifact Explorer** | Detect file Write/Edit operations, build file tree, show content with syntax highlighting | 1.5 weeks |
| **Per-Agent Artifacts Tab** | Produced/consumed file lists within the agent pane, preview panel, filters | 0.5 weeks |
| **Per-Agent Tools Tab** | Grouped, filterable tool call log within the agent pane | 0.5 weeks |
| **Timeline Markers** | Tool call diamonds and artifact creation squares on timeline bars | 0.5 weeks |
| **Concurrent Execution Lanes** | Swim lanes showing agents running in parallel | 0.5 weeks |
| **Named Layout Saves** | Save/restore named layouts per session, layout dropdown with presets | 0.5 weeks |
| **Pinning and Favorites** | Pin/favorite actions on session cards, filtered views on home dashboard | 0.5 weeks |
| **Graph Interactions** | Click node to open agent, hover for tooltip, collapse subtrees | 0.5 weeks |
| **Pane Maximize/Restore** | Double-click title bar to maximize a pane | 0.25 weeks |
| **Pane Tab Management** | Tab bar, reorder tabs, close tab, add tab | 0.5 weeks |

### Architecture Changes

| Component | Change |
|-----------|--------|
| Backend | New `src/services/ArtifactTracker.js` |
| Backend | New `src/routes/artifacts.js` |
| Backend | `timeline_events` table populated during ingestion |
| Frontend | New `src/analytics-web/components/visualization/` directory |
| Frontend | Canvas rendering engine for timeline |
| Frontend | SVG rendering for agent graph |
| Frontend | Prism.js added for syntax highlighting |

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Canvas performance** | Timeline with 500 agents requires efficient rendering. | Viewport culling: only render visible bars. Offscreen canvas for pre-rendering. RequestAnimationFrame for smooth updates. |
| **SVG scaling** | Force-directed graph with 500 nodes may be slow. | Compute layout in Web Worker. Cap visible nodes at 100, show "expand" buttons for large subtrees. |
| **Artifact content size** | Large files (1MB+) in artifact viewer could freeze the browser. | Truncate display to first 10K lines. Lazy-render with virtual scrolling. |

### Deliverables

- [ ] Interactive execution timeline (Canvas)
- [ ] Agent hierarchy graph (SVG)
- [ ] Artifact explorer with file tree
- [ ] Timeline markers (tool calls, artifacts)
- [ ] Concurrent execution lanes
- [ ] Layout save/restore
- [ ] Pane maximize/restore
- [ ] Tab management within panes

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

## Phase 3: Multi-Agent Analysis (4-6 weeks)

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

- [ ] Context flow DAG visualization
- [ ] Context inspector panel per agent
- [ ] Advanced search with filters
- [ ] Invocation navigation (jump to parent)
- [ ] Workflow structure visualization
- [ ] Optional scroll synchronization
- [ ] Agent comparison view
- [ ] Cross-pane search highlighting

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

## Phase 4: Analytics and Debugging (4-6 weeks)

### Goal

Automated analysis and debugging insights: bottleneck detection, duplicate work identification, cost optimization, session comparison, and export.

### Features

| Feature | Description | Effort |
|---------|-------------|--------|
| **Session Analytics Dashboard** | Summary metrics: duration, tokens, cost, parallelism factor, model breakdown | 1 week |
| **Debug Analyzer** | Automated detection of bottlenecks, loops, duplicate work, excessive tool usage, context bloat | 2 weeks |
| **Debug Alerts UI** | Alert cards with severity, description, and navigation to relevant agent | 0.5 weeks |
| **Cost Breakdown** | Detailed cost by agent, by model, by phase, with pie/bar charts | 1 week |
| **Session Comparison** | Compare two sessions side-by-side: metrics, agent topology, cost | 1 week |
| **Export** | Export session data as JSON, Markdown, or HTML report | 0.5 weeks |
| **Performance Profiling** | Identify critical path agents (longest chain from root to leaf) | 0.5 weeks |
| **Pattern Detection** | Identify common agent orchestration patterns across sessions | 1 week |

### Architecture Changes

| Component | Change |
|-----------|--------|
| Backend | New `src/services/DebugAnalyzer.js` |
| Backend | New `src/routes/analytics.js` (v2 analytics) |
| Backend | Session comparison endpoint |
| Backend | Export endpoint (JSON, Markdown, HTML) |
| Frontend | New `src/analytics-web/components/analytics/` directory |
| Frontend | Chart library (or reuse existing Charts.js) |

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Duplicate work detection** | Determining if two agents did "duplicate" work is imprecise. Similar tool calls don't always mean redundancy. | Use multiple signals: same tool + same arguments, same file reads, similar prompt text. Report as "potential" with confidence score. |
| **Loop detection** | Agent loops may be intentional (iterative refinement) or accidental. | Detect repeated similar prompts within a session. Flag only when > 3 iterations with high prompt similarity (> 90% by Jaccard). |
| **Cost estimation accuracy** | Model pricing changes over time. | Make pricing configurable (JSON config file). Display "estimated" with clear caveats. |

### Deliverables

- [ ] Session analytics dashboard with summary metrics
- [ ] Debug analyzer with 6 detection types
- [ ] Debug alerts UI with severity and navigation
- [ ] Cost breakdown charts
- [ ] Session comparison view
- [ ] Export to JSON/Markdown/HTML
- [ ] Critical path identification
- [ ] Cross-session pattern detection

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
