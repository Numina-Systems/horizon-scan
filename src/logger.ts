import pino from "pino";

/**
 * Creates a configured pino logger instance for structured JSON output.
 *
 * - Returns log level as string label (not numeric) for readability
 * - ISO 8601 timestamps for structured log aggregation
 * - Level configurable via `LOG_LEVEL` env var, defaults to `info`
 * - No transport configuration — stdout JSON by default (container-friendly)
 *
 * @param level - Optional override for log level (defaults to LOG_LEVEL env var or "info")
 * @returns Configured pino Logger instance
 */
export function createLogger(level?: string): pino.Logger {
  return pino({
    level: level ?? process.env["LOG_LEVEL"] ?? "info",
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
