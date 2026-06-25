# AgentWatch

A self-hosted web application for visualizing and debugging Claude Code multi-agent sessions. AgentWatch reads your local Claude session files and gives you an interactive workspace to understand what happened across all agents, tool calls, and artifacts in a session.

---

## What problem does it solve?

When you run a complex Claude Code session — one that spawns multiple subagents, runs workflows, generates files, and makes hundreds of tool calls — the only way to review it is scrolling through terminal output or raw JSONL files. There is no visual way to:

- See which agents ran, in what order, and how long each took
- Read one agent's conversation without losing track of the others
- Compare what two agents produced side by side
- Find which agent wrote a specific file
- Understand the relationship between the orchestrator and its subagents

AgentWatch solves this by turning your raw session data into a navigable, multi-pane workspace.

---

## What it looks like

The UI has three areas:

**Left sidebar** — lists all agents in the session, grouped by orchestration round. Each round is collapsible and shows the agents that were spawned in that exchange. Click any agent to open it in a pane.

**Main workspace** — one or more resizable panes, each showing a different agent. You can split horizontally or vertically to compare agents side by side. Each pane has five tabs:

| Tab | Shows |
|-----|-------|
| Conversation | The full message thread, grouped into rounds. Rounds that spawned agents get a colored banner. Write/Edit tool calls show inline artifact cards. |
| Artifacts | Files created or modified by this agent |
| Context | The prompt this agent received from its parent |
| Tools | Every tool call this agent made, grouped by tool name |
| Summary | Token usage, duration, model, status |

**Artifact viewer** — clicking "Open in pane" on any artifact opens a document viewer in a new pane, with a markdown Preview mode and a line-numbered Source mode.

**Feedback Review panel** — a side panel for collecting feedback on agent behavior and applying improvements:

| Feature | Description |
|---------|-------------|
| Feedback collection | Add categorized notes per agent (10 categories: Missing Context, Incorrect Assumption, etc.) |
| Apply improvements | Generates a prompt from your feedback, sends it to Claude via structured streaming |
| Live activity log | Watch Claude's thinking, tool calls, and responses in real time as a collapsible tree |
| Edit approval gate | Claude proposes file edits; you see the diff and approve or deny each one |
| Files touched | See which files were read, edited, or created during the cycle |
| Rewind | Roll back a cycle and re-apply with a refined prompt |

---

## How it works

Claude Code writes session data to `~/.claude/projects/` on your machine. Each session is a folder containing:

- A root `.jsonl` file — the orchestrator's conversation
- A `subagents/` subdirectory — one `.jsonl` file per named subagent (Agent/Task tool calls)
- A `subagents/workflows/` subdirectory — subagents spawned by Workflow tool calls
- A `workflows/` directory — workflow run data including agent labels

AgentWatch reads these files directly — no upload, no cloud, no account. It parses the JSONL format, correlates each subagent back to the root session, stores the indexed data in a local SQLite database, and serves it through a Next.js API.

Sessions are only indexed when you open them. Subsequent opens are instant (served from SQLite) unless the source file has changed.

---

## Getting started

There are two ways to run AgentWatch: directly with Node.js (fastest for development), or via Docker (no Node.js required on your machine).

---

### Option 1 — Node.js (recommended for development)

**Prerequisites:** Node.js 20+ and npm.

```bash
# Install dependencies
# The postinstall hook automatically compiles the native SQLite module
npm install

# Start on http://localhost:3456
npm run dev
```

If you update Node.js or switch versions with a version manager and see a 500 error on load, run:

```bash
npm run rebuild-native
```

---

### Option 2 — Docker

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS, Windows, Linux).

**Step 1 — Configure the Claude data path**

Create a `.env` file next to `docker-compose.yml`. This tells Docker where your Claude sessions live on your machine.

**macOS / Linux** — the default works, no `.env` needed. Your `~/.claude` directory is mounted automatically.

**Windows** — create `.env` with your actual username:

```env
CLAUDE_HOME=C:/Users/YourName/.claude
```

**Step 2 — Build and start**

```bash
docker compose up --build
```

The first build takes a few minutes (compiles the native SQLite module inside the container). Subsequent starts are instant.

Open [http://localhost:3456](http://localhost:3456).

**Stop the container:**

```bash
docker compose down
```

**Upgrade to a new version:**

```bash
docker compose down
docker compose up --build
```

**Change the port** — add to your `.env` file:

```env
PORT=8080
```

---

### What happens on first open

The home page auto-discovers all Claude sessions from your `~/.claude/projects/` directory and lists them sorted by most recent. Click any session to open it. The first open of a session parses and indexes it — subsequent opens are served from the local SQLite cache instantly.

---

