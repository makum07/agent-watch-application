# Deployment Architecture

## AgentWatch v2.0

**Superseded:** Dockerfile and Docker Compose now use Next.js standalone output. See `09-NEXTJS-ARCHITECTURE.md` Section 8 for the updated Dockerfile, docker-compose.yml, and image size budget. The security hardening (Section 3), persistence strategy (Section 4), and platform-specific notes (Section 7) in this document remain current.

---

## 1. Deployment Overview

### 1.1 Target Environment

The application runs on any machine with Docker installed:

```
+-----------------------------------------------------------------------+
|  User's Machine                                                       |
|                                                                       |
|  +-------------------+     +------------------------------------+     |
|  | Claude Code CLI   |     | Docker Desktop                   |     |
|  | (generates data)  |     |                                    |     |
|  |                   |     |  +------------------------------+  |     |
|  | ~/.claude/        |---->|  | agentwatch      |  |     |
|  |   projects/       | RO  |  | container                    |  |     |
|  |     *.jsonl       |     |  |                              |  |     |
|  +-------------------+     |  | Node.js 20 + Express         |  |     |
|                            |  | SQLite + FTS5                |  |     |
|  +-------------------+     |  | Port: 3456                   |  |     |
|  | Web Browser       |     |  +------------------------------+  |     |
|  |                   |<--->|                                    |     |
|  | localhost:3456    |     |  +------------------------------+  |     |
|  +-------------------+     |  | agentwatch-data (volume)         |  |     |
|                            |  | conversations.db             |  |     |
|                            |  +------------------------------+  |     |
|                            +------------------------------------+     |
+-----------------------------------------------------------------------+
```

### 1.2 Installation Flow

```
Step 1: Receive source code
  $ unzip agentwatch-v2.0.zip
  $ cd agentwatch

Step 2: (Optional) Configure
  $ cp .env.example .env
  $ # Edit .env if needed (port, Claude home path)

Step 3: Start
  $ docker compose up -d

Step 4: Open browser
  $ open http://localhost:3456
```

### 1.3 System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Docker Engine | 20.10+ | 24.0+ |
| Docker Compose | V2 | V2 |
| RAM (available) | 2 GB | 4 GB |
| Disk (for container + DB) | 500 MB | 2 GB |
| CPU | 2 cores | 4 cores |
| OS | macOS 12+, Linux kernel 4.18+, Windows 10+ | macOS 14+, Linux 6.x, Windows 11 |

---

## 2. Container Architecture

### 2.1 Multi-Stage Dockerfile

```dockerfile
# ============================================================
# Stage 1: Build
# ============================================================
FROM node:20-alpine AS builder

ARG APP_UID=1000
ARG APP_GID=1000

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies (layer cached if package*.json unchanged)
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Copy source code
COPY . .

# Run tests (fail build if tests fail)
# RUN npm test  # Uncomment when CI is set up

# ============================================================
# Stage 2: Production Runtime
# ============================================================
FROM node:20-alpine

ARG APP_UID=1000
ARG APP_GID=1000

# Create non-root user
RUN addgroup -g ${APP_GID} appgroup && \
    adduser -u ${APP_UID} -G appgroup -s /bin/sh -D appuser

# Create data directory
RUN mkdir -p /data && chown appuser:appgroup /data

WORKDIR /app

# Copy only production artifacts
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/src ./src
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3456/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

EXPOSE 3456

CMD ["node", "src/server.js"]
```

### 2.2 Image Size Budget

| Layer | Size |
|-------|------|
| Alpine base | ~50 MB |
| Node.js 20 runtime | ~120 MB |
| Production node_modules | ~80 MB |
| Application source | ~2 MB |
| **Total** | **~252 MB** |

Build dependencies (python3, make, g++) are excluded from the final image.

### 2.3 Docker Compose Configuration

```yaml
# docker-compose.yml
version: '3.8'

services:
  agentwatch:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        APP_UID: ${APP_UID:-1000}
        APP_GID: ${APP_GID:-1000}
    container_name: agentwatch
    
    # Port mapping
    ports:
      - "${PORT:-3456}:3456"
    
    # Volume mounts
    volumes:
      # Claude session data (read-only)
      - "${CLAUDE_HOME:-~/.claude}:/home/appuser/.claude:ro"
      # Persistent database
      - "agentwatch-data:/data"
    
    # Environment
    environment:
      - NODE_ENV=production
      - CLAUDE_HOME=/home/appuser/.claude
      - CLAUDE_DB_PATH=/data/conversations.db
      - NODE_OPTIONS=--max-old-space-size=2048
      - LOG_LEVEL=${LOG_LEVEL:-info}
    
    # Security hardening
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:noexec,nosuid,size=128m
    
    # Resource limits
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 512M
    
    # Restart policy
    restart: unless-stopped

volumes:
  agentwatch-data:
    name: agentwatch-db
```

