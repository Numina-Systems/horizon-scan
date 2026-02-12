# Horizon Scan Human Test Plan

Generated from implementation plan at `docs/implementation-plans/2026-02-12-horizon-scan/`.

This plan covers acceptance criteria that require human verification — visual rendering, Docker infrastructure, and end-to-end pipeline behaviour that cannot be meaningfully automated.

---

## Phase 1: Email Rendering Verification

**Covers:** horizon-scan.AC3.3 (HTML email renders with inline styles)

**Prerequisites:**
- MAILGUN_API_KEY and MAILGUN_DOMAIN set in environment
- At least one test digest cycle has run with relevant articles
- Access to Gmail, Outlook (desktop + web), and Apple Mail test inboxes

**Steps:**

1. Seed the database with at least 2 feeds and 3 topics
2. Run a poll cycle to populate articles
3. Run an assessment cycle (requires LLM configured) to generate relevance data
4. Trigger a digest send (via cron or manual invocation)
5. Verify email received in all test inboxes

**Verification checklist:**

- [ ] Email arrives in Gmail inbox (not spam)
- [ ] Email arrives in Outlook inbox (desktop and web)
- [ ] Email arrives in Apple Mail inbox
- [ ] Topic headings (`<h2>`) render as visually distinct sections
- [ ] Article titles are clickable links that open the correct URL
- [ ] Dateline displays correctly beneath each article title
- [ ] Summary text is readable and properly formatted
- [ ] Tags display as comma-separated values
- [ ] No `<style>` blocks visible — all styling is inline
- [ ] Layout is readable on mobile viewport (check Gmail mobile or responsive preview)
- [ ] HTML special characters (e.g., `&`, `<`, `>`) in article titles render correctly (escaped)
- [ ] Empty digest (0 articles) produces valid "no articles" message if triggered

---

## Phase 2: Docker Build Verification

**Covers:** horizon-scan.AC6.3 (`docker build` produces a working OCI image)

**Prerequisites:**
- Docker daemon running
- Repository checked out with all source files

**Steps:**

1. Build the image:
   ```bash
   docker build -t horizon-scan .
   ```

2. Verify build succeeds (exit code 0)

3. Verify native module loads:
   ```bash
   docker run --rm horizon-scan node -e "require('better-sqlite3')"
   ```

4. Inspect image:
   ```bash
   docker image inspect horizon-scan --format '{{.Size}}'
   docker history horizon-scan
   ```

**Verification checklist:**

- [ ] `docker build` completes without errors
- [ ] Multi-stage build produces 3 stages (builder, deps, runtime)
- [ ] `better-sqlite3` native module loads in final image
- [ ] Final image uses Alpine (small footprint)
- [ ] Image runs as non-root user (`node`)
- [ ] Image size is reasonable (< 250MB)

---

## Phase 3: Container Runtime Verification

**Covers:** horizon-scan.AC6.4 (Container runs with mounted config and SQLite data volume)

**Prerequisites:**
- Docker and Docker Compose installed
- Valid `config.yaml` in repository root
- At least one LLM provider API key available (or local Ollama running)

**Steps:**

1. Start services:
   ```bash
   docker compose up -d
   ```

2. Check startup logs:
   ```bash
   docker compose logs --tail=50
   ```

3. Verify health endpoint:
   ```bash
   curl http://localhost:3000/health
   ```
   Expected: `{"status":"ok"}`

4. Verify API responds:
   ```bash
   curl http://localhost:3000/trpc/system.status
   ```
   Expected: JSON with `feedCount`, `topicCount`, `provider`, `model`

5. Test data persistence across restarts:
   ```bash
   # Note current feed/article counts via API
   curl http://localhost:3000/trpc/feeds.list

   # Restart container
   docker compose restart

   # Wait for startup
   sleep 5

   # Verify data persists
   curl http://localhost:3000/trpc/feeds.list
   ```

6. Clean shutdown:
   ```bash
   docker compose down
   ```

**Verification checklist:**

- [ ] Container starts successfully with `docker compose up`
- [ ] Startup logs show: config loaded, migrations applied, seeds run, schedulers started
- [ ] `/health` returns `{"status":"ok"}`
- [ ] `system.status` returns correct provider and model from config
- [ ] Feed and topic counts match seeded config
- [ ] SQLite data persists across container restart (named volume)
- [ ] `docker compose down` exits cleanly (exit code 0, no error logs)
- [ ] No permission errors on data directory (runs as `node` user)

---

## End-to-End: Full Pipeline Verification

**Covers:** AC1 through AC3 integration (poll -> fetch -> extract -> assess -> digest)

**Prerequisites:**
- Running instance (Docker or local)
- Valid config with at least 2 real RSS feeds
- LLM provider configured and accessible
- MAILGUN credentials configured

**Steps:**

