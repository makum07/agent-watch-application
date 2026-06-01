# Product Requirements Document (PRD)

## AgentWatch v2.0

**Document Version:** 1.1
**Date:** 2026-05-31
**Status:** Draft
**Amendment:** See `08-REFINEMENT-AGENT-PANES-SESSION-HISTORY-WORKSPACE-PERSISTENCE.md` for v1.1 additions

---

## 1. Executive Summary

AgentWatch v2.0 transforms the existing Claude Code Chat Explorer from a conversation browser and search tool into a full multi-agent orchestration visualization and debugging platform. The product enables users to visually decompose, inspect, and compare complex Claude Code sessions involving multiple specialized agents, tool invocations, artifact generation, and context propagation.

The application is self-hosted, runs entirely via Docker Compose, and requires zero external dependencies or accounts.

### 1.1 Problem Statement

Claude Code sessions involving multi-agent orchestration produce deeply nested, concurrent execution flows that are nearly impossible to follow in a terminal or VS Code extension. Users cannot:

- See which agents ran concurrently vs. sequentially
- Trace what context flowed from parent to child agents
- Compare outputs from parallel agents side-by-side
- Identify bottlenecks, redundant work, or context drift
- Understand the full agent hierarchy at a glance

### 1.2 Solution

A tmux-inspired multi-pane workspace where users can drag agents into panes, visualize execution timelines, trace context flow, and debug orchestration logic visually.

### 1.3 Target Users

- **Primary:** Developers and AI engineers using Claude Code for complex, multi-agent workflows
- **Secondary:** Team leads reviewing AI-assisted development sessions for quality, efficiency, or compliance
- **Tertiary:** Researchers studying multi-agent coordination patterns

---

## 2. Product Vision

### 2.1 Vision Statement

Make multi-agent AI workflows as inspectable as single-threaded code in a debugger.

### 2.2 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Session load time (100 agents) | < 3 seconds | P95 from session ID to full render |
| Time to first insight | < 30 seconds | User opens session and identifies an agent relationship |
| Pane arrangement speed | < 5 seconds | Drag agent to pane, resize, compare |
| Search latency | < 200ms | Full-text search across session content |
| Docker startup time | < 30 seconds | From `docker compose up` to browser-ready |

### 2.3 Non-Goals (v2.0)

- Real-time streaming of active sessions (future)
- Remote/cloud deployment
- Multi-user collaboration
- Session replay/playback
- Editing or re-running sessions
- Integration with non-Claude AI systems

---

## 3. User Personas

### 3.1 Alex - Power User

**Role:** Senior software engineer using Claude Code daily with orchestrated workflows
**Needs:** Understand why a 15-agent session produced unexpected results; compare outputs from parallel code reviewers; identify which agent consumed the most tokens
**Pain:** Scrolling through 2000+ lines of terminal output to find one agent's contribution

### 3.2 Morgan - Team Lead

**Role:** Engineering manager reviewing Claude-assisted work
**Needs:** Verify that AI-generated code was reviewed by the right agents; understand cost implications; audit tool usage
**Pain:** No structured way to review what happened in a complex session

### 3.3 Sam - Researcher

**Role:** AI researcher studying multi-agent coordination
**Needs:** Export execution traces; compare orchestration patterns; measure agent efficiency
**Pain:** Session data is locked in JSONL files with no visualization

---

## 4. Core Requirements

### 4.1 Session Discovery and Import

| ID | Requirement | Priority |
|----|------------|----------|
| SD-01 | Discover Claude sessions from `~/.claude/projects/` automatically | P0 |
| SD-02 | Import a session by providing a session/conversation ID | P0 |
| SD-03 | Detect and reconstruct parent-child agent relationships from JSONL data | P0 |
| SD-04 | Handle sessions with 500+ agent invocations without degradation | P0 |
| SD-05 | Support incremental session refresh (detect new messages in active sessions) | P1 |
| SD-06 | Parse `Agent` tool calls to extract subagent_type, prompt, schema, model overrides | P0 |
| SD-07 | Parse `Workflow` tool calls to extract script, phases, pipeline/parallel structure | P0 |
| SD-08 | Correlate subagent JSONL files with parent conversation Task tool_use blocks | P0 |
| SD-09 | Display a session loading progress indicator for large sessions | P1 |

### 4.2 Multi-Pane Workspace

| ID | Requirement | Priority |
|----|------------|----------|
| WS-01 | Split workspace horizontally and vertically (unlimited nesting) | P0 |
| WS-02 | Resize panes via drag handles | P0 |
| WS-03 | Minimum pane size enforcement (200px) | P0 |
| WS-04 | Maximize/restore a single pane (double-click title bar) | P1 |
| WS-05 | Close a pane (merges space into sibling) | P0 |
| WS-06 | Save named workspace layouts to SQLite (see 4.11 WP-06) | P1 |
| WS-07 | Restore saved layouts (see 4.11 WP-07) | P1 |
| WS-08 | Preset layouts: single, 2-column, 3-column, quad, orchestrator+agents | P1 |
| WS-09 | Keyboard shortcuts for split/close/navigate (Ctrl+Shift+arrows) | P2 |
| WS-10 | Pane tab bar when multiple views are stacked in one pane | P1 |

