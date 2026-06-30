# AgentWatch — Product Overview

> **A plain-language explanation of what AgentWatch is, the problem it solves, how it works, how people use it, and the value it adds.**
> Written so that anyone — technical or not — can understand the product after a single read.

---

## The one-line story

**AgentWatch turns invisible, terminal-based AI workflows into something you can see, understand, give precise feedback on, and continuously improve.**

If AI agents today do work for us inside a black box, AgentWatch is the **glass box**.

---

## In 30 seconds

- Teams increasingly use **Claude** inside their software process — to generate test cases, review code, write documentation, and more.
- These tasks are no longer a single prompt. They're handled by **teams of specialized AI agents** working together.
- That work happens **inside a terminal**, which is great for *running* it but terrible for *understanding* it.
- When a result is wrong, people give **vague feedback** ("the test case is wrong, fix the skill") because they can't see *which* agent or *which* step actually caused the problem.
- Vague feedback applied to the wrong place slowly **degrades** the workflow over time.
- **AgentWatch** reads the data Claude already stores on your machine and presents it in a browser as a clear, navigable picture: who did what, in what order, using which information, and where things went wrong.
- That visibility unlocks **precise feedback → targeted improvement → self-healing workflows.**

---

## The problem

### AI is now a *team*, not a *tool*

A modern AI task like "generate test cases for this ticket" isn't one big prompt anymore. It's broken into a **pipeline of specialists**, because that produces better, more reliable results:

```
        Developer asks for test cases
                    │
            ┌───────▼────────┐
            │  Orchestrator  │   (the "manager" agent)
            └───────┬────────┘
        ┌───────────┼───────────┬───────────────┐
        ▼           ▼           ▼               ▼
   Task         Application   Test Data       Drafting
   Context        Context       Agent          Agent
   Agent          Agent                          │
                                                 ▼
                                          Factual-Check Agent
                                                 │
                                                 ▼
                                          Final Test Cases
```

Each agent handles one concern and hands its work to the next. This improves **accuracy, maintainability, and scale** — but it also means a single result is the product of *many hidden contributors*.

### The terminal hides the story

All of this runs as a wall of scrolling text: hundreds of messages, many agents, intermediate files, tool calls, and long reasoning chains.

The information **exists** — but it's nearly impossible to *consume*. Simple questions become hard:

- *Which agent made this decision?*
- *Which piece of information led to this output?*
- *Where did this mistake actually start?*
- *Which agent should we improve?*

### The deeper problem: feedback quality

Imagine the final test case is wrong. The natural reaction is *"give Claude feedback."* But the person reviewing only sees the **final result** — not which agent introduced the error.

So the feedback comes out **generic**:

> "The test case is wrong. Please improve the skill."

The manager agent then *guesses* where to apply the fix — and often guesses wrong. The real cause might have been the **Application Context Agent**, but the fix lands somewhere else.

Repeat this over weeks and you get **workflow drift** and **"skill poisoning"**: the workflow keeps changing based on inaccurate feedback, slowly getting worse instead of better.

> **The core idea: you cannot improve what you cannot see — and you cannot give good feedback on what you don't understand.**

---

## The insight

The fix isn't *better prompting*. It's **better visibility**.

Once you can observe a workflow properly, a natural ladder appears:

```
   Observability  →  Targeted Feedback  →  Continuous Improvement  →  Self-Healing
   (see it)          (fix the right spot)   (it gets better)          (it fixes itself)
```

AgentWatch is built to climb that ladder, one rung at a time.

---

## How it works

While exploring Claude Code, we found that **everything is already stored locally** on the machine, under a hidden `.claude` folder — every project, session, agent, message, artifact, and piece of metadata.

Nothing extra needs to be instrumented or logged. The raw truth is already there; it's just **unreadable in its raw form**.

So AgentWatch does one thing conceptually simple:

> **It reads what Claude already records and builds a clear, human-friendly layer on top of it.**

```
   .claude (raw local data)  →  AgentWatch (makes sense of it)  →  Your Browser
```

Because it reads the **actual recorded session**, AgentWatch always shows **what really happened at that point in time** — not a guess, and not today's version of the workflow. Historical runs stay faithful even after the underlying skills or agents are later edited.

