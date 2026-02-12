import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createLogger } from "./logger";
import { loadConfig } from "./config";
import { createDatabase } from "./db";
import { createLlmClient } from "./llm/client";
import { seedDatabase } from "./seed";
import { createPollScheduler, createDigestScheduler } from "./scheduler";
import { createMailgunSender } from "./digest/sender";
import { createApiServer } from "./api/server";
import { registerShutdownHandlers } from "./lifecycle";

const CONFIG_PATH = process.env["CONFIG_PATH"] ?? "./config.yaml";
const DATABASE_URL = process.env["DATABASE_URL"] ?? "./data/horizon-scan.db";
const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

async function main(): Promise<void> {
  const logger = createLogger();

  logger.info("horizon-scan starting");

  let config;
  try {
    config = loadConfig(resolve(CONFIG_PATH));
  } catch (err) {
    logger.fatal(
      { error: err instanceof Error ? err.message : String(err) },
      "configuration error",
    );
    process.exit(1);
  }

  logger.info(
    { provider: config.llm.provider, model: config.llm.model },
    "config loaded",
  );

  const { db, close: closeDb } = createDatabase(resolve(DATABASE_URL));

  migrate(db, { migrationsFolder: resolve("./drizzle") });
  logger.info("database migrations applied");

  seedDatabase(db, config, logger);

  let model = null;
  try {
    model = createLlmClient(config);
    logger.info(
      { provider: config.llm.provider, model: config.llm.model },
      "llm client initialised",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { error: message },
      "llm client init failed, assessment disabled",
    );
  }

  const pollScheduler = createPollScheduler(db, config, logger, { model });
  logger.info({ schedule: config.schedule.poll }, "poll scheduler started");

  const apiKey = process.env["MAILGUN_API_KEY"];
  const domain = process.env["MAILGUN_DOMAIN"];

  let digestScheduler;
  if (apiKey && domain) {
    const sendDigest = createMailgunSender(apiKey, domain);
    digestScheduler = createDigestScheduler(db, config, sendDigest, logger);
    logger.info(
      { schedule: config.schedule.digest },
      "digest scheduler started",
    );
  } else {
    logger.warn(
      "MAILGUN_API_KEY or MAILGUN_DOMAIN not set, digest scheduler disabled",
    );
  }

  const schedulers = digestScheduler
    ? [pollScheduler, digestScheduler]
    : [pollScheduler];

  registerShutdownHandlers({ schedulers, closeDb, logger });

  const app = createApiServer({ db, config, logger });
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "api server listening");
  });
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});
