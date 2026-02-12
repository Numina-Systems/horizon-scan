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
