# AgentWatch

A self-hosted web application for visualizing and debugging Claude Code multi-agent sessions.

---

## Getting started

There are two ways to run AgentWatch: directly with Node.js, or via Docker. Both can coexist on the same machine — no configuration changes needed when switching between them.

**Clone the repository:**

```bash
git clone https://github.com/makum07/agent-watch-application.git
cd agent-watch-application
```

---

### Option 1 — Node.js

**Prerequisites:** Node.js 20+ and npm.

**Step 1 — Configure your Claude data path**

Copy the example file:

```bash
cp .env.local.example .env.local
```

Then edit `.env.local` and set `CLAUDE_HOME` to your Claude data directory:

```env
# macOS / Linux — default path, adjust if non-standard
CLAUDE_HOME=~/.claude

# Windows
CLAUDE_HOME=C:/Users/YourName/.claude
```

Everything else in `.env.local.example` is optional and commented out — defaults work for most setups.

**Step 2 — Install and start**

```bash
npm install
npm run dev:server
```

Open [http://localhost:3456](http://localhost:3456).

If you update Node.js or switch versions and see a 500 error on load, rebuild the native SQLite module:

```bash
npm run rebuild-native
```

---

### Option 2 — Docker

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS, Windows, Linux).

The `.env` file is used only by docker compose for volume path substitution. It uses compose-specific variable names (`COMPOSE_SOURCES`, `CLAUDE_HOME_WINDOWS`) that the app itself never reads, so it cannot interfere with a local Node.js dev server running at the same time.

---

#### macOS / Linux

Copy the example file:

```bash
cp .env.example .env
```

Then edit `.env` next to `docker-compose.yml` so it contains at least:

```env
COMPOSE_SOURCES=Home:/claude-data-wsl
PORT=3456
```

Your `~/.claude` directory is mounted automatically — `COMPOSE_SOURCES` just tells the app which mounted path to read from.

```bash
docker compose up --build -d
```

Open [http://localhost:3456](http://localhost:3456).

---

#### Windows (PowerShell)

Copy the example file:

```powershell
copy .env.example .env
```

Then edit `.env` next to `docker-compose.yml` so it contains at least:

```env
CLAUDE_HOME_WINDOWS=C:/Users/YourName/.claude
COMPOSE_SOURCES=Windows:/claude-data-windows
PORT=3456
```

Replace `YourName` with your actual Windows username. Forward slashes are required.

Then build and start:

```powershell
docker compose up --build -d
```

Open [http://localhost:3456](http://localhost:3456).

---

#### Windows + WSL2 (both sources)

To see sessions from both your WSL home and your Windows user in the same UI, run from a **WSL2 terminal** — the helper script auto-detects both paths:

```bash
bash start.sh
```

This sets `CLAUDE_HOME_WSL` and `CLAUDE_HOME_WINDOWS` automatically and starts the container with a source-switcher in the UI. Add `COMPOSE_SOURCES=WSL:/claude-data-wsl,Windows:/claude-data-windows` to `.env` to label each source.

---

#### Managing the container

**Stop:**

```bash
docker compose down
```

**Upgrade to a new version** — always use `--no-cache` so the build picks up the latest source changes:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

**Change the port** — add to your `.env` file:

```env
PORT=8080
```

**Reset the database** (clears the SQLite cache; sessions are re-indexed on next open):

```bash
docker compose down -v
```

---

### Switching between Node.js and Docker

You can run either mode without touching any config files:

| Mode | Command | Reads |
|------|---------|-------|
| Local dev | `npm run dev:server` | `.env.local` (CLAUDE_HOME) |
| Docker | `docker compose up -d` | `.env` (CLAUDE_HOME_WINDOWS, COMPOSE_SOURCES) |

The two config files use different variable names by design — there is no overlap.

---

### What happens on first open

The home page auto-discovers all Claude sessions from your `~/.claude/projects/` directory and lists them sorted by most recent. Click any session to open it. The first open of a session parses and indexes it — subsequent opens are served from the local SQLite cache instantly.

---

