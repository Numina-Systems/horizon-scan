import { describe, it, expect, vi } from "vitest";
import { guardedFetch } from "./fetch-guard";

// ---------------------------------------------------------------------------
// Helper: create a mock ReadableStream from chunks
// ---------------------------------------------------------------------------

function createMockStream(
  chunks: Uint8Array[],
): ReadableStream<Uint8Array> & { cancelled: boolean } {
  let cancelled = false;
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (cancelled) return;
      if (i < chunks.length) {
        controller.enqueue(chunks[i]);
        i++;
      } else {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  }) as ReadableStream<Uint8Array> & { cancelled: boolean };
  Object.defineProperty(stream, "cancelled", {
    get: () => cancelled,
  });
  return stream;
}

// ---------------------------------------------------------------------------
// Helper: create a mock Response
// ---------------------------------------------------------------------------

function mockResponse(
  status: number,
  statusText: string,
  options: {
    body?: ReadableStream<Uint8Array>;
    headers?: Record<string, string>;
  } = {},
): Response {
  const { body, headers = {} } = options;
  const resp = {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(headers),
    body: body ?? null,
  };
  return resp as unknown as Response;
}

// ---------------------------------------------------------------------------
// Helper: create mock agent factory (must be a constructor — called with `new`)
// ---------------------------------------------------------------------------

