// pattern: imperative-shell
import { isIP } from "node:net";
import { Agent } from "undici";
import { validateOutboundUrl, type UrlValidationResult } from "./url-validator";

export type GuardedFetchOptions = {
  /** Max response body size in bytes. Abort mid-stream if exceeded. */
  readonly maxBytes: number;
  /** Max number of redirect hops to follow. */
  readonly maxRedirects: number;
  /** AbortSignal timeout (caller-provided, same as raw fetch). */
  readonly signal?: AbortSignal;
  /** HTTP headers for the request. */
  readonly headers?: Record<string, string>;
  /** Injectable fetch (for testing). Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable URL validator (for testing). Defaults to validateOutboundUrl. */
  readonly validateUrl?: (url: string) => Promise<UrlValidationResult>;
  /** Injectable Agent factory (for testing DNS pinning). Defaults to undici Agent. */
  readonly createAgent?: typeof Agent;
};

export type GuardedFetchResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly body: string;
      readonly finalUrl: string;
    }
  | { readonly ok: false; readonly error: string; readonly status?: number };

/**
 * Fetches a URL with SSRF protection, DNS pinning, redirect validation,
 * and response size capping.
 *
 * Security layers (applied on every request including redirect hops):
 *
 * 1. URL validation — validateOutboundUrl rejects non-HTTP(S) schemes and
 *    hostnames that resolve only to private/reserved IPs. Returns a validated
 *    public IP (`resolvedIp`).
 *
 * 2. DNS pinning — creates an undici Agent whose connect.lookup function
 *    always returns the validated `resolvedIp`. This eliminates the TOCTOU
 *    DNS rebinding window: the TCP connection uses the validated IP, not a
 *    second DNS lookup. undici preserves TLS SNI/certificate verification
 *    using the original URL hostname.
 *
 * 3. Redirect control — follows redirects manually (redirect: "manual") and
 *    re-validates + re-pins each hop. Enforces maxRedirects count.
 *
 * 4. Response size cap — reads the body in chunks via getReader() and aborts
 *    (reader.cancel()) if total bytes exceed maxBytes. Also pre-checks
 *    Content-Length before reading.
 */
export async function guardedFetch(
  url: string,
  options: GuardedFetchOptions,
): Promise<GuardedFetchResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const validate = options.validateUrl ?? validateOutboundUrl;
  const AgentFactory = options.createAgent ?? Agent;

  let currentUrl = url;
  let redirectCount = 0;

  while (true) {
    // --- Layer 1: URL validation (resolves DNS, returns validated public IP) ---
    const validation = await validate(currentUrl);
    if (!validation.ok) {
      return {
        ok: false,
        error: `URL validation failed: ${validation.reason}`,
      };
    }

    // --- Layer 2: DNS pinning via undici Agent ---
    const ipFamily = isIP(validation.resolvedIp) || 4; // 4 for IPv4, 6 for IPv6
    const pinnedAgent = new AgentFactory({
      connect: {
        lookup: (
          _hostname: string,
          _opts: unknown,
          cb: (err: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void,
        ) => {
          cb(null, [
            { address: validation.resolvedIp, family: ipFamily },
          ]);
        },
      },
    });

    try {
      const response = await doFetch(currentUrl, {
        redirect: "manual",
        signal: options.signal,
        headers: options.headers,
        ...({ dispatcher: pinnedAgent } as Record<string, unknown>),
      });

      // --- Layer 3: redirect control ---
      if (response.status >= 300 && response.status < 400) {
        redirectCount++;
        if (redirectCount > options.maxRedirects) {
          // Cancel redirect response body before returning
          await response.body?.cancel().catch(() => {});
          return {
            ok: false,
            error: `exceeded max redirects (${options.maxRedirects})`,
            status: response.status,
          };
        }
        const location = response.headers.get("location");
        if (!location) {
          await response.body?.cancel().catch(() => {});
          return {
            ok: false,
            error: `redirect status ${response.status} without Location header`,
          };
        }
        // Resolve relative redirects against the current URL
        currentUrl = new URL(location, currentUrl).toString();
        // Consume/cancel redirect response body before following
        await response.body?.cancel().catch(() => {});
        continue; // re-validates + re-pins for the redirect target
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          status: response.status,
        };
      }

      // --- Layer 4: response size cap ---

      // Pre-check Content-Length header — reject before reading if declared size exceeds cap
      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader !== null) {
        const declaredLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(declaredLength) && declaredLength > options.maxBytes) {
          await response.body?.cancel().catch(() => {});
          return {
            ok: false,
            error: `Content-Length ${declaredLength} exceeds maxBytes (${options.maxBytes})`,
            status: response.status,
          };
        }
      }

      // Read body with size cap — abort mid-stream if exceeded
      const reader = response.body?.getReader();
      if (!reader) {
        // No streamable body — fail closed (do NOT call response.text() which buffers fully)
        return {
          ok: false,
          error: "response has no streamable body; cannot enforce size cap",
          status: response.status,
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > options.maxBytes) {
            await reader.cancel();
            return {
              ok: false,
              error: `response body exceeds maxBytes (${options.maxBytes})`,
            };
          }
          chunks.push(value);
        }
      }

      // Concatenate chunks into a single string
      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const bodyText = new TextDecoder().decode(merged);

      return {
        ok: true,
        status: response.status,
        body: bodyText,
        finalUrl: currentUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    } finally {
      pinnedAgent.destroy();
    }
  }
}
