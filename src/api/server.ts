// pattern: Imperative Shell
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { ServerResponse } from "node:http";
import { appRouter } from "./router";
import type { AppContext } from "./context";
import type { AppConfig } from "../config/schema";

/**
 * Validates an Authorization header against the configured API key.
 *
 * Uses SHA-256 hashing before timingSafeEqual to eliminate the
 * length-mismatch timing oracle (F3). Both values are hashed to
 * fixed 32-byte digests, then compared in constant time.
 *
 * Returns the principal ({ id: "api-key-holder", role: "admin" }) if valid — this
 * principal represents the single authorized role (R2). Returns
 * undefined otherwise (no valid key → no authorization).
 */
export function resolvePrincipal(
  authHeader: string | undefined,
  expectedKey: string | undefined,
): { id: string; role: "admin" } | undefined {
  // Dev mode — no key configured, no enforcement
  if (!expectedKey) {
    return undefined;
  }

  // RC-6: case-insensitive Bearer prefix matching
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }

  const token = authHeader.slice("bearer ".length);
  if (!token) {
    return undefined;
  }

  // F3: Hash both values to fixed 32-byte SHA-256 digests before
  // timingSafeEqual. This eliminates the length-mismatch oracle that
  // occurs when comparing raw Buffers of different lengths.
  const tokenHash = createHash("sha256").update(token).digest();
  const expectedHash = createHash("sha256").update(expectedKey).digest();

  try {
    if (timingSafeEqual(tokenHash, expectedHash)) {
      return { id: "api-key-holder", role: "admin" };
    }
  } catch {
    // Should never happen with fixed-length SHA-256 digests, but
    // defensively return undefined on any comparison error.
  }

  return undefined;
}

/**
 * Resolves the bind host for the API server (R1, F1).
 *
 * Resolution order:
 *   1. BIND_HOST env var (if set) — highest priority, used by Docker.
 *      Whitespace is trimmed (RC-3).
 *   2. api.bindHost from config (if set) — explicit deployment override.
 *   3. Default: "127.0.0.1" (loopback — AC.A.5). The service is only
 *      reachable from the local machine unless explicitly configured otherwise.
 *
 * Docker: docker-compose.yml sets BIND_HOST=0.0.0.0 explicitly so the
 * container's port mapping works. The application default remains 127.0.0.1.
 */
export function resolveBindHost(config: AppConfig): string {
  // RC-3: trim env var to handle whitespace edge cases
  const envHost = process.env["BIND_HOST"]?.trim();
  const configHost = config.api?.bindHost?.trim();
  return envHost || configHost || "127.0.0.1";
}

/**
 * Creates and configures an Express server with tRPC middleware.
 * The tRPC router is mounted at `/api/trpc` with the provided context.
 * A simple `/health` endpoint is included for container health checks.
 *
 * @param context - The application context containing db, config, and logger
 * @param authKey - Optional API key for authentication (F2). When set, mutations
 *   and administrative operations require a valid Authorization: Bearer header.
 * @returns Configured Express app instance (not started — caller decides port)
 */
export function createApiServer(
  context: AppContext,
  authKey?: string,
): express.Express {
  const app = express();

  // F10: Response interceptor — adds WWW-Authenticate header on 401 responses.
  // Must be mounted BEFORE the tRPC adapter so it wraps the response object
  // that tRPC will later write to. The tRPC Express adapter sends headers via
  // writeHead before calling end, so we intercept writeHead to inject the header
  // at the point where headers are about to be flushed. We also intercept end
  // as a fallback for responses that bypass writeHead.
  app.use((req, res: ServerResponse, next) => {
    const originalWriteHead = res.writeHead.bind(res);
    const originalEnd = res.end.bind(res);

    function addAuthHeaderIfNeeded() {
      if (res.statusCode === 401 && !res.headersSent) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="horizon-scan-api"');
      }
    }

    res.writeHead = function (...args: unknown[]) {
      addAuthHeaderIfNeeded();
      return (originalWriteHead as unknown as (...args: unknown[]) => ServerResponse)(
        ...args,
      );
    };

    res.end = function (
      chunk?: unknown,
      encoding?: unknown,
      callback?: unknown,
    ) {
      addAuthHeaderIfNeeded();
      return (
        originalEnd as unknown as (...args: unknown[]) => ServerResponse
      )(chunk, encoding, callback);
    };
    next();
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: ({ req }): AppContext => {
        const principal = resolvePrincipal(
          req.headers.authorization,
          authKey,
        );
        return { ...context, authKey, principal };
      },
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
