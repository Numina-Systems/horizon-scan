// pattern: Functional Core
/**
 * Assessment prompt construction for LLM-based article relevance assessment.
 */

type AssessmentTopic = {
  readonly name: string;
  readonly description: string;
};

const ROLE = [
  "You are a senior market intelligence analyst performing horizon scanning",
  "for a professional research digest. Your job is to determine whether an",
  "article is directly relevant to a specific topic and, if so, extract the",
  "key information a specialist would need.",
].join(" ");

const RELEVANCE_CRITERIA = [
  "Relevance criteria (high bar):",
  '- The article must directly address the topic — not merely mention it in passing.',
  "- It must contain substantive information: announcements, data, findings,",
  "  regulatory actions, product launches, partnerships, or market developments.",
  "- Press release boilerplate, corporate fluff, and tangential mentions are NOT relevant.",
  "- An article about a company that happens to operate in the topic's domain is NOT",
  "  relevant unless the article's subject matter is the topic itself.",
  '- "Could be interesting to someone in this field" is NOT the bar.',
  '  "A specialist tracking this topic would need to know this" IS the bar.',
  "- When in doubt, mark as not relevant. False negatives are preferable to noise.",
].join("\n");

const SUMMARY_RULES = [
  "Summary rules (when relevant):",
  "- Lead with the most important fact or announcement.",
  "- Include specific details: names, numbers, dates, outcomes.",
  "- No editorialising or speculation — report only what the article states.",
  "- 2-3 sentences, dense with information. No filler.",
].join("\n");

const TAG_RULES = [
  "Tag extraction rules (when relevant):",
  "- Extract named entities only: companies, products, people, technologies, regulations.",
  '- No generic terms (e.g., "healthcare", "data", "research") — only proper nouns',
  "  and specific names.",
].join("\n");

const OUTPUT_FORMAT = [
  "Respond with ONLY a JSON object containing all three fields:",
  '{',
  '  "relevant": true,',
  '  "summary": "Dense 2-3 sentence summary of key facts from the article.",',
  '  "tags": ["CompanyName", "ProductName", "PersonName"]',
  '}',
  "",
  "Field requirements:",
  '- "relevant" (boolean): true only if the article meets the relevance criteria above.',
  '- "summary" (string): If relevant, a substantive summary. If not relevant, empty string "".',
  '- "tags" (string array): If relevant, specific named entities. If not relevant, empty array [].',
  "",
  "IMPORTANT: When relevant is true, summary MUST be non-empty and tags MUST be non-empty.",
  "Every response MUST include all three fields.",
].join("\n");

export function buildSystemPrompt(): string {
  return [ROLE, RELEVANCE_CRITERIA, SUMMARY_RULES, TAG_RULES, OUTPUT_FORMAT].join(
    "\n\n",
  );
}

export function buildUserPrompt(
  topic: AssessmentTopic,
  articleText: string,
): string {
  return [
    `Topic: ${topic.name}`,
    `Topic description: ${topic.description}`,
    "",
    "Assess the following article for relevance to the topic above.",
    "",
    "Article text:",
    articleText,
  ].join("\n");
}
