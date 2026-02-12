// pattern: Functional Core
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import type { Logger } from "pino";

/**
 * tRPC context type passed to all procedures.
 * Contains the database instance, application configuration, and structured logger
 * available to query and mutation handlers.
 */
export type AppContext = {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
};
