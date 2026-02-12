import { initTRPC } from "@trpc/server";
import type { AppContext } from "./context";

const t = initTRPC.context<AppContext>().create();

/**
 * tRPC router factory for creating nested route definitions.
 */
export const router = t.router;

/**
 * tRPC public procedure factory for defining queries and mutations.
 */
export const publicProcedure = t.procedure;

/**
 * tRPC caller factory for calling procedures directly without HTTP transport.
 * Useful for testing procedures in isolation.
 */
export const createCallerFactory = t.createCallerFactory;
