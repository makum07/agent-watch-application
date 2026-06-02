# UI/UX Design Specification

## AgentWatch v2.0

**Amendment:** Sections 2, 3.3, and new sections 13-17 updated per `08-REFINEMENT-AGENT-PANES-SESSION-HISTORY-WORKSPACE-PERSISTENCE.md`
**Implementation:** UI implemented with Next.js 16.2.6 App Router + Radix UI primitives + Tailwind CSS v4. Wireframes in this document remain the design spec. Actual component mapping:
- Workspace panes → `react-resizable-panels` v4 (`Group`/`Panel`/`Separator` with `orientation` prop)
- Agent tab rail → **custom button tabs** (colored per agent type, not shadcn Tabs)
- Session search → `cmdk` Command palette
- Tool call expansion + sidebar rounds → `@radix-ui/react-collapsible`
- Scroll areas → `@radix-ui/react-scroll-area`
- Artifact cards inline in conversation → custom `ArtifactCard` component
- Artifact full pane → `ArtifactPaneView` with custom markdown parser

---

## 1. Design System

### 1.1 Color Palette

```css
:root {
  /* Base */
  --bg-primary: #0d1117;          /* Main background */
  --bg-secondary: #161b22;        /* Cards, panels */
  --bg-tertiary: #21262d;         /* Elevated surfaces */
  --bg-hover: #30363d;            /* Hover states */
  
  /* Text */
  --text-primary: #e6edf3;        /* Primary text */
  --text-secondary: #8b949e;      /* Secondary text */
  --text-muted: #484f58;          /* Muted text */
  
  /* Borders */
  --border-default: #30363d;
  --border-muted: #21262d;
  
  /* Accent */
  --accent-blue: #58a6ff;
  --accent-green: #3fb950;
  --accent-orange: #f0883e;
  --accent-red: #f85149;
  --accent-purple: #bc8cff;
  --accent-teal: #39d353;
  
  /* Agent Type Colors */
  --agent-orchestrator: #58a6ff;   /* Blue */
  --agent-explore: #3fb950;        /* Green */
  --agent-plan: #f0883e;           /* Orange */
  --agent-general: #bc8cff;        /* Purple */
  --agent-code-reviewer: #f85149;  /* Red */
  --agent-workflow: #39d353;       /* Teal */
  --agent-default: #8b949e;        /* Gray */
  
  /* Pane */
  --pane-border: #30363d;
  --pane-border-focused: #58a6ff;
  --pane-divider: #21262d;
  --pane-divider-hover: #58a6ff;
  
  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  
  /* Typography */
  --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-size-xs: 11px;
  --font-size-sm: 12px;
  --font-size-md: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 20px;
  --font-size-2xl: 24px;
  
  /* Radii */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}
```

### 1.2 Component Library

**Badge:**
```
[Completed]  - Green background, green text
[Running]    - Blue background, blue text  
[Errored]    - Red background, red text
[Explore]    - Green border, green text
[Plan]       - Orange border, orange text
[Workflow]   - Teal border, teal text
```

**Card:**
```
+------------------------------------------+
| Card content with rounded corners        |
| Background: var(--bg-secondary)          |
| Border: 1px solid var(--border-default)  |
| Padding: var(--space-md)                 |
| Border-radius: var(--radius-md)          |
+------------------------------------------+
```

**Button (Primary):**
```
[  Action  ]
Background: var(--accent-blue)
Color: white
Padding: 6px 16px
Border-radius: var(--radius-sm)
```

---

## 2. Page: Dashboard

### 2.1 Wireframe

```
+-----------------------------------------------------------------------+
| AgentWatch                              [Search...] [?]  |
+----+-----------------------------------------------------------------+
|    |                                                                   |
| S  |  Sessions                                          [Refresh]    |
| I  |                                                                   |
| D  |  +--------------------+  +--------------------+  +----------+   |
| E  |  | Total Sessions     |  | Total Agents       |  | Today    |   |
| B  |  | 47                 |  | 312                |  | 5 sessions|   |
| A  |  +--------------------+  +--------------------+  +----------+   |
| R  |                                                                   |
|    |  [All] [Today] [This Week] [This Month]     [Sort: Recent v]    |
| +--+                                                                   |
| |D |  +---------------------------------------------------------------+
| |a |  | Session: Payment API Refactor                                  |
| |s |  | Project: /home/user/myproject                                  |
| |h |  | 2026-05-30 10:00 - 12:30  |  23 agents  |  1.2M tokens      |
| |b |  | Models: opus-4-6, sonnet-4-6                                   |
| |o |  | Tools: Bash(15), Read(22), Write(8), Agent(8)                 |
| |a |  |                                              [Open Workspace] |
| |r |  +---------------------------------------------------------------+
| |d |                                                                   |
| |  |  +---------------------------------------------------------------+
| |S |  | Session: Bug Fix #4521                                         |
| |e |  | Project: /home/user/webapp                                     |
| |s |  | 2026-05-30 08:15 - 08:45  |  3 agents   |  85K tokens       |
| |s |  |                                              [Open Workspace] |
| |i |  +---------------------------------------------------------------+
| |o |                                                                   |
| |n |  +---------------------------------------------------------------+
| |s |  | Session: Code Review Sprint                                    |
|    |  | ...                                                            |
+----+---------------------------------------------------------------+
```

