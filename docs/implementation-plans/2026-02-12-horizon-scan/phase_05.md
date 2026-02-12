# Horizon Scan Implementation Plan — Phase 5: Email Digest

**Goal:** Compile relevant articles into an HTML email digest grouped by topic and send via Mailgun on a configurable schedule. Handle empty digest windows and send failures gracefully.

**Architecture:** The builder queries assessments marked relevant since the last successful digest, groups them by topic. The renderer produces an HTML email with inline styles. The sender dispatches via Mailgun API. A digest cron schedule triggers the cycle, and results are recorded in the `digests` table.

**Tech Stack:** mailgun.js 12.x, form-data, vitest (testing)

**Scope:** 8 phases from original design (phases 1-8). This is phase 5.

**Codebase verified:** 2026-02-12 — Greenfield project. Phase 1 provides digests table (sentAt, articleCount, recipient, status). Phase 4 provides assessments table with relevant flag, summary, and tags. Config has `schedule.digest` and `digest.recipient`.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### horizon-scan.AC3: Email digest
- **horizon-scan.AC3.1 Success:** Digest email is sent on the configured cron schedule containing all articles assessed as relevant since the last digest
- **horizon-scan.AC3.2 Success:** Digest groups articles by topic with title (linked to original), dateline, LLM summary, and entity tags
- **horizon-scan.AC3.3 Success:** HTML email renders correctly with inline styles
- **horizon-scan.AC3.4 Edge:** No email is sent when no relevant articles exist in the digest window, but the time window advances
- **horizon-scan.AC3.5 Failure:** Mailgun send failure is logged, digest recorded with `status: 'failed'`, articles remain available for next digest

---

<!-- START_TASK_1 -->
### Task 1: Add digest dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

Run: `npm install mailgun.js form-data`

This adds:
- `mailgun.js` 12.x — Mailgun SDK with built-in TypeScript types
- `form-data` — required by mailgun.js for multipart form requests

> **Note on mailgun.js v12:** TypeScript types/interfaces import from `mailgun.js/definitions` submodule. Initialization: `new Mailgun(FormData)` then `mailgun.client({ username: 'api', key: apiKey })`.

**Step 2: Verify**

Run: `npm run build`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add mailgun.js and form-data dependencies"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Digest builder implementation

**Verifies:** horizon-scan.AC3.1, horizon-scan.AC3.2, horizon-scan.AC3.4

**Files:**
- Create: `src/digest/builder.ts`

The builder queries all relevant assessments since the last successful digest, groups them by topic, and returns structured data for the renderer.

**Implementation:**

```typescript
import { eq, and, gt, desc } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { assessments, articles, topics, digests } from "../db/schema";

export type DigestArticle = {
  readonly title: string | null;
  readonly url: string;
  readonly publishedAt: Date | null;
  readonly summary: string | null;
  readonly tags: ReadonlyArray<string>;
};

export type DigestTopicGroup = {
  readonly topicName: string;
  readonly articles: ReadonlyArray<DigestArticle>;
};

export type DigestData = {
  readonly topicGroups: ReadonlyArray<DigestTopicGroup>;
  readonly totalArticleCount: number;
};

export function buildDigest(db: AppDatabase): DigestData {
  // Find the last successful digest timestamp
  const lastDigest = db
    .select({ sentAt: digests.sentAt })
    .from(digests)
    .where(eq(digests.status, "success"))
    .orderBy(desc(digests.sentAt))
    .limit(1)
    .get();

  const sinceDate = lastDigest?.sentAt ?? new Date(0);

  // Query relevant assessments since last digest, joined with articles and topics
  const rows = db
    .select({
      topicName: topics.name,
      topicId: topics.id,
      articleTitle: articles.title,
      articleUrl: articles.url,
      articlePublishedAt: articles.publishedAt,
      summary: assessments.summary,
      tags: assessments.tags,
      assessedAt: assessments.assessedAt,
    })
    .from(assessments)
    .innerJoin(articles, eq(assessments.articleId, articles.id))
    .innerJoin(topics, eq(assessments.topicId, topics.id))
    .where(
      and(
        eq(assessments.relevant, true),
        gt(assessments.assessedAt, sinceDate),
      ),
    )
    .all();

  // Group by topic
  const groupMap = new Map<string, Array<DigestArticle>>();

  for (const row of rows) {
    const group = groupMap.get(row.topicName) ?? [];
    group.push({
      title: row.articleTitle,
      url: row.articleUrl,
      publishedAt: row.articlePublishedAt,
      summary: row.summary,
      tags: row.tags,
    });
    groupMap.set(row.topicName, group);
  }

  const topicGroups: Array<DigestTopicGroup> = Array.from(
    groupMap.entries(),
  ).map(([topicName, articles]) => ({ topicName, articles }));

  return {
    topicGroups,
    totalArticleCount: rows.length,
  };
}
```