function createMockAgentFactory() {
  const configs: Array<Record<string, unknown>> = [];
  const destroyed: number[] = [];
  const allAgents: { id: number; destroy: () => void }[] = [];
  let agentId = 0;

  // Must be a `function` (not arrow) because guardedFetch calls `new AgentFactory(...)`
  const factory = vi.fn(function MockAgent(this: any, config: Record<string, unknown>) {
    configs.push(config);
    const id = ++agentId;
    const agent = {
      id,
      destroy() {
        destroyed.push(id);
      },
    };
    allAgents.push(agent);
    return agent;
  });

  return { factory, configs, destroyed, allAgents };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("guardedFetch", () => {
  it("successful fetch of public URL (AC.B.6)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        mockResponse(200, "OK", {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("hello"));
              controller.close();
            },
          }),
        }),
      );

    const mockAgent = createMockAgentFactory();

    const result = await guardedFetch("https://example.com/page", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "93.184.216.34" }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe("hello");
      expect(result.status).toBe(200);
    }
  });

  it("rejects when URL validation fails (private IP) (AC.B.1)", async () => {
    const mockFetch = vi.fn();
    const mockAgent = createMockAgentFactory();

    const result = await guardedFetch("http://10.0.0.1/admin", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi.fn().mockResolvedValue({
        ok: false,
        reason: "IP address 10.0.0.1 is in a private/reserved range",
      }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("private");
    }
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockAgent.factory).not.toHaveBeenCalled();
  });

  it("creates pinned Agent with validated IP (DNS pinning)", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(200, "OK", {
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      }),
    );

    await guardedFetch("https://example.com/page", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "93.184.216.34" }),
      createAgent: mockAgent.factory as any,
    });

    expect(mockAgent.configs).toHaveLength(1);
    const lookupFn = (mockAgent.configs[0] as any)?.connect?.lookup;
    expect(lookupFn).toBeDefined();

    let lookupResult: unknown;
    lookupFn("any-host", {}, (_err: unknown, result: unknown) => {
      lookupResult = result;
    });
    expect(lookupResult).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("creates pinned Agent with IPv6 family", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(200, "OK", {
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      }),
    );

    await guardedFetch("https://ipv6.example.com/page", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi.fn().mockResolvedValue({ ok: true, resolvedIp: "2606:4700::1" }),
      createAgent: mockAgent.factory as any,
    });

    const lookupFn = (mockAgent.configs[0] as any)?.connect?.lookup;
    let lookupResult: unknown;
    lookupFn("any-host", {}, (_err: unknown, result: unknown) => {
      lookupResult = result;
    });
    expect(lookupResult).toEqual([
      { address: "2606:4700::1", family: 6 },
    ]);
  });

  it("passes dispatcher to fetch", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(200, "OK", {
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      }),
    );

    await guardedFetch("https://example.com/page", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchArgs = mockFetch.mock.calls[0];
    const options = fetchArgs?.[1] as Record<string, unknown>;
    expect(options["dispatcher"]).toBeDefined();
    expect(options["dispatcher"]).toBe(mockAgent.allAgents[0]);
  });

  it("follows valid redirect, validates each hop (AC.B.2)", async () => {
    const mockAgent = createMockAgentFactory();

    const validateUrl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, resolvedIp: "1.2.3.4" })
      .mockResolvedValueOnce({ ok: true, resolvedIp: "5.6.7.8" });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(301, "Moved Permanently", {
          headers: { location: "https://other.example.com/page" },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse(200, "OK", {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("redirected!"));
              controller.close();
            },
          }),
        }),
      );

    const result = await guardedFetch("https://example.com/old", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl,
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(true);
    expect(validateUrl).toHaveBeenCalledTimes(2);
    expect(mockAgent.factory).toHaveBeenCalledTimes(2);
  });

  it("rejects redirect to private IP (AC.B.2)", async () => {
    const mockAgent = createMockAgentFactory();

    const validateUrl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, resolvedIp: "1.2.3.4" })
      .mockResolvedValueOnce({ ok: false, reason: "private 10.0.0.1" });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(301, "Moved Permanently", {
          headers: { location: "http://10.0.0.1/admin" },
        }),
      )
      // Second fetch should NOT be called
      .mockResolvedValue(
        mockResponse(200, "OK", {
          body: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        }),
      );

    const result = await guardedFetch("https://example.com/redirect", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl,
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("10.0.0.1");
    }
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only the first fetch
  });

  it("rejects too many redirects (AC.B.2)", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(301, "Moved Permanently", {
        headers: { location: "https://example.com/redirect-again" },
      }),
    );

    const result = await guardedFetch("https://example.com/start", {
      maxBytes: 1000,
      maxRedirects: 2,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("exceeded max redirects");
    }
  });

  it("aborts oversized response mid-stream (AC.B.3)", async () => {
    const mockAgent = createMockAgentFactory();

    const bigData = new Uint8Array(200);
    const stream = createMockStream([bigData]);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(mockResponse(200, "OK", { body: stream }));

    const result = await guardedFetch("https://example.com/big", {
      maxBytes: 100,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("exceeds maxBytes");
    }
  });

  it("accepts response exactly at maxBytes (AC.B.3)", async () => {
    const mockAgent = createMockAgentFactory();

    const exactData = new TextEncoder().encode("a".repeat(100));
    const stream = createMockStream([exactData]);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(mockResponse(200, "OK", { body: stream }));

    const result = await guardedFetch("https://example.com/exact", {
      maxBytes: 100,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.length).toBe(100);
    }
  });

  it("returns HTTP error status", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockResolvedValue(mockResponse(403, "Forbidden"));

    const result = await guardedFetch("https://example.com/forbidden", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("403");
    }
  });

  it("catches network error", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await guardedFetch("https://example.com/down", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ECONNREFUSED");
    }
  });

  it("handles redirect without Location header", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockResolvedValue(mockResponse(301, "Moved"));

    const result = await guardedFetch("https://example.com/nolocation", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("without Location header");
    }
  });

  it("resolves relative redirect (AC.B.2)", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(302, "Found", {
          headers: { location: "/page2" },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse(200, "OK", {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("page2"));
              controller.close();
            },
          }),
        }),
      );

    await guardedFetch("https://example.com/page1", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    // Second fetch should be called with absolute URL
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondUrl = mockFetch.mock.calls[1]?.[0];
    expect(secondUrl).toBe("https://example.com/page2");
  });

  it("rejects when Content-Length exceeds maxBytes (AC.B.3)", async () => {
    const mockAgent = createMockAgentFactory();

    const stream = createMockStream([new Uint8Array(0)]);
    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(200, "OK", {
        body: stream,
        headers: { "content-length": "200" },
      }),
    );

    const result = await guardedFetch("https://example.com/oversized", {
      maxBytes: 100,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Content-Length");
      expect(result.error).toContain("exceeds maxBytes");
    }
  });

  it("fails closed when no streamable body (AC.B.3)", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(200, "OK", {
        body: undefined as unknown as ReadableStream<Uint8Array>,
      }),
    );

    const result = await guardedFetch("https://example.com/nobody", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no streamable body");
    }
  });

  it("destroys agent after successful fetch (agent lifecycle)", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(200, "OK", {
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      }),
    );

    await guardedFetch("https://example.com/page", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(mockAgent.destroyed).toHaveLength(1);
  });

  it("destroys agent even on fetch error (agent lifecycle)", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));

    await guardedFetch("https://example.com/fail", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    expect(mockAgent.destroyed).toHaveLength(1);
  });

  it("should destroy agent when Location header is malformed", async () => {
    const mockAgent = createMockAgentFactory();

    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(301, "Moved Permanently", {
        headers: { location: "http://[" },
      }),
    );

    const result = await guardedFetch("https://example.com/redirect", {
      maxBytes: 1000,
      maxRedirects: 5,
      fetchImpl: mockFetch,
      validateUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, resolvedIp: "1.2.3.4" }),
      createAgent: mockAgent.factory as any,
    });

    // The malformed Location ("http://[") makes new URL() throw;
    // the catch/finally must still destroy the agent.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
    expect(mockAgent.destroyed).toHaveLength(1);
  });
});
