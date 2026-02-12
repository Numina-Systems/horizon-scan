# Horizon Scan Implementation Plan — Phase 8: Containerisation

**Goal:** Multi-stage Dockerfile for production deployment, `.dockerignore` for build context, and `docker-compose.yml` for local development with volume mounts for config and SQLite data.

**Architecture:** Three-stage Docker build: Stage 1 installs all dependencies and compiles TypeScript; Stage 2 does a clean `npm ci --omit=dev` with build tools to get production-only `node_modules` (including compiled better-sqlite3 native module); Stage 3 copies compiled output and production `node_modules` into a slim Alpine image without build tools. SQLite data persists via volume mount. Config file mounted at runtime. Environment variables provide secrets.

**Tech Stack:** Docker (multi-stage build), node:22-alpine, docker-compose

**Scope:** 8 phases from original design (phases 1-8). This is phase 8.

**Codebase verified:** 2026-02-12 — Greenfield project. Phase 1 defines: `tsconfig.json` with `outDir: "./dist"`, `rootDir: "./src"`, CommonJS module; `package.json` with `"build": "tsc"`, `"start": "node dist/index.js"`; `.gitignore` covers `node_modules/`, `dist/`, `*.db`, `data/`, `.env`. Phase 7 defines the entry point at `src/index.ts`. Database path defaults to `./data/horizon-scan.db` (configurable via `DATABASE_URL` env var). Config path defaults to `./config.yaml` (configurable via `CONFIG_PATH` env var). better-sqlite3 requires native C++ compilation.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### horizon-scan.AC6: Deployment and operations
- **horizon-scan.AC6.3 Success:** `docker build` produces a working OCI image
- **horizon-scan.AC6.4 Success:** Container runs with mounted config file and SQLite data volume, service operates correctly

---

<!-- START_TASK_1 -->
### Task 1: Dockerfile

**Files:**
- Create: `Dockerfile`

Three-stage build targeting Node.js 22 Alpine. Stage 1 installs all dependencies (including devDependencies) and compiles TypeScript. Stage 2 does a clean production-only install with build tools so better-sqlite3 compiles its native module. Stage 3 copies the compiled JS and production `node_modules` into a minimal runtime image without build tools.

**Implementation:**

```dockerfile
# Stage 1: Build TypeScript
FROM node:22-alpine AS builder

# better-sqlite3 requires build tools for native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY drizzle/ ./drizzle/

RUN npm run build

# Stage 2: Production dependencies only (with build tools for native modules)
FROM node:22-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 3: Runtime (no build tools)
FROM node:22-alpine

# better-sqlite3 native module needs libstdc++ at runtime
RUN apk add --no-cache libstdc++

WORKDIR /app

# Copy production-only node_modules (with pre-compiled native modules)
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist

# Copy drizzle migrations (applied at startup)
COPY --from=builder /app/drizzle ./drizzle

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=/app/data/horizon-scan.db
ENV CONFIG_PATH=/app/config.yaml

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

Key behaviours:
- Three stages: build (compile TS) → deps (production `node_modules` with native modules) → runtime (no build tools)
- `python3 make g++` in builder and deps stages for better-sqlite3 native compilation
- `libstdc++` in runtime stage for better-sqlite3 shared library dependency
- Production `node_modules` copied from deps stage — no `npm ci` in runtime stage avoids needing build tools
- Drizzle migrations copied to runtime so `migrate()` runs at startup
- `/app/data` directory created for SQLite volume mount point
- Config path set to `/app/config.yaml` — mounted at runtime
- Database path set to `/app/data/horizon-scan.db` — persisted via volume

**Verification:**

Run: `docker build -t horizon-scan .`
Expected: Build completes without errors.

**Commit:** `feat: add multi-stage dockerfile`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Docker ignore file

**Files:**
- Create: `.dockerignore`

Keeps the build context small and excludes sensitive/unnecessary files.

**Implementation:**

```
node_modules/
dist/
*.db
*.db-journal
*.db-wal
data/
.env
.git/
.gitignore
*.md
docs/
drizzle.config.ts
vitest.config.ts
src/**/*.test.ts
src/test-utils/
```

Key behaviours:
- `node_modules/` excluded — `npm ci` runs inside the container
- `dist/` excluded — TypeScript compiled inside the container
- Database files excluded — data persisted via volume mount
- `.env` excluded — secrets passed via `docker run -e` or compose `environment:`
- `.git/` excluded — not needed in container
- Test files and test utils excluded — not needed in production
- `drizzle.config.ts` excluded — only needed for drizzle-kit CLI, not runtime
- `docs/` excluded — documentation not needed in container

**Verification:**

Run: `docker build -t horizon-scan .`
Expected: Build context is small (no node_modules or data files sent to daemon).

**Commit:** `chore: add dockerignore`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Docker Compose for local development

**Files:**
- Create: `docker-compose.yml`

Convenience compose file for running the containerised service locally with volume mounts.

**Implementation:**

```yaml
services:
  horizon-scan:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - horizon-scan-data:/app/data
    environment:
      - DATABASE_URL=/app/data/horizon-scan.db
      - CONFIG_PATH=/app/config.yaml
      - PORT=3000
      - LOG_LEVEL=info
      # LLM provider keys — uncomment and set as needed:
      # - ANTHROPIC_API_KEY=
      # - OPENAI_API_KEY=
      # - GEMINI_API_KEY=
      # - ZAI_API_KEY=
      # - OLLAMA_BASE_URL=http://host.docker.internal:11434
      # - LMSTUDIO_BASE_URL=http://host.docker.internal:1234/v1
      # Email delivery:
      # - MAILGUN_API_KEY=
      # - MAILGUN_DOMAIN=
    restart: unless-stopped

volumes:
  horizon-scan-data:
```

Key behaviours:
- Config file bind-mounted read-only (`:ro`) — not baked into image
- Named volume `horizon-scan-data` for SQLite persistence across container restarts
- Port 3000 exposed for tRPC API
- Ollama/LM Studio URLs use `host.docker.internal` to reach host-running services
- `restart: unless-stopped` for resilience
- All secrets via environment variables (not in compose file — user fills them in or uses `.env` file)

**Verification:**

Run: `docker compose build`
Expected: Image builds without errors.

Run: `docker compose up -d`
Expected: Container starts. Check with `docker compose logs horizon-scan` — should show startup logs.

Run: `curl http://localhost:3000/health`
Expected: `{"status":"ok"}`

Run: `docker compose down`
Expected: Container stops cleanly.

**Commit:** `feat: add docker-compose for local development`
<!-- END_TASK_3 -->