Key behaviours:
- Finds timestamp of last successful digest to determine the window
- Joins assessments → articles → topics for a single efficient query
- Groups by topic name for the email layout
- Returns empty `topicGroups` when no relevant articles exist (AC3.4 — caller decides whether to send)

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add digest builder with topic grouping`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Digest builder tests

**Verifies:** horizon-scan.AC3.1, horizon-scan.AC3.2, horizon-scan.AC3.4

**Files:**
- Test: `src/digest/builder.test.ts` (integration)

**Testing:**
Uses real in-memory SQLite database via `createTestDatabase()`.

- **horizon-scan.AC3.1 (relevant articles since last digest):** Seed a feed, articles, topics, and relevant assessments with `assessedAt` after a previous digest's `sentAt`. Call `buildDigest`. Verify returned articles match only those assessed after the last digest.
- **horizon-scan.AC3.2 (grouped by topic):** Seed 2 topics and articles relevant to different topics. Verify `topicGroups` contains entries for each topic with the correct articles. Each article should have title, url, summary, and tags.
- **horizon-scan.AC3.4 (empty window):** Seed a successful digest with a recent `sentAt` but no new relevant assessments after it. Verify `totalArticleCount` is 0 and `topicGroups` is empty.
- **horizon-scan.AC3.1 (first run, no prior digest):** When no digest rows exist, all relevant assessments should be included (since epoch). Seed assessments without any digest rows, verify they're all returned.

**Verification:**
Run: `npm test`
Expected: All builder tests pass.

**Commit:** `test: add digest builder integration tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Digest renderer implementation

**Verifies:** horizon-scan.AC3.2, horizon-scan.AC3.3

**Files:**
- Create: `src/digest/renderer.ts`

The renderer takes `DigestData` and produces an HTML email string with inline styles.

**Implementation:**

Build the HTML string programmatically using template literals. All styles must be inline (email clients strip `<style>` tags). Structure:

```
<html>
  <body style="...">
    <h1>Horizon Scan Digest</h1>
    <p>Generated: {date}</p>
    For each topic group:
      <h2>{topicName}</h2>
      For each article:
        <div style="...">
          <h3><a href="{url}">{title}</a></h3>
          <p style="color:#666">{publishedAt}</p>
          <p>{summary}</p>
          <p>Tags: {tags.join(', ')}</p>
        </div>
  </body>
</html>
```