### 4.3 Agent View Management

| ID | Requirement | Priority |
|----|------------|----------|
| AV-01 | Display agent list in a sidebar panel with hierarchy | P0 |
| AV-02 | Drag an agent from the sidebar into any pane | P0 |
| AV-03 | Each pane renders the selected agent's full message thread | P0 |
| AV-04 | Agent message view includes: text, tool calls (expandable), tool results | P0 |
| AV-05 | Syntax-highlighted code blocks in agent messages | P0 |
| AV-06 | Markdown rendering for agent text content | P0 |
| AV-07 | Visual indicator showing which pane is focused | P0 |
| AV-08 | Agent status badges: running, completed, errored | P1 |
| AV-09 | Cross-pane scroll synchronization (optional, toggle-able) | P2 |
| AV-10 | Context summary header in each pane: agent type, model, parent, token count | P0 |
| AV-11 | Agent pane tab rail: Conversation, Artifacts, Context, Tools, Summary | P0 |
| AV-12 | Inline artifact cards in conversation tab for Write/Edit tool calls | P0 |
| AV-13 | Per-agent artifact tab showing produced and consumed artifacts | P0 |
| AV-14 | Per-agent context tab showing prompt received and response returned | P0 |
| AV-15 | Per-agent tools tab with filterable, grouped tool call log | P1 |
| AV-16 | Per-agent summary tab with metadata, tokens, duration, children | P0 |
| AV-17 | Artifact preview within inline cards (first 10 lines, syntax highlighted) | P0 |
| AV-18 | Open artifact in dedicated pane from inline card | P0 |
| AV-19 | Artifact lineage strip showing producer/consumer chain | P1 |
| AV-20 | Cross-agent artifact diff view (file modified by multiple agents) | P2 |

### 4.4 Session Visualization

| ID | Requirement | Priority |
|----|------------|----------|
| SV-01 | Agent hierarchy tree (collapsible, showing parent-child relationships) | P0 |
| SV-02 | Execution timeline (horizontal, showing agent lifespans as bars) | P0 |
| SV-03 | Invocation chain view (sequence diagram style) | P1 |
| SV-04 | Tool usage heatmap per agent | P1 |
| SV-05 | Artifact flow graph (which agent created/consumed each artifact) | P2 |
| SV-06 | Context propagation overlay on timeline (arrows showing data flow) | P2 |
| SV-07 | Concurrent vs. sequential execution indicators | P0 |
| SV-08 | Click any element in a visualization to navigate to that message in a pane | P0 |

### 4.5 Search and Filtering

