# ============================================================
# Stage 1: Install dependencies
# python3/make/g++ are required to compile better-sqlite3
# ============================================================
FROM node:22-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci


# ============================================================
# Stage 2: Build Next.js
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build


# ============================================================
# Stage 3: Production runtime
# ============================================================
FROM node:22-alpine AS runner

# python3/make/g++ needed so better-sqlite3 can be rebuilt if
# the Node.js version in this image differs from the build stage
RUN apk add --no-cache python3 make g++

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 --ingroup nodejs appuser && \
    mkdir -p /data && chown appuser:nodejs /data

# Next.js build output
COPY --from=builder --chown=appuser:nodejs /app/.next          ./.next
COPY --from=builder --chown=appuser:nodejs /app/public         ./public

# Full node_modules (includes tsx needed to run server.ts, and
# native better-sqlite3 compiled for this Node.js version)
COPY --from=builder --chown=appuser:nodejs /app/node_modules   ./node_modules

# Source files the production server needs at runtime
COPY --from=builder --chown=appuser:nodejs /app/server.ts      ./server.ts
COPY --from=builder --chown=appuser:nodejs /app/tsconfig.json  ./tsconfig.json
COPY --from=builder --chown=appuser:nodejs /app/package.json   ./package.json
COPY --from=builder --chown=appuser:nodejs /app/lib            ./lib
COPY --from=builder --chown=appuser:nodejs /app/types          ./types

USER appuser

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3456
# CLAUDE_HOME is the path INSIDE the container where ~/.claude is mounted
ENV CLAUDE_HOME=/claude-data
# SQLite database path (persisted via Docker volume)
ENV CLAUDE_DB_PATH=/data/agentwatch.db

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3456/api/health',r=>process.exit(r.statusCode===200?0:1))" || exit 1

CMD ["node_modules/.bin/tsx", "server.ts"]
