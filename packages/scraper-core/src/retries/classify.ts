import type { ErrorClass } from '@rei/contracts';

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

/** HTTP status codes that indicate the listing itself is gone. */
const TERMINAL_STATUS_CODES = new Set([404, 410]);

/** HTTP status codes that indicate a soft anti-bot response. */
const ANTI_BOT_STATUS_CODES = new Set([403, 429, 503]);

/**
 * Classify a scraper error into one of the defined ErrorClass categories.
 *
 * Classification order:
 * 1. Terminal page states (404, 410, listing-removed indicators)
 * 2. Soft anti-bot signals (403, 429, challenge page indicators)
 * 3. Transient network errors (timeouts, DNS, connection failures)
 * 4. Parse failures (selector not found, validation errors)
 * 5. Unknown (fallback)
 */
export function classifyScraperError(error: unknown): ErrorClass {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Terminal page state
    if (isTerminalPageError(message, error)) {
      return 'terminal_page';
    }

    // Soft anti-bot
    if (isAntiBot(message, error)) {
      return 'soft_anti_bot';
    }

    // Transient network
    if (isTransientNetwork(message, name)) {
      return 'transient_network';
    }

    // Parse failure
    if (isParseFailure(message, name)) {
      return 'parse_failure';
    }
  }

  // Non-Error objects with status code
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = (error as { statusCode: number }).statusCode;
    if (TERMINAL_STATUS_CODES.has(statusCode)) return 'terminal_page';
    if (ANTI_BOT_STATUS_CODES.has(statusCode)) return 'soft_anti_bot';
  }

  return 'unknown';
}

function isTerminalPageError(message: string, error: Error): boolean {
  // Check for HTTP status-based terminal states
  if (hasHttpStatus(error, TERMINAL_STATUS_CODES)) return true;

  // Check for listing-removed indicators
  const terminalPatterns = [
    'listing removed',
    'listing not found',
    'anzeige nicht gefunden',
    'inserat wurde entfernt',
    'diese anzeige ist nicht mehr',
    'not found',
    'page not found',
  ];
  return terminalPatterns.some((p) => message.includes(p));
}

function isAntiBot(message: string, error: Error): boolean {
  if (hasHttpStatus(error, ANTI_BOT_STATUS_CODES)) return true;
  return CHALLENGE_INDICATORS.some((indicator) => message.includes(indicator));
}

function isTransientNetwork(message: string, name: string): boolean {
  const networkPatterns = [
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

  const networkNames = ['timeouterror', 'aborterror', 'fetcherror'];

  return (
    networkPatterns.some((p) => message.includes(p)) ||
    networkNames.some((n) => name.includes(n))
  );
}

function isParseFailure(message: string, name: string): boolean {
  const parsePatterns = [
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

  const parseNames = ['parseerror', 'validationerror'];

  return (
    parsePatterns.some((p) => message.includes(p)) ||
    parseNames.some((n) => name.includes(n))
  );
}

function hasHttpStatus(error: Error, statusCodes: Set<number>): boolean {
  if ('statusCode' in error && typeof (error as Record<string, unknown>).statusCode === 'number') {
    return statusCodes.has((error as Record<string, unknown>).statusCode as number);
  }
  return false;
}
