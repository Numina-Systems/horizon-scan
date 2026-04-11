// pattern: Functional Core
import { describe, expect, test } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "./assessment-prompt";

describe("buildSystemPrompt", () => {
  const topic = {
    name: "Real World Data",
    description: "Articles about sources of real world data for clinical trials.",
  };
  const prompt = buildSystemPrompt(topic);

  test("defines role as market intelligence analyst", () => {
    expect(prompt).toContain("market intelligence analyst");
  });

  test("includes topic name in role", () => {
    expect(prompt).toContain("focused on Real World Data");
  });

  test("establishes high bar for relevance", () => {
    expect(prompt).toContain("directly address the topic");
    expect(prompt).toMatch(/tangential|passing/i);
  });

  test("instructs against corporate fluff and boilerplate", () => {
    expect(prompt).toMatch(/boilerplate|fluff/i);
  });

  test("defines summary quality expectations", () => {
    expect(prompt).toMatch(/specific.*detail|names.*numbers|facts/i);
  });

  test("defines tag extraction as named entities only", () => {
    expect(prompt).toMatch(/named entit/i);
  });

  test("specifies JSON output format with all three fields", () => {
    expect(prompt).toContain('"relevant"');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"tags"');
  });
});

describe("buildUserPrompt", () => {
  const topic = {
    name: "Real World Data",
    description: "Articles about sources of real world data for clinical trials.",
  };

  test("includes topic name and description", () => {
    const prompt = buildUserPrompt(topic, "some article text");
    expect(prompt).toContain("Real World Data");
    expect(prompt).toContain(
      "Articles about sources of real world data for clinical trials.",
    );
  });

  test("includes article text", () => {
    const prompt = buildUserPrompt(topic, "The FDA announced new guidelines.");
    expect(prompt).toContain("The FDA announced new guidelines.");
  });

  test("separates topic context from article text", () => {
    const prompt = buildUserPrompt(topic, "article content here");
    const topicIdx = prompt.indexOf("Real World Data");
    const articleIdx = prompt.indexOf("article content here");
    expect(topicIdx).toBeLessThan(articleIdx);
  });
});
