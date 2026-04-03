import { lookup } from 'node:dns/promises';

export interface OutboundUrlPolicyOptions {
  allowedHosts?: readonly string[];
  allowedProtocols?: readonly ('http:' | 'https:')[];
  invalidUrlErrorCode?: string;
  hostMismatchErrorCode?: string;
  blockedPrivateIpErrorCode?: string;
  dnsFailureErrorCode?: string;
}

export interface OutboundUrlValidationSuccess {
  ok: true;
  url: URL;
  hostname: string;
}

export interface OutboundUrlValidationFailure {
  ok: false;
  errorCode: string;
  errorMessage: string;
}

export type OutboundUrlValidationResult =
  | OutboundUrlValidationSuccess
  | OutboundUrlValidationFailure;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254',
  '::1',
]);

function stripBrackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function normalizeHostname(hostname: string): string {
  return stripBrackets(hostname).trim().toLowerCase();
}

function failure(errorCode: string, errorMessage: string): OutboundUrlValidationFailure {
  return {
    ok: false,
    errorCode,
    errorMessage,
  };
}

function isPrivateIPv4(parts: number[]): boolean {
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const lower = normalizeHostname(address);

  if (lower.startsWith('::ffff:')) {
    const embedded = lower.slice(7);
    const dotParts = embedded.split('.').map(Number);
    if (dotParts.length === 4 && dotParts.every((part) => !Number.isNaN(part))) {
      return isPrivateIPv4(dotParts);
    }

    const hexParts = embedded.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0] ?? '', 16);
      const lo = parseInt(hexParts[1] ?? '', 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        return isPrivateIPv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
      }
    }
  }

  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;

  const firstSegment = lower.split(':')[0] ?? '';
  if (firstSegment.startsWith('fc') || firstSegment.startsWith('fd')) return true;
  if (
    firstSegment.startsWith('fe8') ||
    firstSegment.startsWith('fe9') ||
    firstSegment.startsWith('fea') ||
    firstSegment.startsWith('feb')
  ) {
    return true;
  }

  return false;
}

function isPrivateIP(address: string): boolean {
  const normalized = normalizeHostname(address);
  const ipv4Parts = normalized.split('.').map(Number);
  if (ipv4Parts.length === 4 && ipv4Parts.every((part) => !Number.isNaN(part))) {
    return isPrivateIPv4(ipv4Parts);
  }
  return isPrivateIPv6(normalized);
}

function isPublicIpLiteral(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  const ipv4Parts = normalized.split('.').map(Number);
  if (ipv4Parts.length === 4 && ipv4Parts.every((part) => !Number.isNaN(part))) {
    return !isPrivateIPv4(ipv4Parts);
  }

  if (normalized.includes(':')) {
    return !isPrivateIPv6(normalized);
  }

  return false;
}

function resolveAllowedHosts(allowedHosts?: readonly string[]): Set<string> | null {
  if (!allowedHosts || allowedHosts.length === 0) return null;

  const hosts = allowedHosts
    .map((host) => normalizeHostname(host))
    .filter(Boolean);

  return hosts.length > 0 ? new Set(hosts) : null;
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (!normalized) return false;
  if (normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return isLoopbackAddress(normalized.slice(7));

  const ipv4Parts = normalized.split('.').map(Number);
  return (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => !Number.isNaN(part)) &&
    ipv4Parts[0] === 127
  );
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return BLOCKED_HOSTNAMES.has(normalized) || isLoopbackAddress(normalized);
}

export function validateOutboundUrlSync(
  raw: string,
  options: OutboundUrlPolicyOptions = {},
): OutboundUrlValidationResult {
  const {
    allowedProtocols = ['http:', 'https:'],
    invalidUrlErrorCode = 'invalid_url',
    hostMismatchErrorCode = 'blocked_host_mismatch',
    blockedPrivateIpErrorCode = 'blocked_private_ip',
  } = options;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return failure(invalidUrlErrorCode, 'URL is malformed');
  }

  if (!allowedProtocols.includes(parsed.protocol as 'http:' | 'https:')) {
    return failure(invalidUrlErrorCode, `Unsupported URL protocol: ${parsed.protocol}`);
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    return failure(invalidUrlErrorCode, 'URL hostname is missing');
  }

  const allowedHostSet = resolveAllowedHosts(options.allowedHosts);
  if (allowedHostSet && !allowedHostSet.has(hostname)) {
    return failure(hostMismatchErrorCode, `Host is not allowed: ${hostname}`);
  }

  if (isLoopbackHostname(hostname) || isPrivateIP(hostname)) {
    return failure(blockedPrivateIpErrorCode, `Blocked private or loopback address: ${hostname}`);
  }

  return {
    ok: true,
    url: parsed,
    hostname,
  };
}

export async function validateOutboundUrl(
  raw: string,
  options: OutboundUrlPolicyOptions = {},
): Promise<OutboundUrlValidationResult> {
  const syncResult = validateOutboundUrlSync(raw, options);
  if (!syncResult.ok) return syncResult;

  if (isPublicIpLiteral(syncResult.hostname)) {
    return syncResult;
  }

  const dnsFailureErrorCode = options.dnsFailureErrorCode ?? 'dns_resolution_failed';
  const blockedPrivateIpErrorCode = options.blockedPrivateIpErrorCode ?? 'blocked_private_ip';

  try {
    const results = await lookup(syncResult.hostname, { all: true, verbatim: true });
    if (results.length === 0) {
      return failure(dnsFailureErrorCode, `DNS resolution returned no addresses for ${syncResult.hostname}`);
    }

    for (const result of results) {
      if (isPrivateIP(result.address)) {
        return failure(
          blockedPrivateIpErrorCode,
          `Hostname resolves to a private or loopback address: ${result.address}`,
        );
      }
    }

    return syncResult;
  } catch {
    return failure(dnsFailureErrorCode, `DNS resolution failed for ${syncResult.hostname}`);
  }
}

export function resolveRedirectTarget(currentUrl: URL, locationHeader: string): URL | null {
  try {
    return new URL(locationHeader, currentUrl);
  } catch {
    return null;
  }
}

export function isUrlAllowed(raw: string): boolean {
  return validateOutboundUrlSync(raw).ok;
}

export async function isUrlAllowedAsync(raw: string): Promise<boolean> {
  return (await validateOutboundUrl(raw)).ok;
}