### 2.2 Sidebar

```
+------------------------+
|  AGENTWATCH            |
|                        |
+------------------------+
|                        |
|  [D] Dashboard         |
|  [W] Workspace         |
|  [T] Timeline          |
|  [A] Analytics         |
|                        |
+------------------------+
|  Recent Sessions       |
|  > Payment API (23)    |
|  > Bug Fix (3)         |
|  > Sprint Review (12)  |
+------------------------+
|  Projects              |
|  > myproject (15)      |
|  > webapp (8)          |
|  > infra (5)           |
+------------------------+
```

### 2.3 Session Card Detail

Each session card shows at a glance:

```
+-----------------------------------------------------------------------+
| [BLUE DOT] Payment API Refactor                    [Completed] [...]  |
|                                                                        |
| /home/user/myproject                                                   |
|                                                                        |
| +--------+  +--------+  +--------+  +--------+  +---------+          |
| | 23     |  | 1.2M   |  | 312    |  | 2h 30m |  | $12.50  |          |
| | agents |  | tokens |  | tools  |  | duration|  | cost    |          |
| +--------+  +--------+  +--------+  +--------+  +---------+          |
|                                                                        |
| Agent hierarchy preview:                                               |
| Main > Explore(3), Plan(1) > Explore(2), Impl(1) > Review(1)         |
|                                                                        |
| [Open in Workspace]  [View Timeline]  [View Analytics]                |
+-----------------------------------------------------------------------+
```

---

## 3. Page: Multi-Pane Workspace

### 3.1 Wireframe - Default Layout

```
+-----------------------------------------------------------------------+
| AgentWatch  |  Payment API Refactor  |  [Layout v] [?]  |
+----+------------------------------+-----------------------------------+
|    |                              |                                    |
| A  | ORCHESTRATOR                 | EXPLORE: Code Search               |
| G  |                              |                                    |
| E  | [user] 10:00:00              | [prompt] Find all files that...   |
| N  | Refactor the payment API     |                                    |
| T  | to use the new gateway...    | [assistant] 10:05:02              |
|    |                              | I'll search for payment files.    |
| S  | [assistant] 10:00:05         |                                    |
| I  | I'll break this into steps:  | > Grep: PaymentService    [v]    |
| D  | 1. Analyze current code      | > Read: src/payment.ts    [v]    |
| E  | 2. Design new interface      | > Read: src/api/ctrl.ts   [v]    |
| B  | 3. Implement changes         |                                    |
| A  | 4. Write tests               | Found 5 files implementing...    |
| R  | 5. Review                    |                                    |
|    |                              | [response] Returned to parent     |
| +--+ > Agent: Explore        [v] +-----------------------------------+
| |  | > Agent: Plan            [v] |                                    |
| |  |                              | PLAN: Architecture Review          |
| |  | [assistant] 10:08:15         |                                    |
| |  | Based on the code analysis:  | [prompt] Review the architecture  |
| |  |                              | of the payment module and...      |
| |  | > Agent: Impl            [v] |                                    |
| |  |                              | [assistant] 10:10:30              |
| |  | [assistant] 10:45:00         | The current architecture has...   |
| |  | Implementation complete.     |                                    |
| |  |                              | > Agent: Explore (DB)     [v]    |
| |  | > Agent: Review          [v] | > Agent: Explore (API)    [v]    |
| |  |                              |                                    |
+----+------------------------------+-----------------------------------+
```

### 3.2 Wireframe - 4-Pane Layout with Timeline

```
+-----------------------------------------------------------------------+
| AgentWatch  |  Payment API Refactor  |  [Layout v] [?]  |
+----+------------------+------------------+----------------------------+
|    |                   |                  |                             |
| A  | ORCHESTRATOR      | EXPLORE          | IMPL: Implementation       |
| G  |                   |                  |                             |
| E  | [messages...]     | [messages...]    | [messages...]              |
| N  |                   |                  |                             |
| T  |                   |                  |                             |
|    |                   |                  |                             |
| S  |                   |                  |                             |
| I  +------------------+------------------+----------------------------+
| D  |                                                                   |
| E  | TIMELINE                                                          |
| B  |                                                                   |
| A  |  0m    15m    30m    45m    60m    75m    90m                     |
| R  |  |------|------|------|------|------|------|                      |
|    |  Main [==============================================]            |
| +--+    Explore [====]                                                 |
| |  |    Plan       [========]                                          |
| |  |      Explore    [===]                                             |
| |  |      Explore      [==]                                            |
| |  |    Impl              [===============]                            |
| |  |      Explore           [====]                                     |
| |  |    Review                             [======]                    |
| |  |                                                                   |
+----+---------------------------------------------------------------+
```

