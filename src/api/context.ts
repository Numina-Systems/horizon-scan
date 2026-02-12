import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import type { Logger } from "pino";

export type AppContext = {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
};
