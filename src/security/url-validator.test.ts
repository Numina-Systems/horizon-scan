import { describe, it, expect, vi } from "vitest";
import {
  isPrivateIp,
  validateOutboundUrl,
} from "./url-validator";

// ---------------------------------------------------------------------------
// isPrivateIp — pure unit tests (no mocks, uses ipaddr.js internally)
// ---------------------------------------------------------------------------

describe("isPrivateIp", () => {
  it("returns false for public IPv4 addresses", () => {
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });

  it("returns true for loopback IPv4", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("127.255.255.255")).toBe(true);
  });

  it("returns true for private 10.x range", () => {
    expect(isPrivateIp("10.1.2.3")).toBe(true);
  });

  it("returns true for private 172.16-31.x range", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
  });

  it("returns false for 172.15.x (outside private range)", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false);
  });

  it("returns false for 172.32.x (outside private range)", () => {
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("returns true for private 192.168.x range", () => {
    expect(isPrivateIp("192.168.1.1")).toBe(true);
  });

  it("returns true for link-local addresses", () => {
    expect(isPrivateIp("169.254.1.1")).toBe(true);
  });

  it("returns true for cloud-metadata IP", () => {
    expect(isPrivateIp("169.254.169.254")).toBe(true);
  });

  it("returns true for multicast IPv4", () => {
    expect(isPrivateIp("224.0.0.1")).toBe(true);
  });

  it("returns true for reserved IPv4", () => {
    expect(isPrivateIp("240.0.0.1")).toBe(true);
  });

  it("returns true for unspecified IPv4", () => {
    expect(isPrivateIp("0.0.0.0")).toBe(true);
  });

  it("returns true for CGNAT range", () => {
    expect(isPrivateIp("100.64.0.1")).toBe(true);
  });

  it("returns false for 100.63.x (outside CGNAT)", () => {
    expect(isPrivateIp("100.63.255.255")).toBe(false);
  });

  it("returns false for public IPv6", () => {
    expect(isPrivateIp("2606:4700::6810:85e5")).toBe(false);
  });

  it("returns true for loopback IPv6", () => {
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("returns true for link-local IPv6", () => {
    expect(isPrivateIp("fe80::1")).toBe(true);
  });

  it("returns true for ULA IPv6", () => {
    expect(isPrivateIp("fd00::1")).toBe(true);
  });

  it("returns true for multicast IPv6", () => {
    expect(isPrivateIp("ff02::1")).toBe(true);
  });

  it("returns true for unspecified IPv6", () => {
    expect(isPrivateIp("::")).toBe(true);
  });

  it("returns true for IPv4-mapped loopback (decimal form)", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("returns true for IPv4-mapped loopback (hex form)", () => {
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
  });

  it("returns false for IPv4-mapped public (decimal form)", () => {
    expect(isPrivateIp("::ffff:93.184.216.34")).toBe(false);
  });

  it("returns false for IPv4-mapped public (hex form)", () => {
    expect(isPrivateIp("::ffff:5db8:d822")).toBe(false);
  });

  it("returns true for IPv4-mapped private (hex form)", () => {
    expect(isPrivateIp("::ffff:a00:1")).toBe(true);
  });

  it("returns true for abbreviated loopback IPv6", () => {
    expect(isPrivateIp("0:0:0:0:0:0:0:1")).toBe(true);
  });

  it("fails closed on invalid IP strings", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
  });

  it("fails closed on empty string", () => {
    expect(isPrivateIp("")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateOutboundUrl — inject mock resolver for DNS
// ---------------------------------------------------------------------------

describe("validateOutboundUrl", () => {
  // --- AC.B.5: Non-HTTP(S) schemes rejected ---
  it("rejects file:// scheme", async () => {
    const result = await validateOutboundUrl("file:///etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/non-HTTP.*scheme/);
    }
  });

  it("rejects ftp:// scheme", async () => {
    const result = await validateOutboundUrl("ftp://example.com/file");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/non-HTTP.*scheme/);
    }
  });

  // --- AC.B.1: Private/reserved addresses rejected ---
  it("rejects http://127.0.0.1/admin (IP literal)", async () => {
    const result = await validateOutboundUrl("http://127.0.0.1/admin");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/127\.0\.0\.1/);
      expect(result.reason).toMatch(/private|reserved/);
    }
  });

  it("rejects http://localhost/admin (hostname resolves to private)", async () => {
    const mockResolve = vi.fn().mockResolvedValue(["127.0.0.1"]);
    const result = await validateOutboundUrl(
      "http://localhost/admin",
      mockResolve,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/resolves only to private.*127\.0\.0\.1/);
    }
  });

  it("rejects http://10.0.0.1/internal (IP literal)", async () => {
    const result = await validateOutboundUrl("http://10.0.0.1/internal");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/10\.0\.0\.1/);
      expect(result.reason).toMatch(/private|reserved/);
    }
  });

  it("rejects http://172.16.0.1/internal (IP literal)", async () => {
    const result = await validateOutboundUrl("http://172.16.0.1/internal");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/172\.16/);
      expect(result.reason).toMatch(/private|reserved/);
    }
  });

  it("rejects http://192.168.1.1/internal (IP literal)", async () => {
    const result = await validateOutboundUrl("http://192.168.1.1/internal");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/192\.168/);
      expect(result.reason).toMatch(/private|reserved/);
    }
  });

  it("rejects http://169.254.169.254/latest/meta-data/ (cloud metadata)", async () => {
    const result = await validateOutboundUrl(
      "http://169.254.169.254/latest/meta-data/",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/169\.254\.169\.254/);
      expect(result.reason).toMatch(/private|reserved/);
    }
  });

  it("rejects http://[::1]/ (IPv6 loopback with brackets)", async () => {
    const result = await validateOutboundUrl("http://[::1]/");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/private|reserved/);
    }
  });

  it("rejects http://[::ffff:7f00:1]/ (IPv4-mapped hex with brackets)", async () => {
    const result = await validateOutboundUrl("http://[::ffff:7f00:1]/");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/private|reserved/);
    }
  });

  it("rejects hostname resolving to ALL private IPs", async () => {
    const mockResolve = vi.fn().mockResolvedValue(["10.0.0.1", "10.0.0.2"]);
    const result = await validateOutboundUrl(
      "https://internal.example.com/admin",
      mockResolve,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/resolves only to private/);
    }
  });

  it("accepts hostname with mixed public + private IPs, pins to public", async () => {
    const mockResolve = vi
      .fn()
      .mockResolvedValue(["93.184.216.34", "10.0.0.1"]);
    const result = await validateOutboundUrl(
      "https://mixed.example.com/feed",
      mockResolve,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedIp).toBe("93.184.216.34");
    }
  });

  // --- AC.B.5: Malformed URLs rejected ---
  it("rejects malformed URL string", async () => {
    const result = await validateOutboundUrl("not a url");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/invalid URL/);
    }
  });

  it("rejects DNS failure", async () => {
    const mockResolve = vi
      .fn()
      .mockRejectedValue(new Error("ENOTFOUND"));
    const result = await validateOutboundUrl(
      "https://nonexistent.example.com/feed",
      mockResolve,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/DNS resolution failed/);
    }
  });

  it("rejects empty DNS result", async () => {
    const mockResolve = vi.fn().mockResolvedValue([]);
    const result = await validateOutboundUrl(
      "https://no-dns.example.com/feed",
      mockResolve,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no DNS records/);
    }
  });

  // --- AC.B.6: Valid public URLs accepted ---
  it("accepts http://93.184.216.34/ (public IP literal)", async () => {
    const result = await validateOutboundUrl("http://93.184.216.34/");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedIp).toBe("93.184.216.34");
    }
  });

  it("accepts https://example.com/feed.xml (public hostname)", async () => {
    const mockResolve = vi.fn().mockResolvedValue(["93.184.216.34"]);
    const result = await validateOutboundUrl(
      "https://example.com/feed.xml",
      mockResolve,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedIp).toBe("93.184.216.34");
    }
  });

  it("accepts hostname resolving to public IPv6", async () => {
    const mockResolve = vi.fn().mockResolvedValue(["2606:4700::1"]);
    const result = await validateOutboundUrl(
      "https://ipv6.example.com/feed",
      mockResolve,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedIp).toBe("2606:4700::1");
    }
  });
});