### 3.3 Pane Controls

Each agent pane has a header bar and a tab rail:

```
+------------------------------------------------------------------+
| [icon] Impl Agent            | [Search] [Max] [Close]           |
| Parent: Orchestrator | opus-4-6 | 150K tok | 45m    | [done]   |
+------------------------------------------------------------------+
| [Conversation] [Artifacts 8] [Context] [Tools 42] [Summary]     |
+------------------------------------------------------------------+
|                                                                    |
|  (active tab content rendered here)                                |
|                                                                    |
+------------------------------------------------------------------+
```

- **Agent icon:** Color-coded by type
- **Tab rail:** Five tabs; active tab has bottom border in `--accent-blue`
- **Conversation tab:** Message thread with inline artifact cards
- **Artifacts tab:** Produced/consumed artifact list with preview
- **Context tab:** Prompt received, response returned, artifacts transferred
- **Tools tab:** Grouped, filterable tool call log
- **Summary tab:** Agent metadata, execution stats, children
- **Search button:** Opens in-pane search (searches within active tab)
- **Max button:** Toggles maximize/restore
- **Close button:** Closes pane
- Tabs show counts (Artifacts count, Tools count)
- Tab state persists in workspace snapshots
- Keyboard: `Ctrl+1..5` to switch tabs within focused pane

### 3.4 Pane Divider

```
Inactive:                    Active (hover/drag):
+---+                        +---+
|   | 4px, var(--pane-divider) |   | 4px, var(--accent-blue)
+---+                        +---+
      cursor: col-resize           cursor: col-resize
```

### 3.5 Agent Sidebar (Expanded)

```
+--------------------------------+
| SESSION INFO                    |
| Payment API Refactor            |
| /home/user/myproject            |
| 2h 30m | 23 agents | 1.2M tok |
+--------------------------------+
| [Search agents...]              |
+--------------------------------+
| AGENT HIERARCHY                 |
|                                 |
| [drag] Main Orchestrator [v]    |
|   |    opus-4-6 | 80K tokens    |
|   |                             |
|   +- [drag] Explore: Code   [c]|
|   |    sonnet-4-6 | 13K tok     |
|   |                             |
|   +- [drag] Plan: Arch      [c]|
|   |  |  orange-4-6 | 25K tok   |
|   |  |                          |
|   |  +- [drag] Explore: DB  [c]|
|   |  |    sonnet | 8K tok       |
|   |  |                          |
|   |  +- [drag] Explore: API [c]|
|   |       sonnet | 6K tok       |
|   |                             |
|   +- [drag] Impl            [c]|
|   |  |  opus-4-6 | 150K tok    |
|   |  |                          |
|   |  +- [drag] Explore: Test[c]|
|   |       sonnet | 12K tok      |
|   |                             |
|   +- [drag] Review           [c]|
|        opus-4-6 | 45K tok      |
+--------------------------------+
| VIEWS                          |
| [drag] Timeline                |
| [drag] Agent Graph             |
| [drag] Artifacts               |
| [drag] Analytics               |
+--------------------------------+
```

Legend: `[drag]` = drag handle, `[c]` = completed badge, `[v]` = expand/collapse

---

## 4. Page: Timeline View

### 4.1 Full-Page Timeline

```
+-----------------------------------------------------------------------+
| TIMELINE                          [Zoom: [-----|----] ] [Reset] [?]   |
+-----------------------------------------------------------------------+
|                                                                        |
| Time: 10:00   10:15   10:30   10:45   11:00   11:15   11:30          |
|       |       |       |       |       |       |       |               |
| Main  [======================================================]       |
|  |    * * *   *              *  * *                    *              |
|  |                                                                    |
|  +-- Explore  [====]                                                  |
|  |            ** **                                                   |
|  |                                                                    |
|  +-- Plan         [========]                                          |
|  |   |            *   * *                                             |
|  |   |                                                                |
|  |   +-- Explore    [===]                                             |
|  |   |              ** *                                              |
|  |   |                                                                |
|  |   +-- Explore      [==]                                            |
|  |                     * *                                            |
|  |                                                                    |
|  +-- Impl                 [===============]                           |
|  |   |                     * * * * * * * *                            |
|  |   |                                                                |
|  |   +-- Explore             [====]                                   |
|  |                           ** * *                                   |
|  |                                                                    |
|  +-- Review                                [======]                   |
|                                             * * *                     |
|                                                                        |
+-----------------------------------------------------------------------+
| Legend: [====] Agent duration  * Tool call  # Artifact                |
+-----------------------------------------------------------------------+
```

### 4.2 Timeline Bar Tooltip (on hover)

