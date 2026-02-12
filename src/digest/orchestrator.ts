// pattern: Imperative Shell
import type { Logger } from "pino";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { digests } from "../db/schema";
import { buildDigest } from "./builder";
import { renderDigestHtml } from "./renderer";
import type { SendDigestFn } from "./sender";

/**
 * Runs a complete digest cycle: builds digest data, optionally sends email, and records result.
 *
 * Behavior:
 * - If no relevant articles exist, records an empty digest with status 'success' to advance
 *   the time window, but does NOT send an email (AC3.4).
 * - If articles exist, renders HTML, calls sendDigest, and records result with status 'success'
 *   or 'failed' (AC3.1, AC3.5).
 * - On send failure, articles remain available for the next digest cycle (AC3.5).
 * - Logs progress at each step.
 *
 * @param db - The application database connection
 * @param config - Application configuration including digest.recipient
 * @param sendDigest - Function to dispatch the email (dependency injection for testability)
 * @param logger - Logger instance for recording events
 */
export async function runDigestCycle(
  db: AppDatabase,
  config: AppConfig,
  sendDigest: SendDigestFn,
  logger: Logger,
): Promise<void> {
  const digestData = buildDigest(db);

  if (digestData.totalArticleCount === 0) {
    logger.info("no relevant articles for digest, skipping email send");

    db.insert(digests)
      .values({
        sentAt: new Date(),
        articleCount: 0,
        recipient: config.digest.recipient,
        status: "success",
      })
      .run();

    logger.info("empty digest recorded to advance time window");
    return;
  }

  const html = renderDigestHtml(digestData);
  const subject = `Horizon Scan: ${digestData.totalArticleCount} article${digestData.totalArticleCount !== 1 ? "s" : ""} — ${new Date().toISOString().split("T")[0]}`;

  const result = await sendDigest(
    config.digest.recipient,
    subject,
    html,
    logger,
  );

  db.insert(digests)
    .values({
      sentAt: new Date(),
      articleCount: digestData.totalArticleCount,
      recipient: config.digest.recipient,
      status: result.success ? "success" : "failed",
    })
    .run();

  if (result.success) {
    logger.info(
      { articleCount: digestData.totalArticleCount },
      "digest cycle complete",
    );
  } else {
    logger.error({ error: result.error }, "digest recorded as failed");
  }
}
