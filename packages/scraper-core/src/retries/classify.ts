import type { ErrorClass } from '@immoradar/contracts';

/** Strings that typically indicate an anti-bot challenge page. */
const CHALLENGE_INDICATORS = [
  'captcha',
  'challenge',
  'verify you are human',
  'just a moment',
  'checking your browser',
  'access denied',
  'please enable javascript',
  'bot protection',
  'ddos protection',
  'cloudflare',
  'datadome',
];

/**
 * Message fragments that say the listing itself is gone. A bare "not found" is not one of them:
 * it also ends "selector not found" and "element not found", which are parse failures.
 */
const TERMINAL_PATTERNS = [
  'listing removed',
  'listing not found',
  'anzeige nicht gefunden',
  'inserat wurde entfernt',
  'diese anzeige ist nicht mehr',
  'page not found',
];

const NETWORK_PATTERNS = [
  'timeout',
  'timedout',
  'econnreset',
  'econnrefused',
  'econnaborted',
  'epipe',
  'enetunreach',
  'ehostunreach',
  'enotfound',
  'dns',
  'socket hang up',
  'network error',
  'fetch failed',
  'navigation timeout',
  'target closed',
  'browser disconnected',
  'browser closed',
  'context closed',
  'page closed',
];

const NETWORK_NAMES = ['timeouterror', 'aborterror', 'fetcherror'];

/**
 * Playwright's messages for a page, context or browser of ours that closed or crashed. "page
 * crashed" covers both "Page crashed" and "Navigation failed because page crashed!".
 */
const INTERNAL_PATTERNS = [
  'target page, context or browser has been closed',
  'page crashed',
  'target crashed',
];

/** A closed-target error can carry the close reason as its message, so its name counts too. */
const INTERNAL_NAMES = ['targetclosederror'];

const PARSE_PATTERNS = [
  'selector not found',
  'element not found',
  'failed to extract',
  'parse error',
  'validation failed',
  'invalid json',
  'unexpected token',
  'schema validation',
  'missing required field',
];

const PARSE_NAMES = ['parseerror', 'validationerror'];

/** HTTP status codes that indicate the listing itself is gone. */
const TERMINAL_STATUS_CODES = new Set([404, 410]);

/** HTTP status codes that indicate a soft anti-bot response. */
const ANTI_BOT_STATUS_CODES = new Set([403, 429, 503]);

function statusCodeOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return null;
  return typeof error.statusCode === 'number' ? error.statusCode : null;
}

function classifyStatus(statusCode: number): ErrorClass | null {
  if (TERMINAL_STATUS_CODES.has(statusCode)) return 'terminal_page';
  if (ANTI_BOT_STATUS_CODES.has(statusCode)) return 'soft_anti_bot';
  if (statusCode >= 500 && statusCode <= 599) return 'transient_network';
  return null;
}

function includesAny(text: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => text.includes(fragment));
}

/**
 * Classify a scraper error into one of the defined ErrorClass categories.
 *
 * Classification order:
 * 1. A numeric `statusCode` on the error: 404 and 410 are terminal, 403, 429 and 503 are soft
 *    anti-bot signals, and the other 5xx are transient
 * 2. A page, context or browser of ours that closed or crashed, which is an internal error
 * 3. Chromium network errors (`net::ERR_*`), which are transient
 * 4. Terminal page messages (listing-removed indicators)
 * 5. Soft anti-bot messages (challenge page indicators)
 * 6. Transient network messages (timeouts, DNS, connection failures)
 * 7. Parse failures (selector not found, validation errors)
 * 8. Unknown (fallback)
 */
export function classifyScraperError(error: unknown): ErrorClass {
  const statusCode = statusCodeOf(error);
  const byStatus = statusCode === null ? null : classifyStatus(statusCode);
  if (byStatus) return byStatus;

  if (!(error instanceof Error)) return 'unknown';

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Checked before the text patterns: a closed or crashed page says nothing about the site, and
  // the URL in the message can contain any of the patterns below.
  if (includesAny(message, INTERNAL_PATTERNS) || includesAny(name, INTERNAL_NAMES)) {
    return 'internal_error';
  }
  if (message.includes('net::err_')) return 'transient_network';
  if (includesAny(message, TERMINAL_PATTERNS)) return 'terminal_page';
  if (includesAny(message, CHALLENGE_INDICATORS)) return 'soft_anti_bot';
  if (includesAny(message, NETWORK_PATTERNS) || includesAny(name, NETWORK_NAMES)) {
    return 'transient_network';
  }
  if (includesAny(message, PARSE_PATTERNS) || includesAny(name, PARSE_NAMES)) {
    return 'parse_failure';
  }

  return 'unknown';
}