| ID | Requirement | Priority |
|----|------------|----------|
| SF-01 | Global search across all agents in a session | P0 |
| SF-02 | Per-agent search within a pane | P0 |
| SF-03 | Filter by agent type (general-purpose, Explore, Plan, etc.) | P0 |
| SF-04 | Filter by tool name | P0 |
| SF-05 | Filter by time range (slider on timeline) | P1 |
| SF-06 | Filter by message role (user, assistant, tool) | P1 |
| SF-07 | Jump to invocation point (from child agent back to parent's tool_use block) | P0 |
| SF-08 | Highlight search results across all open panes simultaneously | P1 |
| SF-09 | Search result count per agent | P1 |

### 4.6 Artifact Exploration

| ID | Requirement | Priority |
|----|------------|----------|
| AE-01 | List all artifacts (files written, code generated) per session | P0 |
| AE-02 | Show artifact content with syntax highlighting | P0 |
| AE-03 | Track artifact lineage: which agent created, which agents consumed | P1 |
| AE-04 | Diff view for artifacts modified by multiple agents | P2 |
| AE-05 | File tree view of all files touched during the session | P1 |

### 4.7 Context Tracking

| ID | Requirement | Priority |
|----|------------|----------|
| CT-01 | Display the prompt an agent received from its parent | P0 |
| CT-02 | Display the final response an agent returned to its parent | P0 |
| CT-03 | Visual diff between what parent sent and what child received | P2 |
| CT-04 | Context size indicator (token count) per agent | P0 |
| CT-05 | Flag agents that received large contexts (potential waste) | P2 |

### 4.8 Timeline View

| ID | Requirement | Priority |
|----|------------|----------|
| TL-01 | Horizontal timeline with agent bars showing start/end/duration | P0 |
| TL-02 | Color-coded by agent type | P0 |
| TL-03 | Zoomable (mouse wheel) and pannable (drag) | P0 |
| TL-04 | Tool call markers on agent bars | P1 |
| TL-05 | Artifact creation markers on timeline | P1 |
| TL-06 | Hover tooltip with agent summary | P0 |
| TL-07 | Click bar to open agent in a pane | P0 |
| TL-08 | Minimap for large sessions | P2 |
| TL-09 | Concurrent execution lanes (swim lanes) | P1 |

### 4.9 Analytics and Debugging

| ID | Requirement | Priority |
|----|------------|----------|
| AD-01 | Token usage breakdown by agent | P0 |
| AD-02 | Cost estimation by agent and total | P0 |
| AD-03 | Detect duplicate/redundant work across agents | P2 |
| AD-04 | Detect excessive tool usage (agent calling same tool > N times) | P2 |
| AD-05 | Detect potential agent loops (repeated similar prompts) | P2 |
| AD-06 | Session summary: total agents, total tokens, total duration, total tool calls | P0 |
| AD-07 | Execution bottleneck identification (longest-running agents on critical path) | P2 |
| AD-08 | Model usage breakdown (which agents used which models) | P1 |

### 4.10 Home Dashboard and Session History

| ID | Requirement | Priority |
|----|------------|----------|
| DB-01 | List all discovered sessions with metadata | P0 |
| DB-02 | Session cards showing: project, date, agent count, message count, status | P0 |
| DB-03 | Search/filter sessions by project, date, keyword | P0 |
| DB-04 | Quick-open session into workspace | P0 |
| DB-05 | Recent sessions section | P0 |
| DB-06 | Session comparison (select two sessions, view side-by-side metrics) | P2 |
| DB-07 | Persistent session history: track all previously opened sessions | P0 |
| DB-08 | Pinned sessions section at top of home dashboard | P0 |
| DB-09 | Session title auto-generation from first user message | P0 |
| DB-10 | User-editable session title | P1 |
| DB-11 | Session favoriting (long-term bookmarks) | P1 |
| DB-12 | Session tagging with free-text tags and autocomplete | P1 |
| DB-13 | Filter sessions by pin/favorite status, tags, project, date range | P0 |
| DB-14 | Search sessions by ID, title, agent names, artifact names | P0 |
| DB-15 | Session notes (free-text field per session) | P2 |
| DB-16 | Open session by pasting session ID or path | P0 |
| DB-17 | Session metadata caching (agent count, token count, cost) | P0 |
| DB-18 | Stale session detection (source JSONL deleted) | P1 |
| DB-19 | History auto-prune after 180 days of inactivity | P2 |

### 4.11 Workspace Persistence

| ID | Requirement | Priority |
|----|------------|----------|
| WP-01 | Auto-save workspace layout on every change (debounced 2s) | P0 |
| WP-02 | Auto-save pane tab states (active tab, scroll position, expanded items) | P0 |
| WP-03 | Auto-save global view state (sidebar, filters, search) | P1 |
| WP-04 | Restore workspace when reopening a previously viewed session | P0 |
| WP-05 | Resume dialog: Resume Last, Timeline, Agent Explorer, Artifact Explorer, Fresh | P0 |
| WP-06 | Named layout saves (user-defined names, persist per session) | P1 |
| WP-07 | Named layout recall from workspace header dropdown | P1 |
| WP-08 | "Always resume" preference to skip the resume dialog | P1 |
| WP-09 | Store workspace snapshots in SQLite (survive browser cache clears) | P0 |
| WP-10 | Keep only one auto-save per session (overwrite previous) | P0 |
| WP-11 | Maximum 20 named saves per session | P1 |

---

## 5. Installation and Deployment Requirements

### 5.1 Distribution

| ID | Requirement | Priority |
|----|------------|----------|
| DP-01 | Ship as source code (zip or git clone) | P0 |
| DP-02 | Single `docker compose up` to start | P0 |
| DP-03 | No external service dependencies | P0 |
| DP-04 | No user accounts or authentication required | P0 |
| DP-05 | Works on macOS, Linux, and Windows (Docker Desktop) | P0 |
| DP-06 | Persist data across container restarts (Docker volumes) | P0 |
| DP-07 | Upgrade by pulling new source and rebuilding | P0 |

### 5.2 Performance Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| PF-01 | Load a 500-agent session in < 5 seconds | P0 |
| PF-02 | Smooth pane resize at 60fps | P0 |
| PF-03 | Timeline render with 200 agents in < 1 second | P0 |
| PF-04 | Search results in < 500ms for 10K messages | P0 |
| PF-05 | Memory usage < 2GB for the largest expected sessions | P0 |
| PF-06 | Container startup < 30 seconds including indexing | P0 |

---

## 6. Compatibility

### 6.1 Browser Support

- Chrome 100+
- Firefox 100+
- Safari 16+
- Edge 100+

### 6.2 Docker Requirements

- Docker Engine 20.10+
- Docker Compose V2
- 2GB available RAM
- 1GB available disk space

### 6.3 Claude Code Compatibility

- Claude Code CLI sessions (JSONL format)
- Support for Agent tool calls (subagent orchestration)
- Support for Workflow tool calls (scripted orchestration)
- Support for all standard tool calls (Bash, Read, Write, Edit, Grep, Glob, etc.)

---

## 7. Future Considerations (Out of Scope for v2.0)

- Real-time streaming of in-progress sessions
- Session replay with playback controls
- Collaborative session review (multi-user)
- Cloud deployment option
- Custom visualization plugins
- Session annotation and commenting
- Export to external analysis tools
- API for programmatic access
- Integration with CI/CD pipelines
