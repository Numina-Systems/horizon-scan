// pattern: Imperative Shell
import { initTRPC, TRPCError } from "@trpc/server";
import type { AppContext } from "./context";

const t = initTRPC.context<AppContext>().create();

/**
 * tRPC router factory for creating nested route definitions.
 */
export const router = t.router;

/**
 * tRPC public procedure factory for defining queries and mutations.
 * Public procedures do not enforce authentication or authorization.
 */
export const publicProcedure = t.procedure;

/**
 * Authentication and authorization enforcement middleware (R2).
 *
 * This middleware serves as BOTH the authentication gate AND the authorization
 * gate for protected procedures:
 *
 * - Authentication: A valid API key (via Authorization: Bearer header) is required.
 *   resolvePrincipal() validates the key and sets ctx.principal on success.
 * - Authorization: The single authorized role is "admin". resolvePrincipal() sets
 *   principal.role = "admin" on valid key. This middleware checks
 *   ctx.principal?.role === "admin" — any non-admin or missing principal is rejected (S2).
 *   A caller without a valid key has principal=undefined → zero permissions → rejected.
 *   A caller with a non-admin role (e.g., "viewer") is also rejected.
 *
 * There is one role ("admin") and it grants full administrative access.
 * This is the complete authorization model for this single-operator tool.
 *
 * Check ordering (F9, S2):
 *   1. If ctx.authKey is absent → dev mode → allow all requests, inject anonymous admin principal.
 *   2. If ctx.authKey is present but ctx.principal?.role !== "admin" → no valid admin role → reject UNAUTHORIZED.
 *   3. If ctx.authKey is present and ctx.principal.role === "admin" → authorized → allow.
 */
const enforceAuth = t.middleware(({ ctx, next }) => {
  // Dev mode: no API key configured → no enforcement, no authorization required
  if (!ctx.authKey) {
    return next({
      ctx: { ...ctx, principal: { id: "anonymous", role: "admin" } },
    });
  }

  // Auth mode: require a valid principal with admin role (authorization gate — S2)
  // Without a valid key → principal is undefined → role !== "admin" → UNAUTHORIZED
  // With a non-admin principal (e.g., role: "viewer") → also UNAUTHORIZED
  if (ctx.principal?.role !== "admin") {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  // Valid key → principal.role = "admin" → authorized for all operations
  return next({ ctx });
});

/**
 * tRPC protected procedure factory.
 * Enforces authentication and authorization: rejects callers without a valid
 * API key when API_KEY is configured. The protectedProcedure IS the authorization
 * boundary — only authenticated callers with the admin role may proceed.
 */
export const protectedProcedure = t.procedure.use(enforceAuth);

/**
 * tRPC caller factory for calling procedures directly without HTTP transport.
 * Useful for testing procedures in isolation.
 */
export const createCallerFactory = t.createCallerFactory;
