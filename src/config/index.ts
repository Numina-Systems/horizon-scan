import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { appConfigSchema } from "./schema";
import type { AppConfig } from "./schema";

export function loadConfig(configPath: string): AppConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to read config file at ${configPath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse YAML in ${configPath}: ${message}`);
  }

  const result = appConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`invalid configuration in ${configPath}:\n${issues}`);
  }

  return result.data;
}

export type { AppConfig };