1. Start the service and wait for first poll cycle
2. Check logs for successful feed polling:
   ```
   "msg": "poll cycle complete"
   ```
3. Verify articles appear via API:
   ```bash
   curl http://localhost:3000/trpc/articles.list
   ```
4. Wait for or trigger assessment cycle
5. Check assessments via API:
   ```bash
   curl 'http://localhost:3000/trpc/assessments.list?input={"json":{"relevant":true}}'
   ```
6. Wait for or trigger digest cycle
7. Verify digest email received

**Verification checklist:**

- [ ] Feeds polled on configured schedule
- [ ] Articles stored with correct metadata (guid, title, url, publishedAt)
- [ ] Duplicate articles silently skipped on subsequent polls
- [ ] Article content fetched and extracted via Cheerio selectors
- [ ] JSON-LD data parsed and merged with RSS metadata where available
- [ ] Assessments generated for each article-topic pair
- [ ] Relevant articles include summary and tags
- [ ] Digest email sent with articles grouped by topic
- [ ] Time window advances after digest (subsequent digest only includes new articles)

---

## End-to-End: Error Recovery Verification

**Covers:** AC1.4, AC1.7, AC2.4, AC3.5 (error handling and resilience)

**Steps:**

1. **Feed error recovery:** Add a feed with an invalid URL, verify other feeds still poll successfully
2. **Fetch retry:** Temporarily block access to an article URL, verify retry count increments, verify article marked `failed` after 3 retries
3. **LLM failure:** Misconfigure LLM API key, verify assessment retry count increments, verify other pipeline stages unaffected
4. **Digest send failure:** Set invalid MAILGUN_API_KEY, trigger digest, verify digest row recorded with `status: 'failed'`, verify articles remain available for next cycle

**Verification checklist:**

- [ ] Invalid feed URL does not block polling of other feeds
- [ ] Fetch failures increment retry count (visible via API or logs)
- [ ] Article marked `status: 'failed'` after 3 fetch retries
- [ ] LLM failures increment assessment retry count
- [ ] Article marked `status: 'failed'` after 3 assessment retries
- [ ] Mailgun failure records digest as `status: 'failed'`
- [ ] Articles from failed digest available in subsequent digest cycle

---

## Traceability Matrix

| AC ID | Automated Tests | Human Verification Phase |
|---|---|---|
| horizon-scan.AC1.1 | poller.test.ts, scheduler.test.ts | Full Pipeline |
| horizon-scan.AC1.2 | poller.test.ts, dedup.test.ts | Full Pipeline |
| horizon-scan.AC1.3 | dedup.test.ts | Full Pipeline |
| horizon-scan.AC1.4 | poller.test.ts, scheduler.test.ts | Error Recovery |
| horizon-scan.AC1.5 | fetcher.test.ts, extractor.test.ts, extract-articles.test.ts | Full Pipeline |
| horizon-scan.AC1.6 | extractor.test.ts, extract-articles.test.ts | Full Pipeline |
| horizon-scan.AC1.7 | fetcher.test.ts, extract-articles.test.ts | Error Recovery |
| horizon-scan.AC2.1 | assessor.test.ts | Full Pipeline |
| horizon-scan.AC2.2 | assessor.test.ts | Full Pipeline |
| horizon-scan.AC2.3 | assessor.test.ts | Full Pipeline |
| horizon-scan.AC2.4 | assessor.test.ts | Error Recovery |
| horizon-scan.AC2.5 | providers.test.ts | N/A (automated only) |
| horizon-scan.AC3.1 | builder.test.ts, orchestrator.test.ts, sender.test.ts | Full Pipeline |
| horizon-scan.AC3.2 | builder.test.ts, renderer.test.ts | Email Rendering |
| horizon-scan.AC3.3 | renderer.test.ts | Email Rendering |
| horizon-scan.AC3.4 | builder.test.ts, orchestrator.test.ts | Full Pipeline |
| horizon-scan.AC3.5 | orchestrator.test.ts, sender.test.ts | Error Recovery |
| horizon-scan.AC4.1 | seed.test.ts, index.test.ts | Full Pipeline |
| horizon-scan.AC4.2 | index.test.ts | N/A (automated only) |
| horizon-scan.AC5.1 | feeds.test.ts, articles.test.ts, assessments.test.ts | Full Pipeline |
| horizon-scan.AC5.2 | feeds.test.ts, topics.test.ts | N/A (automated only) |
| horizon-scan.AC5.3 | system.test.ts | Container Runtime |
| horizon-scan.AC6.1 | lifecycle.test.ts | N/A (automated only) |
| horizon-scan.AC6.2 | index.test.ts | N/A (automated only) |
| horizon-scan.AC6.3 | N/A | Docker Build |
| horizon-scan.AC6.4 | N/A | Container Runtime |
