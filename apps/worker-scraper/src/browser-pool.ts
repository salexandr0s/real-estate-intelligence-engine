/**
 * Managed browser lifecycle for scraper workers.
 * Supports default Playwright Chromium with an optional Patchright canary runtime.
 *
 * Pages take turns, one at a time per process. A browser closes after a quiet spell and is
 * replaced after a set number of contexts, so a long session can't keep growing.
 */

import type { Browser, BrowserContext, LaunchOptions } from 'playwright';
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
    launch(options: LaunchOptions): Promise<Browser>;
  };
}

// A headless crawl has no use for the GPU process, update checks or background fetches.
const CHROMIUM_ARGS = [
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-component-update',
];

interface RuntimeState {
  browser: Browser | null;
  launching: Promise<Browser> | null;
  contexts: Set<BrowserContext>;
  /** Contexts being created. An idle close or a recycle waits for them. */
  pendingContexts: number;
  contextsCreated: number;
  /** The last browser went away without us closing it. */
  crashed: boolean;
  idleTimer: NodeJS.Timeout | null;
}

function newState(): RuntimeState {
  return {
    browser: null,
    launching: null,
    contexts: new Set(),
    pendingContexts: 0,
    contextsCreated: 0,
    crashed: false,
    idleTimer: null,
  };
}

const RUNTIMES: readonly BrowserRuntime[] = ['playwright', 'patchright'];
const states: Record<BrowserRuntime, RuntimeState> = {
  playwright: newState(),
  patchright: newState(),
};
/** Browsers we are closing ourselves, so their disconnect isn't taken for a crash. */
const closingOnPurpose = new WeakSet<Browser>();

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
    const state = states[runtime];
    if (state.browser === browser) {
      state.browser = null;
      clearIdleTimer(state);
    }
    if (!closingOnPurpose.has(browser)) {
      log.warn('Browser disconnected unexpectedly', { runtime });
      state.crashed = true;
    }
  });
}

function clearIdleTimer(state: RuntimeState): void {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
}

function isUnused(state: RuntimeState): boolean {
  return state.contexts.size === 0 && state.pendingContexts === 0;
}

async function closeRuntime(
  runtime: BrowserRuntime,
  reason: 'idle' | 'recycle' | 'shutdown',
): Promise<void> {
  const state = states[runtime];
  clearIdleTimer(state);
  const browser = state.browser;
  if (!browser) return;
  state.browser = null;
  closingOnPurpose.add(browser);
  log.info('Closing browser runtime', { runtime, reason, contexts: state.contextsCreated });
  await browser.close().catch(() => {});
}

function armIdleTimer(runtime: BrowserRuntime): void {
  const state = states[runtime];
  clearIdleTimer(state);
  if (!state.browser) return;
  const timer = setTimeout(() => {
    state.idleTimer = null;
    if (isUnused(state)) void closeRuntime(runtime, 'idle');
  }, loadConfig().playwright.browserIdleCloseMs);
  timer.unref();
  state.idleTimer = timer;
}

function onContextClosed(runtime: BrowserRuntime, context: BrowserContext): void {
  const state = states[runtime];
  if (!state.contexts.delete(context) || !isUnused(state)) return;
  if (state.contextsCreated >= loadConfig().playwright.browserRecycleAfterContexts) {
    void closeRuntime(runtime, 'recycle');
    return;
  }
  armIdleTimer(runtime);
}

export async function getBrowser(sourceCode?: string): Promise<Browser> {
  const runtime = resolveRuntime(sourceCode);
  const state = states[runtime];
  const existing = state.browser;
  if (existing && existing.isConnected()) return existing;

  const pending = state.launching;
  if (pending) return pending;

  // Only a relaunch after a crash counts. Idle closes and recycling happen many times a day.
  if (state.crashed && !recordRestart()) {
    throw new Error(
      `Browser restart limit exceeded (${MAX_RESTARTS_PER_HOUR} restarts/hour). Manual intervention required.`,
    );
  }

  state.launching = (async () => {
    const launcher = await loadLauncher(runtime);
    log.info('Launching browser runtime', { runtime });
    const browser = await launcher.chromium.launch({
      headless: loadConfig().playwright.headless,
      args: CHROMIUM_ARGS,
      // The worker's shutdown closes the browser once its jobs have stopped. Playwright's own
      // handlers would close it the moment a signal arrives, failing the pages still loading,
      // and its SIGINT handler then exits the process before the rest of shutdown runs.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    attachDisconnectHandler(runtime, browser);
    state.browser = browser;
    state.contextsCreated = 0;
    state.crashed = false;
    return browser;
  })();

  try {
    return await state.launching;
  } finally {
    state.launching = null;
  }
}

export interface ScrapeContextOptions {
  /** If set, Playwright/Patchright will record a HAR file at this path. */
  recordHarPath?: string;
  /** Source code used to select the runtime. */
  sourceCode?: string;
}

export async function createScrapeContext(options?: ScrapeContextOptions): Promise<BrowserContext> {
  const runtime = resolveRuntime(options?.sourceCode);
  const state = states[runtime];
  clearIdleTimer(state);
  state.pendingContexts++;
  try {
    const browser = await getBrowser(options?.sourceCode);
    const viewport = pickRandomViewport();
    const userAgent = pickRandomUserAgent();
    log.debug('Browser context config', {
      runtime,
      sourceCode: options?.sourceCode,
      viewport,
      userAgent: userAgent.slice(0, 40),
    });
    const context = await browser.newContext({
      viewport,
      locale: DEFAULT_BROWSER_CONTEXT_CONFIG.locale,
      timezoneId: DEFAULT_BROWSER_CONTEXT_CONFIG.timezoneId,
      userAgent,
      javaScriptEnabled: DEFAULT_BROWSER_CONTEXT_CONFIG.javaScriptEnabled,
      recordHar: options?.recordHarPath
        ? { path: options.recordHarPath, mode: 'minimal' }
        : undefined,
    });
    context.setDefaultNavigationTimeout(loadConfig().playwright.navigationTimeoutMs);
    state.contexts.add(context);
    state.contextsCreated++;
    context.on('close', () => onContextClosed(runtime, context));
    return context;
  } finally {
    state.pendingContexts--;
    // A failed create leaves nothing whose close would start the idle countdown.
    if (isUnused(state)) armIdleTimer(runtime);
  }
}

const slotWaiters: Array<() => void> = [];
let slotTaken = false;

/**
 * Waits for this process's one page slot, first come first served, so discovery and detail
 * pages take turns instead of loading at once. Call the returned function when the page is
 * done; calling it again does nothing. An aborted wait gives up its place in the queue.
 */
export async function acquirePageSlot(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  if (slotTaken) {
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = slotWaiters.indexOf(take);
        if (index >= 0) slotWaiters.splice(index, 1);
        reject(signal?.reason);
      };
      const take = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      slotWaiters.push(take);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
  slotTaken = true;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Hand the slot straight to the next waiter, so nobody can cut in between.
    const next = slotWaiters.shift();
    if (next) next();
    else slotTaken = false;
  };
}

export async function closeBrowser(): Promise<void> {
  await Promise.all(
    RUNTIMES.map(async (runtime) => {
      await states[runtime].launching?.catch(() => null);
      await closeRuntime(runtime, 'shutdown');
    }),
  );
}