### Integration with Claude Code

AgentWatch doesn't just *read* from Claude Code — it integrates with Claude Code's native features to provide a seamless browser-based experience:

- **Session resume** — improvement cycles resume the original Claude Code session (`--resume`), so the improvement agent has full context from the original run.
- **PreToolUse hooks** — AgentWatch configures an HTTP hook (`--settings`) that routes Edit/Write permission requests to the browser UI instead of the terminal.
- **Directory access** — cross-project skill directories are granted read access via `--add-dir`, so the improvement agent can read and edit skills wherever they're defined.
- **Stream protocol** — real-time progress is delivered via Claude Code's `stream-json` output format, displayed live in the browser.

This means the entire improvement workflow — from feedback to analysis to file edits to approval — happens in the browser. The terminal is only needed to *run* the original workflow; everything after that is handled by AgentWatch.

### Terminal vs Browser: How AgentWatch Handles Claude Code Permissions

#### How Claude Code normally works (terminal)

In a standard terminal session, Claude Code is interactive. When the AI decides it needs to edit a file, Claude Code pauses and shows a permission prompt:

```
Edit file: src/agents/test-data-analysis.md
Allow? (y/n)
```

The user reads the proposed change, types `y` or `n`, and Claude Code proceeds — applying the edit on approval or skipping it on denial. This works well because there is a human sitting at the terminal.

#### The problem: headless invocation

AgentWatch runs Claude Code programmatically — from a web server, not a terminal. It uses the `-p` (print) flag for non-interactive, headless execution. In this mode there is no terminal session, no human at a keyboard, and no way to display a permission prompt.

With `--permission-mode default`, Claude Code does the safe thing: it **auto-denies** any Edit or Write because no human is available to approve. This is correct behavior — but it means a web application that invokes Claude Code cannot get file edits applied without solving the approval problem.

#### AgentWatch's solution: native hooks, browser UI

Rather than bypassing Claude Code's permission system, AgentWatch plugs into it using Claude Code's official **PreToolUse hook** API. The hook intercepts a tool call *before* it executes and delegates the approval decision to an external system — in this case, the browser.

**How the flow works:**

1. AgentWatch writes a temporary settings file containing an HTTP hook configuration and passes it to Claude Code via `--settings`.
2. Claude Code runs and eventually attempts an Edit or Write.
3. The PreToolUse hook fires and sends an HTTP POST to AgentWatch's `/api/v2/hooks/permission` endpoint, containing the tool name, target file, and proposed change.
4. AgentWatch broadcasts the request to the browser over WebSocket.
5. The user sees an **approval card** with the file path, a diff preview, and Approve / Deny buttons.
6. The user's decision flows back: browser → WebSocket → hook endpoint → Claude Code.
7. Claude Code receives `allow` or `deny` and acts accordingly — applying the edit itself on approval.

| Aspect | Terminal | AgentWatch (Browser) |
|---|---|---|
| **Where the prompt appears** | Terminal (text) | Browser (visual card with diff) |
| **How the user responds** | Types `y` or `n` | Clicks Approve or Deny |
| **Who applies the edit** | Claude Code | Claude Code (same) |
| **Headless compatible** | No — auto-denies | Yes — hook routes to browser |
| **State consistency** | Always in sync | Always in sync (Claude Code applies natively) |
| **Cross-project edits** | Requires manual directory trust | Automatic via `--add-dir` detection |

#### Cross-project file access

Workflows often span projects — a session runs in one repository but uses skills or agents defined in another. AgentWatch parses the session data to detect external `.claude/skills` and `.claude/agents` paths, then passes them via Claude Code's `--add-dir` flag to grant read access. Write operations to those external files go through the same browser approval gate.

#### The key architectural point

AgentWatch does not bypass, replace, or reimplement Claude Code's permission system. It uses the **official hook API** to relocate the human-in-the-loop from the terminal to the browser. Claude Code still:

- Decides when a permission check is needed
- Sends the hook event
- Waits for the response
- Applies the edit itself after approval
- Maintains its own internal state

AgentWatch provides the approval surface. Claude Code remains the authority.

---

## What AgentWatch is

**A browser-based platform for understanding and improving Claude-powered, multi-agent workflows.**