// ---------------------------------------------------------------------------
// resolveHostIps — test via dependency injection in validateOutboundUrl
// (cannot spy on node:dns ESM namespace directly; use the injected resolver)
// ---------------------------------------------------------------------------

describe("resolveHostIps (via validateOutboundUrl injection)", () => {
  it("uses injected resolver and combines IPv4 + IPv6 results", async () => {
    const mockResolve = vi
      .fn()
      .mockResolvedValue(["1.2.3.4", "::1"]);
    const result = await validateOutboundUrl(
      "https://dualstack.example.com/feed",
      mockResolve,
    );
    expect(mockResolve).toHaveBeenCalledWith("dualstack.example.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // First public IP is used for pinning
      expect(result.resolvedIp).toBe("1.2.3.4");
    }
  });

  it("rejects when resolver returns only private IPs (empty for public)", async () => {
    const mockResolve = vi.fn().mockResolvedValue(["127.0.0.1"]);
    const result = await validateOutboundUrl(
      "https://localhost.example.com/feed",
      mockResolve,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when resolver throws", async () => {
    const mockResolve = vi
      .fn()
      .mockRejectedValue(new Error("ENOTFOUND"));
    const result = await validateOutboundUrl(
      "https://bad.example.com/feed",
      mockResolve,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/DNS resolution failed/);
    }
  });

  it("rejects when resolver returns empty array", async () => {
    const mockResolve = vi.fn().mockResolvedValue([]);
    const result = await validateOutboundUrl(
      "https://no-dns.example.com/feed",
      mockResolve,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no DNS records/);
    }
  });
});
