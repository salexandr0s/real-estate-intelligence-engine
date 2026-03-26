/**
 * Managed browser lifecycle for scraper workers.
 * Supports default Playwright Chromium with an optional Patchright canary runtime.
 */

import type { Browser, BrowserContext } from 'playwright';
import {
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  pickRandomViewport,
  pickRandomUserAgent,
} from '@immoradar/scraper-core';
import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';

const log = createLogger('browser-pool');

type BrowserRuntime = 'playwright' | 'patchright';

interface BrowserLauncherModule {
  chromium: {
    launch(options: { headless: boolean }): Promise<Browser>;
  };
}

const browsers: Partial<Record<BrowserRuntime, Browser | null>> = {};
const launchPromises: Partial<Record<BrowserRuntime, Promise<Browser> | null>> = {};

const MAX_RESTARTS_PER_HOUR = 5;
const restartTimestamps: number[] = [];

function recordRestart(): boolean {
  const now = Date.now();
  const oneHourAgo = now - 3_600_000;

  while (restartTimestamps.length > 0 && restartTimestamps[0]! < oneHourAgo) {
    restartTimestamps.shift();
  }

  if (restartTimestamps.length >= MAX_RESTARTS_PER_HOUR) {
    log.error('Browser restart limit exceeded', {
      restartsInLastHour: restartTimestamps.length,
      maxAllowed: MAX_RESTARTS_PER_HOUR,
    });
    return false;
  }

  restartTimestamps.push(now);
  return true;
}

function resolveRuntime(sourceCode?: string): BrowserRuntime {
  const config = loadConfig();
  if (sourceCode && config.scraper.patchrightSourceCodes.includes(sourceCode)) {
    return 'patchright';
  }
  return config.scraper.browserRuntime;
}

async function loadLauncher(runtime: BrowserRuntime): Promise<BrowserLauncherModule> {
  if (runtime === 'patchright') {
    try {
      return (await import('patchright')) as BrowserLauncherModule;
    } catch (error) {
      log.error('Patchright runtime requested but dependency is unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return (await import('playwright')) as BrowserLauncherModule;
}

function attachDisconnectHandler(runtime: BrowserRuntime, browser: Browser): void {
  browser.on('disconnected', () => {
    log.warn('Browser disconnected unexpectedly', { runtime });
    browsers[runtime] = null;
    launchPromises[runtime] = null;
  });
}

export async function getBrowser(sourceCode?: string): Promise<Browser> {
  const runtime = resolveRuntime(sourceCode);
  const existing = browsers[runtime];
  if (existing && existing.isConnected()) return existing;

  const pending = launchPromises[runtime];
  if (pending) return pending;

  if (!recordRestart()) {
    throw new Error(
      `Browser restart limit exceeded (${MAX_RESTARTS_PER_HOUR} restarts/hour). Manual intervention required.`,
    );
  }

  launchPromises[runtime] = (async () => {
    const launcher = await loadLauncher(runtime);
    log.info('Launching browser runtime', { runtime });
    const browser = await launcher.chromium.launch({ headless: loadConfig().playwright.headless });
    attachDisconnectHandler(runtime, browser);
    browsers[runtime] = browser;
    return browser;
  })();

  try {
    return await launchPromises[runtime]!;
  } finally {
    launchPromises[runtime] = null;
  }
}

export interface ScrapeContextOptions {
  /** If set, Playwright/Patchright will record a HAR file at this path. */
  recordHarPath?: string;
  /** Source code used to select the runtime. */
  sourceCode?: string;
}

export async function createScrapeContext(options?: ScrapeContextOptions): Promise<BrowserContext> {
  const browser = await getBrowser(options?.sourceCode);
  const viewport = pickRandomViewport();
  const userAgent = pickRandomUserAgent();
  log.debug('Browser context config', {
    runtime: resolveRuntime(options?.sourceCode),
    sourceCode: options?.sourceCode,
    viewport,
    userAgent: userAgent.slice(0, 40),
  });
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

export function isBrowserHealthy(sourceCode?: string): boolean {
  const browser = browsers[resolveRuntime(sourceCode)];
  return browser != null && browser.isConnected();
}

export async function closeBrowser(): Promise<void> {
  await Promise.all(
    (['playwright', 'patchright'] as const).map(async (runtime) => {
      const browser = browsers[runtime];
      if (!browser) return;
      log.info('Closing browser runtime', { runtime });
      await browser.close().catch(() => {});
      browsers[runtime] = null;
      launchPromises[runtime] = null;
    }),
  );
}
