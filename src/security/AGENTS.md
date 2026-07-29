# Security

Last verified: 2026-07-29

## Purpose
SSRF prevention and response amplification protection for all outbound HTTP requests.

## Contracts
- **Exposes**: `validateOutboundUrl(url, resolveFn?)`, `guardedFetch(url, options)`, `isPrivateIp(ip)`
- **Guarantees**: All outbound requests validate destination IP (rejecting private/loopback/link-local/reserved), pin DNS via undici Agent (eliminates TOCTOU DNS rebinding), validate each redirect hop, cap response bytes mid-stream, and enforce max redirect count.
- **Expects**: `ipaddr.js` and `undici` npm packages installed.

## Key Design Decisions
- **ipaddr.js**: Used for comprehensive IP range checking. Handles IPv4, IPv6, and IPv4-mapped IPv6 in all forms (decimal and hex). `range() !== "unicast"` determines private/public.
- **DNS pinning**: `guardedFetch` creates an undici `Agent` with a custom `connect.lookup` that returns the pre-validated IP. TLS SNI/cert verification preserved (undici uses original URL hostname).
- **DNS resolution**: Uses `dns.resolve4`/`dns.resolve6` (DNS-only, no `/etc/hosts`).
- **Feed fetching**: Uses `guardedFetch` + `parser.parseString(xml)` instead of `parseURL(url)` — rss-parser never makes its own network requests.

## Key Files
- `url-validator.ts` - `isPrivateIp`, `resolveHostIps`, `validateOutboundUrl`
- `fetch-guard.ts` - `guardedFetch` with 4 security layers

## Config
- `security.maxResponseBytes` (default 10MB)
- `security.maxFeedItems` (default 500)
- `security.maxRedirects` (default 5)
