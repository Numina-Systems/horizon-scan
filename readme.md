# Horizon Scan

Automated RSS monitoring with LLM-powered relevance assessment. Polls RSS feeds on a schedule, extracts article content, uses an LLM to assess relevance against configured topics, and optionally sends email digests of relevant articles.

## How It Works

1. **Poll** -- Fetches configured RSS feeds on a cron schedule
2. **Deduplicate** -- Skips articles already seen (by guid)
3. **Fetch** -- Downloads full article HTML with concurrency limiting
4. **Extract** -- Pulls article text using CSS selectors and JSON-LD
5. **Assess** -- Sends extracted text to an LLM, which returns a relevance score, summary, and tags for each topic
6. **Digest** -- Builds and emails an HTML digest of relevant articles (if Mailgun is configured)

Results are queryable at any time via the built-in API.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your provider keys (see Environment Variables below)
# Edit config.yaml with your feeds, topics, and schedules

# Docker (recommended)
docker compose up -d

# Or run locally
npm install
npm run build
npm start
```

## Configuration

All runtime configuration lives in `config.yaml`.

```yaml
llm:
  provider: ollama          # anthropic | openai | gemini | ollama | lmstudio
  model: llama3:8b          # model ID for the chosen provider

feeds:
  - name: PRNewswire - Health
    url: https://www.prnewswire.com/rss/health-latest-news/health-latest-news-list.rss
    extractorConfig:
      bodySelector: "p.prnews_p"   # CSS selector for article body
      jsonLd: true                  # extract structured data from JSON-LD

topics:
  - name: Real World Evidence
    description: >-
      Articles about sources of real world evidence for clinical trials,
      health economics and outcomes research, and observational studies.

schedule:
  poll: "*/30 * * * *"       # cron expression for polling
  digest: "0 18 * * 1-5"    # cron expression for email digest

digest:
  recipient: user@email.com

extraction:
  maxConcurrency: 2          # parallel fetch limit
  perDomainDelayMs: 1000     # delay between requests to the same domain

assessment:
  maxArticleLength: 4000     # truncate articles before sending to LLM
```

### Feed Extractor Config

Each feed requires an `extractorConfig` that tells the extractor how to pull article content:

| Field | Description |
|---|---|
| `bodySelector` | CSS selector targeting the article body paragraphs |
| `jsonLd` | Whether to extract metadata from JSON-LD script tags |
| `metadataSelectors` | Optional map of additional CSS selectors for metadata fields |

## Environment Variables

Set these in `.env` or in the `environment` block of `docker-compose.yml`.

| Variable | Description | Default |
|---|---|---|
| `CONFIG_PATH` | Path to config.yaml | `./config.yaml` |
| `DATABASE_URL` | SQLite file path | `./data/horizon-scan.db` |
| `PORT` | API server port | `3000` |
| `LOG_LEVEL` | Log level (`debug`, `info`, `warn`, `error`) | `info` |
| `ANTHROPIC_API_KEY` | Anthropic API key | -- |
| `OPENAI_API_KEY` | OpenAI API key | -- |
| `GEMINI_API_KEY` | Google Gemini API key | -- |
| `OLLAMA_BASE_URL` | Ollama API base URL | `http://localhost:11434/api` |
| `LMSTUDIO_BASE_URL` | LM Studio API base URL | `http://localhost:1234/v1` |
| `MAILGUN_API_KEY` | Mailgun API key (digest disabled without) | -- |
| `MAILGUN_DOMAIN` | Mailgun sending domain (digest disabled without) | -- |

Only the API key (or base URL) for the provider specified in `config.yaml` is required.

## API

A tRPC API is available at `/api/trpc`. No authentication.

```bash
# System status
curl 'http://localhost:3000/api/trpc/system.status?input=%7B%7D'

# List all articles
curl 'http://localhost:3000/api/trpc/articles.list?input=%7B%7D'

# Get a specific article with its assessments
curl 'http://localhost:3000/api/trpc/articles.getById?input=%7B%22id%22%3A1%7D'

# List relevant assessments only
curl 'http://localhost:3000/api/trpc/assessments.list?input=%7B%22relevant%22%3Atrue%7D'

# List feeds
curl 'http://localhost:3000/api/trpc/feeds.list?input=%7B%7D'

# Health check
curl http://localhost:3000/health
```

## Docker

```bash
docker compose up -d              # start
docker compose logs -f            # follow logs
docker compose down               # stop
docker compose up -d --build      # rebuild after code changes
```

`config.yaml` is bind-mounted read-only -- config changes take effect on container restart without rebuilding. Environment variable changes require `docker compose down && docker compose up -d` to recreate the container.

Data is persisted in a named volume (`horizon-scan-data`).

## Development

```bash
npm install
npm run dev          # start with file watching
npm test             # run tests
npm run db:generate  # generate migrations after schema changes
npm run db:push      # push schema to database
```
