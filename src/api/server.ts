// pattern: Imperative Shell
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./router";
import type { AppContext } from "./context";

/**
 * Creates and configures an Express server with tRPC middleware.
 * The tRPC router is mounted at `/api/trpc` with the provided context.
 * A simple `/health` endpoint is included for container health checks.
 *
 * @param context - The application context containing db, config, and logger
 * @returns Configured Express app instance (not started — caller decides port)
 */
export function createApiServer(context: AppContext): express.Express {
  const app = express();

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: () => context,
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
