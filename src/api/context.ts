// pattern: Functional Core
import type { LanguageModel, EmbeddingModel } from "ai";
import type { AppDatabase } from "../db";
import type { AppConfig } from "../config";
import type { Logger } from "pino";

/**
 * tRPC context type passed to all procedures.
 * Contains the database instance, application configuration, structured logger,
 * and optional LLM model and embedding model available to query and mutation handlers.
 */
// EmbeddingModel is a union type in ai v4+ (not generic)
export type AppContext = {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly model: LanguageModel | null;
  readonly embeddingModel: EmbeddingModel | null;
  /**
   * Runtime-injected API key for authentication and authorization.
   * NOT from Zod-validated config — injected from process.env at server
   * creation time (F2). When undefined, the API runs in unauthenticated
   * dev mode.
   */
  readonly authKey?: string;
  /**
   * Per-request resolved principal. Must ONLY be set by resolvePrincipal()
   * in server.ts — never by application code. Undefined when no key is
   * configured (dev mode) or when auth fails. When present, carries the
   * authorized role (AC-1: security boundary — do not set this field
   * outside of the HTTP auth extraction layer).
   */
  readonly principal?: { id: string; role: "admin" };
};