It rests on four pillars:

| Pillar | What it means | Status |
|---|---|---|
| **Observability** | See every agent, decision, artifact, and tool call clearly | ✅ Available |
| **Feedback** | Attach precise notes to the exact agent/step that caused an issue | ✅ Available |
| **Continuous Improvement** | Turn that feedback into targeted, evidence-based fixes — and track them over time | ✅ Available |
| **Self-Healing** | Workflows that analyze their own runs and propose fixes automatically | 🔧 In Progress |

---

## What you can do with it

What you actually do in the app, and why each capability matters.

### Session Dashboard — *your runs become first-class*
Browse projects and the sessions inside them, instead of digging through terminal history. Each run is a real, openable thing with a title, size, cost, and timing. Pin, favorite, tag, and annotate sessions to organize your work.
**Value:** runs stop being throwaway terminal output and become a reviewable, searchable record.

### Agent Hierarchy — *see the team*
A sidebar shows the full **tree** of agents: the orchestrator at the top and every specialist beneath it, in the order they ran, each labeled with its **real identity** (its actual name/role), model, tokens, duration, and health.
**Value:** in seconds you understand *who did what and in what order* — the thing that's impossible in a terminal.

> You can also switch to a **Sequence** (chronological) view, and **export the hierarchy** as clean text, SVG, PNG, or structured JSON for documentation, emails, and reviews.

### Multi-Pane Workspace — *your investigation surface*
The workspace is a flexible, multi-pane environment. Open any agent, artifact, timeline, analytics view, or context graph in its own pane. Split horizontally or vertically and compare anything side by side. Your layout is automatically saved and restored as a **workspace snapshot**, so you can pick up exactly where you left off.
**Value:** instead of scrolling endlessly, you build a focused investigation layout tailored to what you need to understand.

### Agent Detail — *the full record of one agent*
Open any agent to see its **Conversation**, the **Artifacts** it produced, the **Context** it received, the **Tools** it used, a **Summary**, and a **Feedback** tab. Health is shown honestly — a clean success looks different from "finished, but with errors or blocked actions."
**Value:** you can trace a single agent's reasoning and outputs without losing the thread.

### Artifact Viewing — *intermediate work becomes visible*
The files agents create and pass between each other become **first-class, traceable items** rather than hidden intermediate outputs. Browse them in a folder structure, preview their content, and trace which agent produced each one.
**Value:** you can follow the chain — which artifact influenced which result.

### Cross-Agent Search — *find anything, anywhere*
Full-text search across every agent's messages in a session. Filter by agent, role, or content type to locate specific decisions, tool calls, or outputs.
**Value:** when you know *what* you're looking for but not *where*, search gets you there in seconds.

### Context Flow — *trace information between agents*
A visual graph showing how context flows between agents — which agent received information from which other agent, and what was passed along.
**Value:** when a downstream agent makes a bad decision, you can trace it back to the context it received.

### Execution Timeline — *see when things happened*
A dedicated timeline view showing agents as they executed over time, with artifact markers. See parallelism, gaps, and ordering at a glance.
**Value:** understand the *when* and *how long* alongside the *what* — spot bottlenecks and idle time.

### Analytics Dashboard — *evidence-based execution metrics*

The analytics page provides **computed facts** about every session:

- **Summary metrics** — total agents, tokens, cost, duration, models used, cache efficiency
- **Cost breakdown** — by model, by agent, and by phase
- **Critical path** — the longest chain of dependent agents that determined total duration
- **Debug alerts** — automatically detected issues: bottlenecks, retry loops, duplicate work, excessive tool usage, context bloat, long delegation chains
- **Agent report cards** — per-agent outcome assessment with token efficiency and error categorization

**Value:** you get an objective, quantitative view of what happened — not opinions, but evidence.

### AI Execution Analysis — *Claude analyzes the run*

Beyond algorithmic metrics, you can ask **Claude itself** to analyze a session. AgentWatch builds a rich prompt containing the full session structure, agent hierarchy, tool call timelines, artifacts, feedback, and skill definitions — then streams a live analysis powered by Claude.

The AI analysis covers:
- Root cause identification for failures
- Agent delegation quality assessment
- Workflow efficiency evaluation
- Actionable improvement recommendations with specific targets