### 2.4 Environment Variables

```bash
# .env.example

# Server port (default: 3456)
PORT=3456

# Path to Claude Code data directory
# macOS/Linux: ~/.claude
# Windows (WSL): /mnt/c/Users/<username>/.claude
CLAUDE_HOME=~/.claude

# Log level: debug, info, warn, error
LOG_LEVEL=info

# Container user/group IDs (match host user for file permissions)
APP_UID=1000
APP_GID=1000
```

---

## 3. Security Hardening

### 3.1 Container Security

| Measure | Implementation | Purpose |
|---------|---------------|---------|
| Non-root user | `USER appuser` (UID 1000) | Prevent privilege escalation |
| Drop all capabilities | `cap_drop: ALL` | Minimize kernel surface |
| No new privileges | `security_opt: no-new-privileges` | Prevent setuid/setgid |
| Read-only filesystem | `read_only: true` | Prevent container modification |
| No-exec tmpfs | `tmpfs: /tmp:noexec` | Prevent execution from temp |
| Read-only source mount | `:ro` on Claude home | Prevent data modification |

### 3.2 Application Security

| Measure | Implementation |
|---------|---------------|
| Input validation | All API inputs validated and sanitized |
| SQL injection prevention | Parameterized queries only (better-sqlite3 prepared statements) |
| XSS prevention | Content sanitized before HTML rendering |
| Path traversal prevention | All file access validated against allowed directories |
| No external network | Container makes no outbound connections |
| No secrets | No API keys, tokens, or credentials required |

### 3.3 Network Security

- **Binding:** Server binds to `0.0.0.0:3456` inside container
- **Exposure:** Only `localhost:3456` on host (Docker port mapping)
- **No TLS:** Not needed for localhost-only access
- **WebSocket:** Same port, same origin policy enforced

---

## 4. Persistence Strategy

### 4.1 Data Storage

| Data | Location | Persistence | Recovery |
|------|----------|-------------|----------|
| SQLite database | `/data/conversations.db` (Docker volume) | Survives container restart and rebuild | Automatically rebuilt from JSONL files on startup |
| JSONL source files | `~/.claude/projects/` (host, read-only mount) | Managed by Claude Code | N/A (not modified by this application) |
| Application cache | In-memory (DataCache) | Lost on container restart | Rebuilt on demand |
| Workspace layouts | Browser localStorage | Per-browser, survives restart | Export/import feature (future) |

### 4.2 Database Migrations

```javascript
// Database version tracking
const SCHEMA_VERSION = 2;  // Increment on schema changes

class DatabaseMigrations {
  async migrate(db) {
    const currentVersion = this.getCurrentVersion(db);
    
    if (currentVersion < 1) {
      // v1: Original schema (conversations, conversation_fts, tool_usage, file_index)
      this.migrateToV1(db);
    }
    
    if (currentVersion < 2) {
      // v2: Agent graph, artifacts, timeline
      this.migrateToV2(db);
    }
    
    this.setVersion(db, SCHEMA_VERSION);
  }
  
  migrateToV2(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (...);
      CREATE TABLE IF NOT EXISTS artifacts (...);
      CREATE TABLE IF NOT EXISTS timeline_events (...);
      CREATE TABLE IF NOT EXISTS workflows (...);
      CREATE INDEX IF NOT EXISTS idx_agents_conversation ON agents(conversation_id);
      -- ... (all v2 schema additions)
    `);
  }
}
```

Migrations run automatically on startup. They are idempotent (`CREATE TABLE IF NOT EXISTS`).

### 4.3 Backup and Restore

**Backup:**
```bash
# Copy database from container
docker compose cp agentwatch:/data/conversations.db ./backup/

# Or snapshot the entire volume
docker run --rm \
  -v agentwatch-db:/source:ro \
  -v $(pwd)/backup:/backup \
  alpine cp /source/conversations.db /backup/conversations-$(date +%Y%m%d).db
```

**Restore:**
```bash
# Stop the container
docker compose down

# Copy database back
docker run --rm \
  -v agentwatch-db:/data \
  -v $(pwd)/backup:/backup \
  alpine cp /backup/conversations.db /data/

