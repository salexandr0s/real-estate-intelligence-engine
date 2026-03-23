/**
 * Managed Playwright browser lifecycle.
 * Provides a shared browser instance with context creation for scraping jobs.
 *
 * Features:
 * - Launch mutex prevents concurrent browser starts after a crash
 * - Disconnection handler auto-clears stale reference
 * - Hourly restart limit prevents infinite relaunch loops
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import {
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  pickRandomViewport,
  pickRandomUserAgent,
} from '@rei/scraper-core';
import { loadConfig } from '@rei/config';
import { createLogger } from '@rei/observability';

const log = createLogger('browser-pool');

let _browser: Browser | null = null;

// Launch mutex: prevents concurrent getBrowser() calls from spawning multiple browsers
let _launchPromise: Promise<Browser> | null = null;

// Restart rate limiting: max restarts per hour to prevent infinite loops
const MAX_RESTARTS_PER_HOUR = 5;
const _restartTimestamps: number[] = [];

function recordRestart(): boolean {
  const now = Date.now();
  const oneHourAgo = now - 3_600_000;

  // Prune timestamps older than 1 hour
  while (_restartTimestamps.length > 0 && _restartTimestamps[0]! < oneHourAgo) {
    _restartTimestamps.shift();
  }

  if (_restartTimestamps.length >= MAX_RESTARTS_PER_HOUR) {
    log.error('Browser restart limit exceeded', {
      restartsInLastHour: _restartTimestamps.length,
      maxAllowed: MAX_RESTARTS_PER_HOUR,
    });
    return false;
  }

  _restartTimestamps.push(now);
  return true;
}

function attachDisconnectHandler(browser: Browser): void {
  browser.on('disconnected', () => {
    log.warn('Browser disconnected unexpectedly');
    _browser = null;
    _launchPromise = null;
  });
}

export async function getBrowser(): Promise<Browser> {
  // Fast path: browser is alive
  if (_browser && _browser.isConnected()) return _browser;

  // If another caller is already launching, wait for it
  if (_launchPromise) return _launchPromise;

  // Check restart budget before attempting launch
  if (!recordRestart()) {
    throw new Error(
      `Browser restart limit exceeded (${MAX_RESTARTS_PER_HOUR} restarts/hour). Manual intervention required.`,
    );
  }

  // Launch under mutex — only the outer finally clears the promise
  _launchPromise = (async () => {
    log.info('Launching Playwright browser');
    const browser = await chromium.launch({ headless: loadConfig().playwright.headless });
    attachDisconnectHandler(browser);
    _browser = browser;
    return browser;
  })();

  try {
    return await _launchPromise;
  } finally {
    _launchPromise = null;
  }
}

export interface ScrapeContextOptions {
  /** If set, Playwright will record a HAR file at this path. */
  recordHarPath?: string;
}

export async function createScrapeContext(options?: ScrapeContextOptions): Promise<BrowserContext> {
  const browser = await getBrowser();
  const viewport = pickRandomViewport();
  const userAgent = pickRandomUserAgent();
  log.debug('Browser context config', { viewport, userAgent: userAgent.slice(0, 40) });
  return browser.newContext({
    viewport,
    locale: DEFAULT_BROWSER_CONTEXT_CONFIG.locale,
    timezoneId: DEFAULT_BROWSER_CONTEXT_CONFIG.timezoneId,
    userAgent,
    javaScriptEnabled: DEFAULT_BROWSER_CONTEXT_CONFIG.javaScriptEnabled,
    recordHar: options?.recordHarPath
      ? { path: options.recordHarPath, mode: 'minimal' }
      : undefined,
  });
}

/** Check whether the shared browser instance is alive and accepting contexts. */
export function isBrowserHealthy(): boolean {
  return _browser != null && _browser.isConnected();
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    log.info('Closing Playwright browser');
    await _browser.close().catch(() => {});
    _browser = null;
    _launchPromise = null;
  }
}