Analysis runs stream live in the browser and are stored as **analysis cycles** for future reference.

**Value:** a second pair of (AI) eyes that can reason about the execution holistically and identify patterns a dashboard can't.

### Feedback — *the most important capability*
Feedback is attached to the **exact agent, the exact execution, and the exact artifact** that caused an issue — not to "the workflow" in general.

```
   Feedback  →  Specific Agent  →  Specific Execution  →  Specific Artifact
```

Ten structured categories keep feedback precise: missing context, incorrect assumption, hallucinated conclusion, weak validation, missing edge case, missing artifact, missing code exploration, missing test coverage, workflow improvement, and other.

**Value:** this is the fix for the core problem. Feedback becomes **specific and evidence-based**, so the right thing gets improved.

### Apply Improvements — *turn notes into a precise fix*
AgentWatch summarizes the collected feedback and generates an improvement prompt grounded in **agent-specific evidence**, not vague impressions. Claude then applies the fix in a live, streaming session — with an **edit approval gate** that lets you review and approve each file change directly in the browser before it lands.

The approval gate uses Claude Code's native **PreToolUse hook** system. When AgentWatch spawns an improvement cycle, it configures an HTTP hook that intercepts Edit and Write operations. Instead of prompting in the terminal, the permission request is routed to the AgentWatch browser UI — you see a diff preview, the target file, and Approve / Deny buttons. When you approve, Claude Code applies the edit itself, keeping its internal state perfectly in sync with the filesystem.

This means the improvement loop does **not depend on the terminal** for permission handling. Everything happens in the browser.

**Value:** the improvement targets the real cause, you stay in control of what gets changed, and you never need to switch to the terminal to approve edits.

### Cross-Project Skill Improvements — *fix skills wherever they live*
Real-world workflows often span multiple projects. A session might run in project A (e.g. your application repo) but use skills and agents defined in project B (e.g. a shared Claude config repo). AgentWatch handles this automatically:

1. **Detection** — When an improvement cycle starts, AgentWatch parses the session's JSONL to find every `.claude/skills` and `.claude/agents` path referenced during the run. Any path outside the session's own project directory is identified as external.
2. **Read access** — External directories are passed to Claude Code via the `--add-dir` flag, granting native read access without any extra approval prompts.
3. **Write access** — Edits to external files go through the same browser-based approval gate as local edits.

This means if the improvement agent determines that a skill definition in a *different* project caused the issue, it can read and propose edits to that file — and you approve or deny the change in the browser, just like any other edit.

**Value:** improvements land where the root cause actually lives, even when skills are maintained in a separate repository.

### Improvement History — *every change is traceable*
Each improvement cycle is recorded — the feedback behind it, the generated prompt, the streaming response, and the file diffs it produced. You can **rewind** an improvement if it didn't work out.
**Value:** you can see *how a workflow evolved over time*, why each change was made, and undo what didn't help.

### Session Comparison — *learn across runs*
Compare two sessions side by side — their agent hierarchies, metrics, and outcomes. See what changed between runs of the same workflow.
**Value:** when you improve a workflow and re-run it, you can directly compare the before and after.

### Skills Dashboard & Skill Intelligence — *learn across many runs*
Instead of improving one run at a time, AgentWatch aggregates feedback and trends across **many executions** of the same skill. See execution history, success rates, and recurring patterns.
**Value:** you stop fixing single executions and start improving the **workflow itself**.

### Self-Healing *(in progress)* — *workflows that improve themselves*
The planned direction: after a number of runs, a skill **analyzes its own history**, produces an improvement report and a suggested fix, you **review**, and **apply**. The UI foundation is built — skill dashboards, execution history tracking, analysis cycle management, and configuration for automation modes — but the end-to-end self-healing loop is not yet complete.

```
   Skill  →  N Executions  →  Automatic Analysis  →  Improvement Report
        →  Generated Fix  →  Human Review  →  Apply
```

| Mode | Behavior |
|---|---|
| **Analysis only** | Produces the report and recommendations — you decide what to do |
| **Analysis and fix** | Generates the fix — you review and approve before it lands |
| **Fully automatic** | Analyzes, generates, and applies the fix — you review after the fact |