```typescript
import type { DigestData } from "./builder";

export function renderDigestHtml(data: Readonly<DigestData>): string {
  const now = new Date().toISOString().split("T")[0];

  const topicSections = data.topicGroups
    .map((group) => {
      const articleItems = group.articles
        .map((article) => {
          const title = article.title ?? "Untitled";
          const dateline = article.publishedAt
            ? article.publishedAt.toISOString().split("T")[0]
            : "";
          const tagsStr =
            article.tags.length > 0 ? article.tags.join(", ") : "";

          return `
        <div style="margin-bottom:16px;padding:12px;border-left:3px solid #2563eb;background:#f8fafc;">
          <h3 style="margin:0 0 4px 0;font-size:16px;">
            <a href="${escapeHtml(article.url)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(title)}</a>
          </h3>
          ${dateline ? `<p style="margin:0 0 8px 0;color:#64748b;font-size:13px;">${escapeHtml(dateline)}</p>` : ""}
          ${article.summary ? `<p style="margin:0 0 8px 0;font-size:14px;line-height:1.5;">${escapeHtml(article.summary)}</p>` : ""}
          ${tagsStr ? `<p style="margin:0;font-size:12px;color:#94a3b8;">Tags: ${escapeHtml(tagsStr)}</p>` : ""}
        </div>`;
        })
        .join("\n");

      return `
      <h2 style="margin:24px 0 12px 0;font-size:20px;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">
        ${escapeHtml(group.topicName)}
      </h2>
      ${articleItems}`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#1e293b;">
  <h1 style="font-size:24px;margin-bottom:4px;">Horizon Scan Digest</h1>
  <p style="color:#64748b;margin-top:0;">${escapeHtml(now)} &middot; ${data.totalArticleCount} article${data.totalArticleCount !== 1 ? "s" : ""}</p>
  ${topicSections}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin-top:32px;">
  <p style="font-size:12px;color:#94a3b8;">Generated by Horizon Scan</p>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

Key behaviours:
- All styles inline for email client compatibility (AC3.3)
- HTML entities escaped to prevent XSS
- Articles grouped under topic headings (AC3.2)
- Each article shows title (linked), dateline, summary, tags (AC3.2)
- Graceful handling of null titles and missing dates

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add html digest renderer with inline styles`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Digest renderer tests

**Verifies:** horizon-scan.AC3.2, horizon-scan.AC3.3

**Files:**
- Test: `src/digest/renderer.test.ts` (unit)

**Testing:**

- **horizon-scan.AC3.2 (topic grouping in HTML):** Given `DigestData` with 2 topic groups, the rendered HTML contains `<h2>` headings for each topic name.
- **horizon-scan.AC3.2 (article details):** Each article renders as a linked title (`<a href="...">`), dateline, summary paragraph, and comma-separated tags.
- **horizon-scan.AC3.3 (inline styles):** The rendered HTML contains no `<style>` tags. All styling is via `style=` attributes on elements. Check the output string does not contain `<style`.
- **horizon-scan.AC3.3 (valid HTML):** Output starts with `<!DOCTYPE html>` and contains `<html>`, `<body>`, closing tags.
- **horizon-scan.AC3.2 (HTML escaping):** Article titles containing `<script>` or `&` characters are properly escaped in the output.
- **horizon-scan.AC3.2 (empty digest):** Given `DigestData` with empty `topicGroups`, the output still produces valid HTML with a "0 articles" count.

No database or HTTP mocking needed — renderer is a pure function taking `DigestData`.

**Verification:**
Run: `npm test`
Expected: All renderer tests pass.

**Commit:** `test: add digest renderer unit tests`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-8) -->
<!-- START_TASK_6 -->
### Task 6: Mailgun sender implementation

**Verifies:** horizon-scan.AC3.1, horizon-scan.AC3.5

**Files:**
- Create: `src/digest/sender.ts`

The sender dispatches the rendered HTML via Mailgun's API.

**Implementation:**

```typescript
import Mailgun from "mailgun.js";
import FormData from "form-data";
import type { Logger } from "pino";

export type SendResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

export function createMailgunSender(apiKey: string, domain: string) {
  const mailgun = new Mailgun(FormData);
  const mg = mailgun.client({ username: "api", key: apiKey });

  return async function sendDigest(
    recipient: string,
    subject: string,
    html: string,
    logger: Logger,
  ): Promise<SendResult> {
    try {
      const result = await mg.messages.create(domain, {
        from: `Horizon Scan <noreply@${domain}>`,
        to: [recipient],
        subject,
        html,
      });

      logger.info({ messageId: result.id, recipient }, "digest email sent");
      return { success: true, messageId: result.id ?? "unknown" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ recipient, error: message }, "digest email send failed");
      return { success: false, error: message };
    }
  };
}
```

