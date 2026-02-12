// pattern: imperative-shell
import { generateText, Output } from "ai";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { Logger } from "pino";
import type { LanguageModel } from "ai";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { articles, assessments, topics } from "../db/schema";
import {
  assessmentOutputSchema,
  type AssessmentOutput,
} from "./assessment-schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callLlmForAssessment(
  model: LanguageModel,
  topic: { name: string; description: string },
  articleText: string,
): Promise<AssessmentOutput> {
  // Build params dynamically to avoid type inference issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {};
  params.model = model;
  params.system = `You are a relevance assessor. Evaluate whether the article is relevant to the given topic. Return structured JSON with the relevant, summary, and tags fields.`;
  params.prompt = `Topic: ${topic.name}\nDescription: ${topic.description}\n\nArticle:\n${articleText}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params.output = (Output.object as any)({ schema: assessmentOutputSchema });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = await generateText(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = response.experimental_output as any;

  if (!result || typeof result !== "object") {
    throw new Error("LLM returned invalid result");
  }

  const resultObj = result as Record<string, unknown>;
  return {
    relevant: resultObj["relevant"] as boolean,
    summary: (resultObj["summary"] as string) ?? "",
    tags: (resultObj["tags"] as Array<string>) ?? [],
  };
}

/**
 * Assesses pending articles against all active topics using an LLM.
 * Returns structured output (relevant, summary, tags) for each article-topic pair.
 * Increments retry count on failure; marks articles as 'failed' after 3 failed attempts.
 *
 * @param db - The application database instance.
 * @param model - The LLM model instance to use for assessment.
 * @param config - Application configuration with assessment.maxArticleLength.
 * @param logger - Logger instance for debug and error messages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assessPendingArticles(
  db: AppDatabase,
  model: LanguageModel,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  const pending = db
    .select({
      articleId: articles.id,
      extractedText: articles.extractedText,
      status: articles.status,
      retryCount: articles.assessmentRetryCount,
    })
    .from(articles)
    .where(
      and(
        isNotNull(articles.extractedText),
        eq(articles.status, "pending_assessment"),
        lt(articles.assessmentRetryCount, 3),
      ),
    )
    .all();

  if (pending.length === 0) {
    logger.info("no articles pending assessment");
    return;
  }

  const activeTopics = db
    .select({
      topicId: topics.id,
      name: topics.name,
      description: topics.description,
    })
    .from(topics)
    .where(eq(topics.enabled, true))
    .all();

  if (activeTopics.length === 0) {
    logger.info("no active topics configured");
    return;
  }

  for (const article of pending) {
    let assessmentFailed = false;

    for (const topic of activeTopics) {
      try {
        // Check if assessment already exists for this article-topic pair
        const existing = db
          .select({ id: assessments.id })
          .from(assessments)
          .where(
            and(
              eq(assessments.articleId, article.articleId),
              eq(assessments.topicId, topic.topicId),
            ),
          )
          .get();

        if (existing) {
          logger.debug(
            {
              articleId: article.articleId,
              topicId: topic.topicId,
            },
            "assessment already exists, skipping",
          );
          continue;
        }

        // Truncate article text to configured maximum
        const truncatedText = (article.extractedText as string).substring(
          0,
          config.assessment.maxArticleLength,
        );

        // Call LLM with structured output
        const result = await callLlmForAssessment(model, topic, truncatedText);

        // Insert assessment into database
        const now = new Date();
        const insertData = {
          articleId: article.articleId,
          topicId: topic.topicId,
          relevant: result.relevant,
          summary: result.summary,
          tags: result.tags,
          modelUsed: config.llm.model,
          provider: config.llm.provider,
          assessedAt: now,
        };
        db.insert(assessments).values(insertData).run();

        logger.debug(
          {
            articleId: article.articleId,
            topicId: topic.topicId,
            relevant: result.relevant,
          },
          "assessment completed",
        );
      } catch (err) {
        assessmentFailed = true;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          {
            articleId: article.articleId,
            topicId: topic.topicId,
            error: message,
          },
          "assessment failed for article-topic pair",
        );
      }
    }

    // Update article status based on assessment outcome
    if (assessmentFailed) {
      const newRetryCount = (article.retryCount as number) + 1;
      const newStatus = newRetryCount >= 3 ? "failed" : "pending_assessment";

      db.update(articles)
        .set({
          assessmentRetryCount: newRetryCount,
          status: newStatus,
        })
        .where(eq(articles.id, article.articleId))
        .run();

      logger.info(
        {
          articleId: article.articleId,
          retryCount: newRetryCount,
          status: newStatus,
        },
        "article assessment retry count incremented",
      );
    } else {
      db.update(articles)
        .set({
          status: "assessed",
        })
        .where(eq(articles.id, article.articleId))
        .run();

      logger.debug(
        { articleId: article.articleId },
        "article assessment completed, status updated to assessed",
      );
    }
  }

  logger.info({ count: pending.length }, "assessment cycle complete");
}
