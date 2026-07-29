// pattern: functional-core
import ipaddr from "ipaddr.js";
import * as dns from "node:dns";
import { isIP } from "node:net";

export type UrlValidationResult =
  | { readonly ok: true; readonly resolvedIp: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolves a hostname to its IP addresses using dns.resolve4/dns.resolve6.
 * Uses DNS-only resolution (NOT dns.lookup, which reads /etc/hosts via
 * getaddrinfo) for predictable, environment-independent results.
 * Returns all resolved addresses (both IPv4 and IPv6).
 */
export function resolveHostIps(hostname: string): Promise<string[]> {
  return new Promise((resolve) => {
    Promise.allSettled([
      new Promise<string[]>((r, j) =>
        dns.resolve4(hostname, (err, addrs) =>
          err ? j(err) : r(addrs),
        ),
      ),
      new Promise<string[]>((r, j) =>
        dns.resolve6(hostname, (err, addrs) =>
          err ? j(err) : r(addrs),
        ),
      ),
    ]).then((results) => {
      const ips: string[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") ips.push(...r.value);
      }
      resolve(ips);
    });
  });
}

/**
 * Returns true if the IP address is in a private, loopback, link-local,
 * multicast, or reserved range that should never receive outbound requests.
 *
 * Uses ipaddr.js for comprehensive range checking — correctly handles:
 * - IPv4: loopback, private, link-local, multicast, reserved, CGNAT,
 *   documentation, benchmarking, unspecified
 * - IPv6: loopback, link-local, ULA, multicast, unspecified
 * - IPv4-mapped IPv6 in ALL forms: decimal (::ffff:127.0.0.1)
 *   AND hex (::ffff:7f00:1)
 * - Abbreviated IPv6 forms (::1, 0:0:0:0:0:0:0:1)
 *
 * ipaddr.js range() returns "unicast" for public routable addresses and
 * "private", "loopback", "linkLocal", "reserved", "multicast", "uniqueLocal",
 * etc. for non-routable ranges. Only "unicast" is allowed; everything else
 * is blocked.
 *
 * Fails closed: unparseable strings return true (treated as unsafe/blocked).
 */
export function isPrivateIp(ip: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    // IPv4-mapped IPv6 (e.g., ::ffff:93.184.216.34) has range "ipv4Mapped",
    // not "unicast" — must unwrap and check the underlying IPv4 address.
    if (addr instanceof ipaddr.IPv6 && (addr as any).isIPv4MappedAddress?.()) {
      return (addr as any).toIPv4Address().range() !== "unicast";
    }
    return addr.range() !== "unicast"; // "unicast" = public; everything else blocked
  } catch {
    return true; // fail closed on parse error
  }
}

/**
 * Validates that a URL is safe for outbound requests.
 *
 * Rejects:
 * - Non-HTTP(S) schemes (file://, ftp://, etc.)
 * - URLs whose hostname resolves ONLY to private/loopback/link-local/
 *   multicast/reserved IPs
 *
 * Returns the resolved public IP as `resolvedIp` for DNS pinning in
 * guardedFetch. If DNS returns multiple IPs (mix of public and private),
 * the first public IP is used for pinning — private IPs are ignored.
 * If ALL resolved IPs are private/reserved, the URL is rejected.
 *
 * The optional `resolve` parameter allows injecting a custom DNS resolver
 * (for testing). Defaults to resolveHostIps.
 */
export async function validateOutboundUrl(
  url: string,
  resolve: (hostname: string) => Promise<string[]> = resolveHostIps,
): Promise<UrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `invalid URL: ${url}` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `non-HTTP(S) scheme rejected: ${parsed.protocol}`,
    };
  }

  // Strip IPv6 brackets: URL.hostname may return [::1] as "[::1]" — normalize.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // If hostname is already an IP literal, validate directly (no DNS lookup)
  if (isIP(hostname) !== 0) {
    if (isPrivateIp(hostname)) {
      return {
        ok: false,
        reason: `IP address ${hostname} is in a private/reserved range`,
      };
    }
    return { ok: true, resolvedIp: hostname };
  }

  // Resolve hostname via DNS and validate resulting IPs
  let ips: string[];
  try {
    ips = await resolve(hostname);
  } catch {
    return { ok: false, reason: `DNS resolution failed for ${hostname}` };
  }

  if (ips.length === 0) {
    return { ok: false, reason: `no DNS records for ${hostname}` };
  }

  // Find first public IP for DNS pinning; reject only if ALL IPs are private.
  // With DNS pinning, we connect to this specific IP, so private IPs in the
  // DNS response are irrelevant — they are never used for the connection.
  const publicIp = ips.find((ip) => !isPrivateIp(ip));
  if (!publicIp) {
    return {
      ok: false,
      reason: `hostname ${hostname} resolves only to private/reserved IPs: ${ips.join(", ")}`,
    };
  }

  return { ok: true, resolvedIp: publicIp };
}