```
+-----------------------------------+
| Explore: Code Search              |
| Type: Explore                     |
| Model: sonnet-4-6                 |
| Duration: 3m 12s                  |
| Tokens: 13,000                    |
| Tool calls: 8                     |
| Status: Completed                 |
|                                   |
| Click to open in workspace        |
+-----------------------------------+
```

### 4.3 Concurrent Execution Highlighting

When agents run simultaneously, their bars appear at the same vertical position with distinct colors and a light overlap indicator:

```
Time: 10:20   10:25   10:30   10:35
      |       |       |       |
Plan  [==================]             
  Explore [=======]                     <- Concurrent
  Explore    [=====]                    <- Concurrent
          ^^^^^^^^^^^                    
          Overlap zone (subtle highlight)
```

---

## 5. Page: Agent Graph View

### 5.1 Tree Layout

```
+-----------------------------------------------------------------------+
| AGENT GRAPH                           [Layout: Tree v] [Zoom] [?]    |
+-----------------------------------------------------------------------+
|                                                                        |
|                    +-------------------+                               |
|                    | Main Orchestrator |                               |
|                    | opus-4-6 | 80K   |                               |
|                    +--------+----------+                               |
|                             |                                          |
|              +--------------+--+--+--------+                          |
|              |              |     |        |                          |
|     +--------+---+  +------+--+  |  +-----+------+                   |
|     | Explore    |  | Plan    |  |  | Review     |                   |
|     | 13K tokens |  | 25K tok |  |  | 45K tokens |                   |
|     +------------+  +----+----+  |  +------------+                   |
|                          |       |                                     |
|                    +-----+---+   |                                     |
|                    |         |   |                                     |
|              +-----+--+ +---+-----+  +-------+----+                  |
|              | Explore | | Explore |  | Impl       |                  |
|              | DB: 8K  | | API: 6K|  | 150K tokens |                  |
|              +---------+ +--------+  +------+------+                  |
|                                             |                          |
|                                       +-----+------+                  |
|                                       | Explore    |                  |
|                                       | Test: 12K  |                  |
|                                       +------------+                  |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 5.2 Graph Node (Detail)

```
+---------------------------+
| [icon] Agent Name         |
|                           |
| Type: Explore             |
| Model: sonnet-4-6         |
| Tokens: 13K               |
| Duration: 3m 12s          |
| Tools: 8 calls            |
| [Status badge]            |
+---------------------------+
```

- Node size proportional to token usage
- Node color by agent type
- Edge thickness proportional to context size transferred

---

## 6. Page: Artifact Explorer

### 6.1 Wireframe

```
+-----------------------------------------------------------------------+
| ARTIFACTS                        [Filter: All v] [Search...] [?]     |
+----+------------------------------------------------------------------+
|    |                                                                   |
| F  |  src/                                                             |
| I  |  +-- payment/                                                     |
| L  |  |   +-- PaymentService.ts        [Created] Impl Agent  | 4.2K  |
| E  |  |   +-- PaymentController.ts     [Created] Impl Agent  | 2.1K  |
| S  |  |   +-- PaymentGateway.ts        [Modified] Review     | 3.8K  |
|    |  +-- api/                                                         |
| T  |  |   +-- routes.ts               [Modified] Impl Agent  | 1.5K  |
| R  |  +-- test/                                                        |
| E  |  |   +-- payment.test.ts         [Created] Impl Agent  | 3.8K  |
| E  |  +-- docs/                                                        |
|    |      +-- api.md                  [Created] Docs Agent   | 1.2K  |
|    |                                                                   |
+----+------------------------------------------------------------------+
|                                                                        |
| ARTIFACT DETAIL: src/payment/PaymentService.ts                        |
+-----------------------------------------------------------------------+
| Created by: Impl Agent (10:35:00)                                     |
| Modified by: Review Agent (11:15:00)                                  |
| Read by: Explore Agent (10:05:00), Review Agent (11:10:00)           |
+-----------------------------------------------------------------------+
| +--- Content (syntax highlighted) --------------------------------+   |
| | 1  import { Gateway } from './PaymentGateway';                  |   |
| | 2                                                                |   |
| | 3  export class PaymentService {                                |   |
| | 4    private gateway: Gateway;                                  |   |
| | 5                                                                |   |
| | 6    constructor(gateway: Gateway) {                            |   |
| | 7      this.gateway = gateway;                                  |   |
| | 8    }                                                           |   |
| | 9                                                                |   |
| | 10   async processPayment(amount: number) {                    |   |
| | ...                                                              |   |
| +------------------------------------------------------------------+   |
+-----------------------------------------------------------------------+
```

---

## 7. Page: Context Flow View

### 7.1 Wireframe

```
+-----------------------------------------------------------------------+
| CONTEXT FLOW                              [Agent: All v] [?]         |
+-----------------------------------------------------------------------+
|                                                                        |
|            +-------------------+                                       |
|            | Orchestrator      |                                       |
|            | Sent: 342 tok     |                                       |
|            | Recv: 1,205 tok   |                                       |
|            +---------+---------+                                       |
|                      |                                                 |
|          +-----------+-----------+                                     |
|          |                       |                                     |
|    +-----v-------+       +------v------+                               |
|    | Explore     |       | Plan        |                               |
|    | In: 342 tok |       | In: 856 tok |                               |
|    | Out: 1.2K   |       | Out: 2.1K   |                               |
|    +-------------+       +------+------+                               |
|                                 |                                      |
|                          +------+------+                               |
|                          |             |                               |
|                    +-----v---+   +-----v---+                           |
|                    | Explore |   | Explore |                           |
|                    | In: 521 |   | In: 412 |                           |
|                    | Out: 890|   | Out: 750|                           |
|                    +---------+   +---------+                           |
|                                                                        |
| Edge thickness = token volume                                          |
| Arrow direction = data flow                                            |
+-----------------------------------------------------------------------+
```

### 7.2 Context Inspector (in Pane)

```
+-----------------------------------------------------------------------+
| CONTEXT INSPECTOR: Explore Agent                                      |
+-----------------------------------------------------------------------+
|                                                                        |
| RECEIVED FROM PARENT (Orchestrator):                                  |
| +------------------------------------------------------------------+  |
| | Find all files that implement the payment flow.                  |  |
| | Search for PaymentService, PaymentController, and related        |  |
| | types. Report file paths and key function signatures.            |  |
| +------------------------------------------------------------------+  |
| Token count: 342 | Schema: none | Model override: sonnet-4-6        |
|                                                                        |
| RETURNED TO PARENT:                                                   |
| +------------------------------------------------------------------+  |
| | Found 5 files implementing the payment flow:                     |  |
| | 1. src/payment/PaymentService.ts - Core payment processing      |  |
| |    - processPayment(amount: number): Promise<PaymentResult>     |  |
| |    - refundPayment(id: string): Promise<RefundResult>           |  |
| | 2. src/api/PaymentController.ts - REST endpoints                |  |
| |    - POST /api/payments                                         |  |
| |    - GET /api/payments/:id                                      |  |
| | ...                                                              |  |
| +------------------------------------------------------------------+  |
| Token count: 1,205 | Duration: 3m 12s                               |
|                                                                        |
+-----------------------------------------------------------------------+
```

---

## 8. Page: Session Analytics

### 8.1 Wireframe

```
+-----------------------------------------------------------------------+
| SESSION ANALYTICS: Payment API Refactor                               |
+-----------------------------------------------------------------------+
|                                                                        |
|  +------------+  +------------+  +------------+  +------------+       |
|  | Duration   |  | Tokens     |  | Cost       |  | Parallelism|       |
|  | 2h 30m     |  | 1.25M      |  | $12.50     |  | 2.3x       |       |
|  +------------+  +------------+  +------------+  +------------+       |
|                                                                        |
|  TOKEN USAGE BY AGENT                                                  |
|  +------------------------------------------------------------------+ |
|  | Impl          [================================] 150K             | |
|  | Orchestrator  [================] 80K                              | |
|  | Review        [=========] 45K                                     | |
|  | Plan          [=====] 25K                                         | |
|  | Explore(1)    [===] 13K                                           | |
|  | Explore(2)    [==] 12K                                            | |
|  | ...                                                               | |
|  +------------------------------------------------------------------+ |
|                                                                        |
|  MODEL USAGE                     TOOL USAGE                           |
|  +-------------------+          +--------------------------+          |
|  |  [PIE CHART]      |          | Read        [====] 45   |          |
|  |  opus-4-6: 62%    |          | Bash        [===]  38   |          |
|  |  sonnet-4-6: 35%  |          | Write       [==]   22   |          |
|  |  haiku-4-5: 3%    |          | Grep        [==]   18   |          |
|  +-------------------+          | Edit        [=]    12   |          |
|                                  | Agent       [=]     8   |          |
|                                  +--------------------------+          |
|                                                                        |
|  DEBUGGING ALERTS                                                      |
|  +------------------------------------------------------------------+ |
|  | [!] High token agent: Impl used 150K tokens (3x median)         | |
|  | [i] Excessive Read calls: Orchestrator called Read 22 times      | |
|  | [i] Context size: Impl received 25K tokens of context            | |
|  +------------------------------------------------------------------+ |
|                                                                        |
+-----------------------------------------------------------------------+
```

---

## 9. Interaction Patterns

### 9.1 Drag and Drop Flow

```
1. User hovers over agent in sidebar
   -> Cursor changes to grab
   -> Agent row highlights

2. User starts dragging
   -> Semi-transparent ghost of agent name follows cursor
   -> All panes show drop zone overlays

3. User drags over a pane
   -> Drop zones appear:
      [Top 25%]    -> Split vertically, agent goes top
      [Bottom 25%] -> Split vertically, agent goes bottom
      [Left 25%]   -> Split horizontally, agent goes left
      [Right 25%]  -> Split horizontally, agent goes right
      [Center 50%] -> Add as tab in this pane

4. User drops on a zone
   -> Layout updates instantly
   -> Agent messages load in new pane
   -> Pane gets focus

5. User drops outside all panes
   -> Drop canceled, no change
```

### 9.2 Timeline Interaction Flow

```
1. User sees full timeline
2. User scrolls mouse wheel over timeline
   -> Zoom in/out centered on cursor position
3. User clicks and drags on timeline
   -> Pan left/right
4. User hovers over an agent bar
   -> Tooltip appears with agent summary
5. User clicks an agent bar
   -> Agent opens in the most recently focused workspace pane
   -> If no workspace pane exists, one is created
6. User Shift+clicks an agent bar
   -> Agent opens in a new pane (split from current)
```

### 9.3 Search Flow

```
1. User presses Ctrl+Shift+F (global search)
   -> Search bar appears at top of workspace
2. User types query
   -> Results appear grouped by agent (debounced 300ms)
   -> Each result shows: agent name, message excerpt, timestamp
   -> Match count per agent shown
3. User clicks a result
   -> Agent opens in focused pane (or navigates to existing pane with that agent)
   -> Scrolls to matching message
   -> Highlights match
4. User presses Enter
   -> Navigate to next match
5. User presses Escape
   -> Close search bar
```

---

## 10. Responsive Behavior

### 10.1 Breakpoints

| Width | Layout |
|-------|--------|
| > 1200px | Full workspace with sidebar |
| 768-1200px | Sidebar collapses to icons, panes stack vertically |
| < 768px | Single pane view with bottom navigation |

### 10.2 Mobile Adaptations

On screens < 768px:
- No split panes (single agent view)
- Agent list as bottom sheet
- Timeline as horizontal scroll
- Swipe between agents
- Tap to expand tool calls

---

## 11. Loading States

### 11.1 Session Loading

```
+-----------------------------------------------------------------------+
|                                                                        |
|                   Loading session...                                   |
|                                                                        |
|                   [====----------] 35%                                 |
|                                                                        |
|                   Parsing 23 agent conversations                       |
|                   Building agent hierarchy                             |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 11.2 Agent Message Loading

```
+--------------------------------------------+
| [Agent Name]                               |
+--------------------------------------------+
|                                            |
|   Loading messages...                      |
|   [skeleton line ~~~~~~~~~~~~~~~~]         |
|   [skeleton line ~~~~~~~~~~]               |
|   [skeleton line ~~~~~~~~~~~~~~~~~~~~]     |
|                                            |
+--------------------------------------------+
```

### 11.3 Empty States

```
+--------------------------------------------+
|                                            |
|   No sessions found                       |
|                                            |
|   Claude Code sessions will appear here    |
|   once you start using Claude Code.        |
|                                            |
|   Sessions are stored in:                  |
|   ~/.claude/projects/                      |
|                                            |
+--------------------------------------------+
```

---

## 12. Error States

### 12.1 Session Not Found

```
+--------------------------------------------+
|                                            |
|   Session not found                        |
|                                            |
|   The session "abc123" could not be        |
|   found in ~/.claude/projects/.            |
|                                            |
|   It may have been deleted by Claude       |
|   Code's 30-day retention policy.          |
|                                            |
|   [Back to Dashboard]                      |
|                                            |
+--------------------------------------------+
```

### 12.2 Agent Messages Unavailable

```
+--------------------------------------------+
| [Agent Name]                [unavailable]  |
+--------------------------------------------+
|                                            |
|   Agent conversation file missing          |
|                                            |
|   The JSONL file for this agent has been   |
|   deleted. Metadata is available from the  |
|   index but messages cannot be displayed.  |
|                                            |
|   Agent Type: Explore                      |
|   Tokens: 13K                              |
|   Duration: 3m 12s                         |
|                                            |
+--------------------------------------------+
```

---

## 13. Page: Home Dashboard

### 13.1 Wireframe

```
+-----------------------------------------------------------------------+
| AgentWatch                                     [?] [cog] |
+----+------------------------------------------------------------------+
|    |                                                                   |
| N  |  +-----------------------------------------------------------+   |
| A  |  | [Search sessions by ID, title, agent, artifact...]        |   |
| V  |  +-----------------------------------------------------------+   |
|    |                                                                   |
| +--+  PINNED SESSIONS                                    [Manage]     |
| |  |  +---------------------------+  +---------------------------+   |
| |F |  | Payment API Refactor      |  | Auth Migration            |   |
| |i |  | myproject | 23 agents     |  | auth-service | 45 agents  |   |
| |l |  | Last: 2h ago  | 1.2M tok  |  | Last: 1d ago  | 2.8M tok  |   |
| |t |  | [Resume] [Fresh] [Unpin]  |  | [Resume] [Fresh] [Unpin]  |   |
| |e |  +---------------------------+  +---------------------------+   |
| |r |                                                                   |
| |s |  RECENT SESSIONS                                                  |
| |  |  +---------------------------------------------------------------+
| |  |  | Bug Fix: Auth token expiry              Today 08:15           |
| |V |  | webapp | 3 agents | 85K tok | $0.85     [Open] [Pin] [Star] |
| |i |  +---------------------------------------------------------------+
| |e |  | Sprint Review: PR batch                 Today 07:30           |
| |w |  | monorepo | 12 agents | 450K tok         [Open] [Pin] [Star] |
| |: |  +---------------------------------------------------------------+
| |  |  | Migrate DB schema                       Yesterday 16:45       |
| |A |  | backend | 8 agents | 220K tok            [Open] [Pin] [Star] |
| |l |  +---------------------------------------------------------------+
| |l |                                                                   |
| |  |  OPEN BY SESSION ID                                               |
| |P |  +-----------------------------------------------------------+   |
| |i |  | [Paste session ID or path]                     [Open]      |   |
| |n |  +-----------------------------------------------------------+   |
| |n |                                                                   |
| |e |  +----------------------+  +----------------------------------+  |
| |d |  | TAGS                 |  | PROJECTS                         |  |
| |  |  | sprint-8 (4)         |  | myproject (15)                   |  |
| |F |  | code-review (7)      |  | webapp (8)                       |  |
| |a |  | migration (2)        |  | infra (5)                        |  |
| |v |  +----------------------+  +----------------------------------+  |
+----+------------------------------------------------------------------+
```

### 13.2 Filter Sidebar

```
+------------------------+
| FILTERS                |
|                        |
| View:                  |
|  (All) (Pinned) (Fav)  |
|                        |
| Tags:                  |
|  [ ] sprint-8     (4)  |
|  [ ] code-review  (7)  |
|  [ ] migration    (2)  |
|  [+] Add tag...        |
|                        |
| Projects:              |
|  [ ] myproject   (15)  |
|  [ ] webapp       (8)  |
|  [ ] infra        (5)  |
|                        |
| Date:                  |
|  (Today) (Week) (Month)|
|  [Custom range...]     |
|                        |
| Size:                  |
|  [ ] 10+ agents        |
|  [ ] Has workflows     |
|  [ ] 100K+ tokens      |
|                        |
+------------------------+
```

### 13.3 Session Card (Home Dashboard)

```
+-----------------------------------------------------------------------+
| [Pin] [Star]  Bug Fix: Auth token expiry             [edit title]     |
|                                                                        |
| webapp                                           Today 08:15          |
|                                                                        |
| +--------+  +--------+  +--------+  +--------+  +---------+          |
| | 3      |  | 85K    |  | 24     |  | 15m    |  | $0.85   |          |
| | agents |  | tokens |  | tools  |  | duration|  | cost    |          |
| +--------+  +--------+  +--------+  +--------+  +---------+          |
|                                                                        |
| Tags: [sprint-8] [debug]                           [+tag]            |
|                                                                        |
| [Open Workspace]  [View Timeline]  [View Artifacts]                   |
+-----------------------------------------------------------------------+
```

---

## 14. Agent Pane: Conversation Tab with Inline Artifact Cards

### 14.1 Inline Artifact Card (Collapsed)

```
+------------------------------------------------------------------+
| [assistant] 10:35:02                                              |
| I'll create the PaymentService implementation.                    |
|                                                                    |
| +--------------------------------------------------------------+ |
| | [file] src/payment/PaymentService.ts        [Created] 4.2 KB | |
| |                                        [Preview] [Open Pane] | |
| +--------------------------------------------------------------+ |
|                                                                    |
| Now I'll create the controller.                                   |
+------------------------------------------------------------------+
```

### 14.2 Inline Artifact Card (Preview Expanded)

```
+------------------------------------------------------------------+
| +--------------------------------------------------------------+ |
| | [file] src/payment/PaymentService.ts        [Created] 4.2 KB | |
| |                                                               | |
| | +----------------------------------------------------------+ | |
| | |  1  import { Gateway } from './PaymentGateway';           | | |
| | |  2                                                        | | |
| | |  3  export class PaymentService {                         | | |
| | |  4    private gateway: Gateway;                           | | |
| | |  5    constructor(gateway: Gateway) {                     | | |
| | |  6      this.gateway = gateway;                           | | |
| | |  7    }                                                   | | |
| | |  8    async processPayment(amount: number) {              | | |
| | |  9      return this.gateway.charge(amount);               | | |
| | | 10    }                                                   | | |
| | +----------------------------------------------------------+ | |
| |                                                               | |
| | [View Full] [Open in Pane] [Show Lineage]                    | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### 14.3 Edit Operation Card (Diff View)

```
+--------------------------------------------------------------+
| [file] src/api/routes.ts                          [Modified]  |
| Edit | +12 -3 lines                                          |
| +----------------------------------------------------------+ |
| |  - app.get('/api/payments', oldHandler);                  | |
| |  + app.get('/api/payments', newHandler);                  | |
| |  + app.post('/api/payments', createHandler);              | |
| |  + app.delete('/api/payments/:id', deleteHandler);        | |
| +----------------------------------------------------------+ |
| [Open in Pane] [Show Lineage]                                |
+--------------------------------------------------------------+
```

### 14.4 Artifact Lineage Strip (Expanded)

```
+--------------------------------------------------------------+
| LINEAGE: src/payment/PaymentService.ts                       |
|                                                                |
|  [Explore]---Read--->[Impl]---Write--->[Review]---Edit--->    |
|    10:05                10:35              11:15               |
|                                                                |
| Click any agent name to open it                               |
+--------------------------------------------------------------+
```

---

## 15. Agent Pane: Artifacts Tab

### 15.1 Wireframe

```
+------------------------------------------------------------------+
| [Conversation] [Artifacts 8] [Context] [Tools 42] [Summary]     |
+------------------------------------------------------------------+
| [Search...]  [Filter: All v]  [Sort: Time v]                    |
+------------------------------------------------------------------+
|                                                                    |
| PRODUCED (5 files)                                        [v]    |
|  src/payment/PaymentService.ts     [Created]  4.2K  10:35       |
|  src/api/PaymentController.ts      [Created]  2.1K  10:37       |
|  src/api/routes.ts                 [Modified] +12   10:40       |
|  test/payment.test.ts              [Created]  3.8K  10:42       |
|  test/payment.fixtures.ts          [Created]  1.1K  10:43       |
|                                                                    |
| CONSUMED (3 files)                                        [v]    |
|  src/payment/PaymentGateway.ts     [Read]     3.1K  10:34       |
|  src/types/payment.d.ts            [Read]     0.8K  10:34       |
|  docs/api-spec.yaml                [Read]     5.2K  10:35       |
|                                                                    |
+------------------------------------------------------------------+
| PREVIEW: src/payment/PaymentService.ts                           |
| Produced by: this agent (10:35)                                  |
| Consumed by: Review Agent (11:10)                                |
| Modified by: Review Agent (11:15) — [View Diff]                 |
| +--------------------------------------------------------------+ |
| | (syntax-highlighted content)                                  | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

---

## 16. Session Resume Dialog

### 16.1 With Existing Workspace

```
+-----------------------------------------------------------------------+
| Opening: Payment API Refactor                                         |
+-----------------------------------------------------------------------+
|                                                                        |
|  A previous workspace was found for this session.                     |
|  Last viewed: 2 hours ago                                             |
|                                                                        |
|  +-----------------------------------------------------------+       |
|  | [>>>] Resume Last Workspace                                |       |
|  |       3 panes: Orchestrator, Impl, Review                 |       |
|  |       Artifacts tab open on Impl                          |       |
|  +-----------------------------------------------------------+       |
|                                                                        |
|  Or start with a view:                                                |
|  [Timeline]  [Agent Explorer]  [Artifact Explorer]  [Fresh]          |
|                                                                        |
|  [ ] Always resume (skip this dialog)                                 |
+-----------------------------------------------------------------------+
```

### 16.2 First Time Opening

```
+-----------------------------------------------------------------------+
| Opening: Payment API Refactor                                         |
+-----------------------------------------------------------------------+
|                                                                        |
|  23 agents  |  1.2M tokens  |  8 artifacts  |  2h 30m                |
|                                                                        |
|  Choose a starting view:                                              |
|                                                                        |
|  [>>>] Agent Explorer (Recommended)                                   |
|        Orchestrator in main pane, sidebar open                       |
|                                                                        |
|  [Timeline]          [Artifact Explorer]         [Fresh Workspace]    |
|  See execution flow  Browse generated files      Empty workspace      |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 16.3 Named Layout Recall (Workspace Header)

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

## 17. Keyboard Shortcuts (Updated)

| Shortcut | Action |
|----------|--------|
| `Ctrl+\` | Toggle agent sidebar |
| `Ctrl+Shift+H` | Split pane horizontally |
| `Ctrl+Shift+V` | Split pane vertically |
| `Ctrl+W` | Close focused pane |
| `Ctrl+F` | Search in focused pane |
| `Ctrl+Shift+F` | Global search |
| `Ctrl+Tab` | Next tab in pane tab bar |
| `Ctrl+Shift+Tab` | Previous tab in pane tab bar |
| `Ctrl+1..5` | Switch to agent pane sub-tab (Conversation, Artifacts, Context, Tools, Summary) |
| `Ctrl+6..9` | Focus pane by index |
| `Ctrl+Shift+M` | Maximize/restore pane |
| `Ctrl+Shift+S` | Save current layout with name |
| `Escape` | Close search, close modal, close dialog |
| `T` | Toggle timeline view (when no text input focused) |
| `G` | Toggle agent graph view (when no text input focused) |
| `H` | Go to home dashboard (when no text input focused) |
