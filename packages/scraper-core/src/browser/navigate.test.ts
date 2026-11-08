import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestPlan } from '@immoradar/contracts';

const consent = vi.hoisted(() => ({ dismiss: vi.fn(async () => false) }));

vi.mock('./cookie-consent.js', () => ({ dismissCookieConsent: consent.dismiss }));

import { classifyScraperError } from '../retries/classify.js';
import { HttpStatusError, navigateForCapture } from './navigate.js';

const FINAL_URL = 'https://www.willhaben.at/iad/immobilien/d/wohnung/wien/123';

const plan: RequestPlan = {
  url: 'https://www.willhaben.at/iad/immobilien/d/123',
  waitForSelector: '#__NEXT_DATA__',
};

class FakeTimeoutError extends Error {
  constructor() {
    super('page.waitForSelector: Timeout 5000ms exceeded.');
    this.name = 'TimeoutError';
  }
}

type WaitOutcome = 'attached' | 'timeout' | Error;

function fakePage(status: number | null, waits: WaitOutcome[]) {
  const goto = vi.fn(
    async (_url: string, _options?: { waitUntil?: 'domcontentloaded'; timeout?: number }) =>
      status === null ? null : { status: () => status },
  );
  const waitForSelector = vi.fn(
    async (_selector: string, _options?: { state?: 'attached'; timeout?: number }) => {
      const outcome = waits.shift() ?? 'timeout';
      if (outcome === 'timeout') throw new FakeTimeoutError();
      if (outcome instanceof Error) throw outcome;
      return {};
    },
  );
  return { goto, waitForSelector, url: () => FINAL_URL };
}

describe('navigateForCapture', () => {
  beforeEach(() => {
    consent.dismiss.mockClear();
  });

  it.each([403, 429, 503])(
    'throws on HTTP %i with statusCode, so a block page is never parsed as a listing',
    async (status) => {
      const page = fakePage(status, ['attached']);

      const error = await navigateForCapture(page, plan, { sourceCode: 'willhaben' }).catch(
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(HttpStatusError);
      expect((error as HttpStatusError).statusCode).toBe(status);
      expect(classifyScraperError(error)).toBe('soft_anti_bot');
      expect(page.waitForSelector).not.toHaveBeenCalled();
    },
  );

  it('throws on a 500 with statusCode, classified as a transient failure', async () => {
    const page = fakePage(500, ['attached']);

    const error = await navigateForCapture(page, plan, { sourceCode: 'willhaben' }).catch(
      (err: unknown) => err,
    );

    expect(error).toMatchObject({ statusCode: 500 });
    expect(classifyScraperError(error)).toBe('transient_network');
  });

  it('returns a 404 instead of throwing, so the caller can record the listing as gone', async () => {
    const page = fakePage(404, ['attached']);

    await expect(navigateForCapture(page, plan, { sourceCode: 'willhaben' })).resolves.toEqual({
      status: 404,
      selectorFound: true,
      finalUrl: FINAL_URL,
    });
  });

  it('waits for DOMContentLoaded and an attached selector, and skips consent when it is found', async () => {
    const page = fakePage(200, ['attached']);

    await navigateForCapture(page, plan, { sourceCode: 'willhaben', navigationTimeoutMs: 20_000 });

    expect(page.goto).toHaveBeenCalledWith(plan.url, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    // A <script> such as #__NEXT_DATA__ is never visible, so only the attached state can find it.
    expect(page.waitForSelector).toHaveBeenCalledWith('#__NEXT_DATA__', {
      state: 'attached',
      timeout: 5000,
    });
    expect(consent.dismiss).not.toHaveBeenCalled();
  });

  it.each([
    { second: 'timeout' as const, selectorFound: false },
    { second: 'attached' as const, selectorFound: true },
  ])(
    'tries consent exactly once after a selector timeout, then reports selectorFound=$selectorFound',
    async ({ second, selectorFound }) => {
      const page = fakePage(200, ['timeout', second]);

      await expect(
        navigateForCapture(page, { ...plan, waitForTimeout: 1500 }, { sourceCode: 'willhaben' }),
      ).resolves.toEqual({ status: 200, selectorFound, finalUrl: FINAL_URL });

      expect(consent.dismiss).toHaveBeenCalledTimes(1);
      expect(consent.dismiss).toHaveBeenCalledWith(page, 'willhaben');
      expect(page.waitForSelector).toHaveBeenCalledTimes(2);
      expect(page.waitForSelector).toHaveBeenLastCalledWith('#__NEXT_DATA__', {
        state: 'attached',
        timeout: 1500,
      });
    },
  );

  it('passes on a closed page instead of reporting it as a selector miss', async () => {
    const closed = new Error(
      'page.waitForSelector: Target page, context or browser has been closed',
    );
    const page = fakePage(200, [closed]);

    await expect(navigateForCapture(page, plan, { sourceCode: 'willhaben' })).rejects.toBe(closed);
    expect(consent.dismiss).not.toHaveBeenCalled();
  });
});