# Start the container
docker compose up -d
```

**Full Reset:**
```bash
# Stop and remove container + volume
docker compose down -v

# Rebuild and start (will re-index everything)
docker compose up --build -d
```

---

## 5. Upgrade Strategy

### 5.1 Standard Upgrade

```bash
# 1. Download new version
# (unzip or git pull)

# 2. Stop current version
docker compose down

# 3. Rebuild with new source
docker compose up --build -d

# Database migrations run automatically
# Existing indexed data is preserved
# Re-indexing only processes changed files
```

### 5.2 Breaking Upgrade (Schema Change)

If a new version requires a schema change that can't be migrated:

```bash
# 1. Stop current version
docker compose down

# 2. Remove database volume
docker volume rm agentwatch-db

# 3. Rebuild and start (full re-index)
docker compose up --build -d
```

Re-indexing 1000 conversations takes approximately 30-60 seconds.

### 5.3 Version Checking

The server exposes a version endpoint:

```
GET /api/health
{
  "status": "ok",
  "version": "2.0.0",
  "schemaVersion": 2,
  "uptime": 86400,
  "conversations": 47,
  "agents": 312
}
```

---

## 6. Monitoring

### 6.1 Health Check

Docker's built-in health check runs every 30 seconds:

```
$ docker inspect --format='{{.State.Health.Status}}' agentwatch
healthy
```

### 6.2 Metrics Endpoint

```
GET /api/system/metrics
{
  "memory": {
    "heapUsed": 125000000,
    "heapTotal": 200000000,
    "rss": 280000000
  },
  "uptime": 86400,
  "database": {
    "conversations": 47,
    "agents": 312,
    "artifacts": 156,
    "ftsEntries": 8500,
    "sizeBytes": 15000000
  },
  "cache": {
    "entries": 23,
    "hitRate": 0.85
  },
  "websocket": {
    "connections": 1
  }
}
```

### 6.3 Logging

```bash
# View container logs
docker compose logs -f agentwatch

# Log format:
# [2026-05-30T10:00:00Z] INFO  Server started on port 3456
# [2026-05-30T10:00:01Z] INFO  Indexed 47 conversations (312 agents)
# [2026-05-30T10:00:05Z] INFO  WebSocket connection from 127.0.0.1
```

Log levels: `debug`, `info`, `warn`, `error` (configured via `LOG_LEVEL` env var)

---

## 7. Platform-Specific Notes

### 7.1 macOS

```bash
# Standard Docker Desktop setup
docker compose up -d
open http://localhost:3456
```

Claude data is at `~/.claude/projects/`.

### 7.2 Linux

```bash
# May need to set UID/GID to match host user
export APP_UID=$(id -u)
export APP_GID=$(id -g)
docker compose up -d
```

Claude data is at `~/.claude/projects/`.

### 7.3 Windows

```bash
# Using Docker Desktop with WSL2 backend
# Claude data is at C:\Users\<username>\.claude

# In .env:
CLAUDE_HOME=/mnt/c/Users/<username>/.claude

docker compose up -d
```

Or using PowerShell:
```powershell
$env:CLAUDE_HOME = "C:\Users\$env:USERNAME\.claude"
docker compose up -d
```

### 7.4 Windows (Native Path Mounting)

```yaml
# docker-compose.override.yml for Windows
services:
  agentwatch:
    volumes:
      - "C:/Users/${USERNAME}/.claude:/home/appuser/.claude:ro"
      - "agentwatch-data:/data"
```

---

## 8. Troubleshooting

### 8.1 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Port 3456 in use | Another service on same port | Set `PORT=3457` in `.env` |
| Permission denied on ~/.claude | Container user can't read host files | Set `APP_UID` and `APP_GID` to match host user |
| Database locked | Multiple containers accessing same volume | Ensure only one container runs at a time |
| Container OOM killed | Session too large for memory limit | Increase memory limit in `docker-compose.yml` |
| No sessions found | Wrong CLAUDE_HOME path | Verify path contains `projects/` subdirectory with `.jsonl` files |
| Slow startup | Many conversations to index | Normal for first run; subsequent starts use cached index |

### 8.2 Debug Mode

```bash
# Run with debug logging
LOG_LEVEL=debug docker compose up

# Enter running container
docker compose exec agentwatch sh

# Check database
docker compose exec agentwatch \
  node -e "const db = require('better-sqlite3')('/data/conversations.db'); console.log(db.prepare('SELECT COUNT(*) as c FROM conversations').get())"
```