**Value:** AgentWatch graduates from an *observability* tool to a **workflow-evolution platform**.

### Multi-Source Support — *WSL, Windows, and beyond*
AgentWatch can read Claude data from **multiple sources** on the same machine — for example, a native Windows `.claude` folder and a WSL Linux `.claude` folder. Switch between sources from the home page.
**Value:** if you use Claude across environments, you see all your work in one place.

### Export — *take insights with you*
Export session data as **JSON**, **Markdown**, or **HTML**. Export the agent hierarchy as **text**, **SVG**, **PNG**, or **JSON**. Copy the analytics summary as structured text for pasting into improvement prompts or reports.
**Value:** insights are portable — share them in emails, documents, pull requests, and team discussions.

---

## A typical user journey

```
1. Run a Claude workflow as usual (e.g. "generate test cases").
        ↓
2. Open AgentWatch in the browser → pick the project → open the session.
        ↓
3. Read the agent hierarchy: see the orchestrator and every specialist agent.
        ↓
4. Check the analytics dashboard for an objective execution summary:
   cost, timing, cache efficiency, and any detected issues.
        ↓
5. Notice a problem (e.g. a wrong test case). Trace it:
   open agents in side-by-side panes, follow context flow,
   search across messages, and find the agent that introduced the issue.
        ↓
6. Leave precise feedback on THAT agent / artifact — not on "the skill."
        ↓
7. Apply Improvements: AgentWatch turns the feedback into a targeted,
   evidence-based fix prompt. Review and approve each change.
        ↓
8. Re-run the workflow and compare sessions to verify the improvement.
        ↓
9. Over many runs, watch trends in the Skills Dashboard.
   Enable self-healing to let the workflow analyze and improve itself.
```

**Before AgentWatch:** scroll the terminal → guess the cause → give vague feedback → workflow drifts.
**With AgentWatch:** see the run → locate the real cause → give precise feedback → workflow improves.

---

## Who it helps

| Audience | What they get |
|---|---|
| **Developers / engineers** | Stop scrolling terminals; pinpoint and fix the real cause fast |
| **Reviewers / QA** | Trace outputs to their source; give feedback that actually lands |
| **Team leads** | See how workflows evolve; trust that improvements are evidence-based |
| **The organization** | Reliable, continuously-improving AI workflows instead of silent drift |

---

## Why it matters

As more work is delegated to AI agents, workflows become **increasingly autonomous**. The more autonomous they are, the more **observability becomes mandatory** — because *you cannot improve what you cannot observe.*

AgentWatch provides the full progression for Claude-based workflows:

> We started with a simple question — *how do we observe multi-agent workflows?*
> That led to **feedback**.
> Feedback led to **continuous improvement**.
> And continuous improvement leads toward **self-healing AI systems**.

---

## Mini-glossary

| Term | Plain meaning |
|---|---|
| **Agent** | An AI worker assigned to one specific part of a task |
| **Orchestrator** | The "manager" agent that coordinates the others |
| **Multi-agent workflow** | A task done by a team of cooperating AI agents |
| **Session** | One complete run of a workflow |
| **Artifact** | A file or output one agent produces and passes to the next |
| **Skill** | A reusable, packaged workflow (e.g. "generate test cases") |
| **Observability** | Being able to see and understand what happened inside a run |
| **Execution analysis** | AI-powered deep analysis of a session's execution |
| **Execution facts** | Algorithmically computed metrics about a session (cost, timing, errors) |
| **Workflow drift / skill poisoning** | A workflow slowly getting worse because of vague, misdirected feedback |
| **Self-healing** | A workflow that reviews its own runs and proposes its own fixes |
| **Edit approval gate** | A browser-based review step — powered by Claude Code's PreToolUse hook — where you approve or deny each file change before it's applied |
| **PreToolUse hook** | A Claude Code hook that fires before a tool executes; AgentWatch uses an HTTP hook to route Edit/Write permission requests to the browser |
| **Cross-project skills** | Skills or agents defined in a different project than the one the session ran in; AgentWatch detects and grants access to these automatically |

---

*AgentWatch — see your AI workflows, fix the right thing, and let them get better over time.*
