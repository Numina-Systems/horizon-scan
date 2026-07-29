// pattern: Imperative Shell
import type { Logger } from "pino";
import type { Server } from "node:http";
import { setShuttingDown } from "./scheduler";

/**
 * Represents an object with a stop method for graceful shutdown.
 */
export type Stoppable = {
  readonly stop: () => void;
};

/**
 * Dependencies for the shutdown handler.
 */
export type ShutdownDeps = {
  readonly schedulers: ReadonlyArray<Stoppable>;
  readonly closeDb: () => void;
  readonly logger: Logger;
  /** HTTP server to close during shutdown. REQUIRED. */
  readonly httpServer: Server;
  /**
   * Returns a Promise that resolves when all active jobs finish.
   * REQUIRED. All production deployments have a scheduler to drain.
   */
  readonly drain: () => Promise<void>;
  /** Maximum milliseconds to wait for active jobs. Default: 30000. */
  readonly drainTimeoutMs?: number;
};

/**
 * Registers SIGTERM and SIGINT signal handlers for graceful shutdown.
 *
 * Shutdown phases:
 * 1. Stop all schedulers (stop admitting new work)
 * 2. Initiate HTTP server close (stop accepting new requests)
 * 3. Await active jobs drain + HTTP close, bounded by drainTimeoutMs
 * 4. Close the database connection
 * 5. Exit (0 on success, 1 on drain timeout)
 *
 * Returns the shutdown closure so tests can `await shutdown("SIGTERM")`
 * directly. Production code ignores the return value.
 */
export function registerShutdownHandlers(
  deps: ShutdownDeps,
): (signal: string) => Promise<void> {
  let shuttingDown = false;
  const drainTimeoutMs = deps.drainTimeoutMs ?? 30000;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    // Phase 0: Set shutdown admission gate BEFORE anything else.
    // This prevents in-flight HTTP requests from starting new poll cycles
    // after drain has already captured the active state.
    setShuttingDown();

    deps.logger.info({ signal }, "shutdown signal received");

    // Phase 1: Stop schedulers (stop admitting new work)
    for (const scheduler of deps.schedulers) {
      try {
        scheduler.stop();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger.error({ error: message }, "error stopping scheduler");
      }
    }
    deps.logger.info("schedulers stopped");

    // Phase 2: Initiate HTTP server close (stops accepting new requests).
    // httpServer.close() is NOT awaited separately — it can block
    // indefinitely on keep-alive connections. We initiate it here and
    // include it in the drain timeout race in Phase 3 so the overall
    // timeout bounds both HTTP close and job drain.
    const httpClosePromise = new Promise<void>((resolve, reject) => {
      deps.httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error({ error: message }, "error closing http server");
    });

    // Phase 3: Drain active jobs + wait for HTTP close, bounded by timeout.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error("drain timeout")),
        drainTimeoutMs,
      );
    });

    try {
      await Promise.race([
        Promise.all([httpClosePromise, deps.drain()]),
        timeoutPromise,
      ]);
      deps.logger.info("http server closed and active jobs drained");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.warn(
        { error: message, drainTimeoutMs },
        "drain timed out or failed — proceeding to forced shutdown",
      );

      // Phase 4 (timeout path): Close DB even after drain timeout
      try {
        deps.closeDb();
        deps.logger.info("database connection closed");
      } catch (dbErr) {
        const dbMessage =
          dbErr instanceof Error ? dbErr.message : String(dbErr);
        deps.logger.error(
          { error: dbMessage },
          "error closing database after drain timeout",
        );
      }

      deps.logger.info("shutdown complete (with drain timeout)");
      process.exit(1);
      return;
    } finally {
      // Always clear the timer to prevent leaks
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    // Phase 4 (success path): Close DB after successful drain
    try {
      deps.closeDb();
      deps.logger.info("database connection closed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error({ error: message }, "error closing database");
    }

    deps.logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  // Return shutdown so tests can call it directly and await the result.
  return shutdown;
}
