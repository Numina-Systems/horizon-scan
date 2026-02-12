// pattern: Imperative Shell
import type { Logger } from "pino";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { digests } from "../db/schema";
import { buildDigest } from "./builder";
import { renderDigestHtml } from "./renderer";
import type { SendDigestFn } from "./sender";

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
