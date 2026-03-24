import { lookup } from 'node:dns/promises';
import { createLogger } from '@immoradar/observability';

const log = createLogger('alert:webhook');

export interface WebhookConfig {
  enabled: boolean;
  defaultUrl?: string;
  timeoutMs?: number;
}

/** Blocked hostnames for SSRF prevention. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254', // AWS/cloud metadata
  '[::1]',
  '::1',
]);

/** Returns true if the IPv4 address (as 4-element number array) is private/reserved. */
function isPrivateIPv4(parts: number[]): boolean {
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  return false;
}

/** Returns true if the IPv6 address string (without brackets) is private/reserved. */
function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();

  // IPv4-mapped IPv6 — two forms:
  //   Dotted:  ::ffff:A.B.C.D
  //   Hex:     ::ffff:XXYY:ZZWW  (URL constructor normalizes to this form)
  if (lower.startsWith('::ffff:')) {
    const embedded = lower.slice(7);

    // Dotted-decimal form (::ffff:127.0.0.1)
    const dotParts = embedded.split('.').map(Number);
    if (dotParts.length === 4 && dotParts.every((p) => !Number.isNaN(p))) {
      return isPrivateIPv4(dotParts);
    }

    // Hex form (::ffff:7f00:1 → 127.0.0.1)
    const hexParts = embedded.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0]!, 16);
      const lo = parseInt(hexParts[1]!, 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        const ipv4 = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
        return isPrivateIPv4(ipv4);
      }
    }
  }

  // Loopback ::1
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;

  // Unique-local fc00::/7
  const firstSegment = lower.split(':')[0] ?? '';
  if (firstSegment.startsWith('fc') || firstSegment.startsWith('fd')) return true;

  // Link-local fe80::/10
  if (
    firstSegment.startsWith('fe8') ||
    firstSegment.startsWith('fe9') ||
    firstSegment.startsWith('fea') ||
    firstSegment.startsWith('feb')
  )
    return true;

  return false;
}

/** Returns true if the IP address string is private (handles both v4 and v6). */
function isPrivateIP(ip: string): boolean {
  // IPv4
  const v4parts = ip.split('.').map(Number);
  if (v4parts.length === 4 && v4parts.every((p) => !Number.isNaN(p))) {
    return isPrivateIPv4(v4parts);
  }
  // IPv6
  return isPrivateIPv6(ip);
}

/**
 * Synchronous URL validation against known internal addresses.
 * Does NOT resolve DNS — use `isUrlAllowedAsync` for full protection.
 */
export function isUrlAllowed(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  // Only allow http/https
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false;
  }

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.has(parsed.hostname)) {
    return false;
  }

  // Strip brackets for IPv6 hostnames (URL gives us [::1] as hostname)
  const bare =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;

  // Check IPv6 private ranges
  if (bare.includes(':')) {
    if (isPrivateIPv6(bare)) return false;
  }

  // Check IPv4 private ranges
  const parts = bare.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => !Number.isNaN(p))) {
    if (isPrivateIPv4(parts)) return false;
  }

  return true;
}

/**
 * Full URL validation with DNS rebinding protection.
 * Resolves the hostname and checks all resulting IPs against private ranges.
 * Fails closed: DNS errors result in rejection.
 */
export async function isUrlAllowedAsync(raw: string): Promise<boolean> {
  if (!isUrlAllowed(raw)) return false;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  // Strip brackets for DNS lookup
  const hostname =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;

  // Skip DNS check for raw IP addresses (already checked by isUrlAllowed)
  const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
  const isIPv6 = hostname.includes(':');
  if (isIPv4 || isIPv6) return true;

  try {
    const results = await lookup(hostname, { all: true });
    if (results.length === 0) return false;

    for (const result of results) {
      if (isPrivateIP(result.address)) {
        log.warn('DNS rebinding detected: hostname resolves to private IP', {
          hostname,
          resolvedIp: result.address,
        });
        return false;
      }
    }
    return true;
  } catch {
    // Fail closed: DNS resolution failure means we can't verify safety
    log.warn('DNS resolution failed for webhook URL, rejecting', { hostname });
    return false;
  }
}

/**
 * Send an alert notification via webhook.
 */
export async function sendAlertWebhook(params: {
  url: string;
  payload: Record<string, unknown>;
  config: WebhookConfig;
}): Promise<boolean> {
  if (!params.config.enabled) {
    log.debug('Webhook delivery disabled, skipping');
    return false;
  }

  if (!(await isUrlAllowedAsync(params.url))) {
    log.warn('Webhook URL rejected by SSRF policy', { url: params.url });
    return false;
  }

  try {
    const response = await fetch(params.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.payload),
      signal: AbortSignal.timeout(params.config.timeoutMs ?? 10000),
      redirect: 'manual',
    });

    // Drain response body to avoid socket hang-ups
    const responseText = await response.text();

    if (!response.ok) {
      log.warn('Webhook delivery failed', {
        url: params.url,
        status: response.status,
        bodyPreview: responseText.slice(0, 200),
      });
      return false;
    }

    log.info('Webhook alert sent', { url: params.url, status: response.status });
    return true;
  } catch (err) {
    log.error('Webhook delivery error', {
      url: params.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
