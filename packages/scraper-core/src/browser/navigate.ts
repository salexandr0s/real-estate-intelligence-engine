/**
 * Navigation for pages whose HTML gets captured.
 *
 * Waits for DOMContentLoaded instead of network idle, because ad-heavy listing sites keep the
 * network busy and never go idle. A block or outage status throws, so a block page is never parsed
 * as a listing. A missing selector is reported in the result and never throws.
 */

import type { RequestPlan } from '@immoradar/contracts';
import { dismissCookieConsent } from './cookie-consent.js';

/** Selector wait when the plan sets no `waitForTimeout`. */
const DEFAULT_SELECTOR_TIMEOUT_MS = 5000;

/** The part of a Playwright or Patchright response that navigation reads. */
export interface CaptureResponse {
  status(): number;
}

/** The part of a Playwright or Patchright page that navigation uses. */
export interface CapturePage {
  goto(
    url: string,
    options?: { waitUntil?: 'domcontentloaded'; timeout?: number },
  ): Promise<CaptureResponse | null>;
  waitForSelector(
    selector: string,
    options?: { state?: 'attached'; timeout?: number },
  ): Promise<unknown>;
  url(): string;
}

export interface NavigateForCaptureOptions {
  /** Source code, so the cookie-consent helper can use that source's selectors. */
  sourceCode: string;
  /** Overrides the page's default navigation timeout. */
  navigationTimeoutMs?: number;
}

export interface CaptureNavigation {
  /** Status of the main document response. Null when Playwright returns no response. */
  status: number | null;
  /** Whether `plan.waitForSelector` was attached in time. Null when the plan names no selector. */
  selectorFound: boolean | null;
  /** `page.url()` after the waits, so it reflects redirects. */
  finalUrl: string;
}

/**
 * Thrown for 403, 429 and 5xx main-document responses. `classifyScraperError` reads `statusCode`:
 * 403, 429 and 503 become `soft_anti_bot`, and the other 5xx become `transient_network`.
 */
export class HttpStatusError extends Error {
  readonly statusCode: number;
  readonly url: string;

  constructor(statusCode: number, url: string) {
    super(`HTTP ${statusCode} from ${url}`);
    this.name = 'HttpStatusError';
    this.statusCode = statusCode;
    this.url = url;
  }
}

function isBlockOrOutage(status: number): boolean {
  return status === 403 || status === 429 || (status >= 500 && status <= 599);
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError';
}

async function waitForAttached(
  page: CapturePage,
  selector: string,
  timeout: number,
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: 'attached', timeout });
    return true;
  } catch (err) {
    if (isTimeoutError(err)) return false;
    throw err;
  }
}

/**
 * Opens `plan.url` and waits for `plan.waitForSelector` to be attached. The wait uses the attached
 * state because the selectors often name `<script>` elements, which are never visible. When the
 * wait runs out, the cookie-consent helper runs once and the wait repeats once.
 *
 * @throws HttpStatusError on a 403, 429 or 5xx response. Navigation errors from Playwright
 *   (timeouts, `net::ERR_*`) pass through unchanged.
 */
export async function navigateForCapture(
  page: CapturePage,
  plan: RequestPlan,
  opts: NavigateForCaptureOptions,
): Promise<CaptureNavigation> {
  const response = await page.goto(plan.url, {
    waitUntil: 'domcontentloaded',
    ...(opts.navigationTimeoutMs !== undefined ? { timeout: opts.navigationTimeoutMs } : {}),
  });
  const status = response ? response.status() : null;
  if (status !== null && isBlockOrOutage(status)) {
    throw new HttpStatusError(status, page.url());
  }

  let selectorFound: boolean | null = null;
  const selector = plan.waitForSelector;
  if (selector) {
    const timeout = plan.waitForTimeout ?? DEFAULT_SELECTOR_TIMEOUT_MS;
    selectorFound = await waitForAttached(page, selector, timeout);
    if (!selectorFound) {
      await dismissCookieConsent(page, opts.sourceCode);
      selectorFound = await waitForAttached(page, selector, timeout);
    }
  }

  return { status, selectorFound, finalUrl: page.url() };
}
