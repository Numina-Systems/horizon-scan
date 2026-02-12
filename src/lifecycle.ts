// pattern: Imperative Shell
import type { Logger } from "pino";

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
};

/**
 * Registers SIGTERM and SIGINT signal handlers for graceful shutdown.
 * Stops all schedulers, closes the database connection, then exits.
 *
 * - Guard against double-shutdown (re-entrant signal delivery)
 * - Stops all schedulers before closing DB (in-flight cron callbacks may need DB)
 * - Wraps each cleanup step in try/catch to ensure all steps run
 * - Logs each phase of shutdown for observability
 * - Calls `process.exit(0)` after cleanup
 */
export function registerShutdownHandlers(deps: ShutdownDeps): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    deps.logger.info({ signal }, "shutdown signal received");

    for (const scheduler of deps.schedulers) {
      try {
        scheduler.stop();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger.error({ error: message }, "error stopping scheduler");
      }
    }

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

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
