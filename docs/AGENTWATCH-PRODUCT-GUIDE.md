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
- That visibility unlocks **precise feedback → targeted improvement → (eventually) self-healing workflows.**

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

---

## What AgentWatch is

**A browser-based platform for understanding and improving Claude-powered, multi-agent workflows.**

It rests on four pillars:

| Pillar | What it means | Status |
|---|---|---|
| **Observability** | See every agent, decision, artifact, and tool call clearly | ✅ Available |
| **Feedback** | Attach precise notes to the exact agent/step that caused an issue | ✅ Available |
| **Continuous Improvement** | Turn that feedback into targeted, evidence-based fixes — and track them over time | ✅ Available |
| **Self-Healing** | Workflows that analyze their own runs and propose fixes automatically | 🔭 Planned |

---

## What you can do with it

What you actually do in the app, and why each capability matters.

### Session Dashboard — *your runs become first-class*
Browse projects and the sessions inside them, instead of digging through terminal history. Each run is a real, openable thing with a title, size, cost, and timing.
**Value:** runs stop being throwaway terminal output and become a reviewable record.

### Agent Hierarchy — *see the team*
A sidebar shows the full **tree** of agents: the orchestrator at the top and every specialist beneath it, in the order they ran, each labeled with its **real identity** (its actual name/role), model, tokens, duration, and health.
**Value:** in seconds you understand *who did what and in what order* — the thing that's impossible in a terminal.

> You can also switch to a **Sequence** (chronological) view, and **export the hierarchy** as clean text or an image for documentation, emails, and reviews.

### Multi-Pane View — *compare side by side*
Drag any agent into a split pane and view several agents at once on a single screen.
**Value:** instead of scrolling endlessly, you can compare two agents' work directly.

### Agent Detail — *the full record of one agent*
Open any agent to see its **Conversation**, the **Artifacts** it produced, the **Context** it received, the **Tools** it used, a **Summary**, and a **Feedback** tab. Health is shown honestly — a clean success looks different from "finished, but with errors or blocked actions."
**Value:** you can trace a single agent's reasoning and outputs without losing the thread.

### Artifact Viewing — *intermediate work becomes visible*
The files agents create and pass between each other become **first-class, traceable items** rather than hidden intermediate outputs.
**Value:** you can follow the chain — which artifact influenced which result.

### Feedback — *the most important capability*
Feedback is attached to the **exact agent, the exact execution, and the exact artifact** that caused an issue — not to "the workflow" in general.

```
   Feedback  →  Specific Agent  →  Specific Execution  →  Specific Artifact
```

**Value:** this is the fix for the core problem. Feedback becomes **specific and evidence-based**, so the right thing gets improved.

### Apply Improvements — *turn notes into a precise fix*
AgentWatch summarizes the collected feedback and generates an improvement prompt grounded in **agent-specific evidence**, not vague impressions.
**Value:** the improvement targets the real cause, so the workflow actually gets better.

### Improvement History — *every change is traceable*
Each improvement cycle is recorded — the feedback behind it, the generated prompt, and the response.
**Value:** you can see *how a workflow evolved over time*, and why.

### Skills Dashboard & Skill Intelligence — *learn across many runs*
Instead of improving one run at a time, AgentWatch aggregates feedback and trends across **many executions** of the same skill.
**Value:** you stop fixing single executions and start improving the **workflow itself**.

### Self-Healing *(planned)* — *workflows that improve themselves*
The future direction: after a number of runs, a skill **analyzes its own history**, produces an improvement report and a suggested fix, you **review**, and **apply**.

```
   Skill  →  N Executions  →  Automatic Analysis  →  Improvement Report
        →  Generated Fix Prompt  →  Human Review  →  Apply
```

**Value:** AgentWatch graduates from an *observability* tool to a **workflow-evolution platform**.

---

## A typical user journey

```
1. Run a Claude workflow as usual (e.g. "generate test cases").
        ↓
2. Open AgentWatch in the browser → pick the project → open the session.
        ↓
3. Read the agent hierarchy: see the orchestrator and every specialist agent.
        ↓
4. Notice the final output has a problem (e.g. a wrong test case).
        ↓
5. Trace it: open agents/artifacts, compare side-by-side, find the agent that
   introduced the issue (e.g. the Application Context Agent).
        ↓
6. Leave precise feedback on THAT agent / artifact — not on "the skill."
        ↓
7. Apply Improvements: AgentWatch turns the feedback into a targeted,
   evidence-based fix prompt.
        ↓
8. Track it in Improvement History; over many runs, watch trends in the
   Skills Dashboard and improve the workflow itself.
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
| **Workflow drift / skill poisoning** | A workflow slowly getting worse because of vague, misdirected feedback |
| **Self-healing** | A workflow that reviews its own runs and proposes its own fixes |

---

*AgentWatch — see your AI workflows, fix the right thing, and let them get better over time.*
