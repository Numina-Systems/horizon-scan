import type { LanguageModel } from "ai";
import type { AppConfig } from "../config";
import { getModel } from "./providers";

export function createLlmClient(config: AppConfig): LanguageModel {
  return getModel(config.llm.provider, config.llm.model);
}