Key behaviours:
- Factory function creates a sender bound to Mailgun credentials
- Returns discriminated union result (success/failure)
- Never throws — errors returned in result (AC3.5)
- Logs send success/failure with context

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add mailgun digest sender`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Digest orchestration and scheduling

**Verifies:** horizon-scan.AC3.1, horizon-scan.AC3.4, horizon-scan.AC3.5

**Files:**
- Create: `src/digest/orchestrator.ts`
- Modify: `src/scheduler.ts` (add digest schedule)

The orchestrator ties builder → renderer → sender together and records results in the `digests` table. The scheduler gets a new digest cron task.

**Implementation for `src/digest/orchestrator.ts`:**

```typescript
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import { digests } from "../db/schema";
import { buildDigest } from "./builder";
import { renderDigestHtml } from "./renderer";
import type { SendResult } from "./sender";

type SendDigestFn = (
  recipient: string,
  subject: string,
  html: string,
  logger: Logger,
) => Promise<SendResult>;

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
```

**Modification to `src/scheduler.ts`:**

Add a `createDigestScheduler` function alongside the existing `createPollScheduler`:

```typescript
export function createDigestScheduler(
  db: AppDatabase,
  config: AppConfig,
  sendDigest: SendDigestFn,
  logger: Logger,
): PollScheduler {
  const task = cron.schedule(config.schedule.digest, async () => {
    try {
      await runDigestCycle(db, config, sendDigest, logger);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "digest cycle failed unexpectedly");
    }
  });

  return { stop: () => task.stop() };
}
```

Key behaviours:
- Empty digest window: no email sent, but a digest row with `articleCount: 0` and `status: 'success'` IS recorded (AC3.4). This advances the time window so the next `buildDigest` queries from this timestamp forward, preventing old articles from re-appearing.
- Send failure: digest row recorded with `status: 'failed'`, articles remain available for next cycle (AC3.5)
- Accepts `sendDigest` function parameter for dependency injection (testable without Mailgun)

**Verification:**

Run: `npm run build`
Expected: Compiles without errors.

**Commit:** `feat: add digest orchestration and digest schedule`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Digest orchestration and sender tests

**Verifies:** horizon-scan.AC3.1, horizon-scan.AC3.4, horizon-scan.AC3.5

**Files:**
- Test: `src/digest/orchestrator.test.ts` (integration)
- Test: `src/digest/sender.test.ts` (unit)

**Testing for orchestrator (integration, in-memory database):**

- **horizon-scan.AC3.1 (full cycle):** Seed database with feed, articles, topics, relevant assessments. Call `runDigestCycle` with a mock `sendDigest` that returns success. Verify: mock was called with recipient from config, HTML contains topic names and article titles, a `digests` row was inserted with `status: 'success'` and correct `articleCount`.
- **horizon-scan.AC3.4 (empty window):** Seed database with no relevant assessments (or all assessed before the last digest). Call `runDigestCycle`. Verify: mock `sendDigest` was NOT called, BUT a new `digests` row WAS inserted with `articleCount: 0` and `status: 'success'` (window advancement).
- **horizon-scan.AC3.5 (send failure):** Mock `sendDigest` to return `{ success: false, error: "API error" }`. Call `runDigestCycle` with relevant articles. Verify: `digests` row inserted with `status: 'failed'`. Articles' assessments are still queryable for next cycle.

**Testing for sender (unit):**

- **horizon-scan.AC3.1 (success):** Mock `mailgun.js` client to return `{ id: "msg-123" }`. Verify `sendDigest` returns `{ success: true, messageId: "msg-123" }`.
- **horizon-scan.AC3.5 (failure):** Mock `mailgun.js` client to throw an error. Verify `sendDigest` returns `{ success: false, error: "..." }` — does not throw.

**Verification:**
Run: `npm test`
Expected: All digest tests pass.

**Commit:** `test: add digest orchestration and sender tests`
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_C -->
