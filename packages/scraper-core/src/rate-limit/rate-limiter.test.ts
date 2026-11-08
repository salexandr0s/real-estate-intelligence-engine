import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerDomainRateLimiter } from './rate-limiter.js';

describe('PerDomainRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a domain's bucket at that domain's rate, not the default", () => {
    const limiter = new PerDomainRateLimiter(12);

    limiter.setDomainRpm('willhaben', 2);

    expect(limiter.availableTokens('willhaben')).toBe(2);
  });

  it('drops tokens above a lowered rate', async () => {
    const limiter = new PerDomainRateLimiter(12);
    await limiter.waitForSlot('remax');

    limiter.setDomainRpm('remax', 3);

    expect(limiter.availableTokens('remax')).toBe(3);
  });

  it('lets two waiters on an empty bucket through one whole token apart', async () => {
    const limiter = new PerDomainRateLimiter(1);
    const start = Date.now();
    await limiter.waitForSlot('willhaben');
    // Half a token refills before the waiters arrive, so the first one waits only for the rest.
    vi.advanceTimersByTime(30_000);

    const passedAt: number[] = [];
    const waiters = [1, 2].map(() =>
      limiter.waitForSlot('willhaben').then(() => {
        passedAt.push(Date.now() - start);
      }),
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.all(waiters);

    expect(passedAt).toEqual([60_000, 120_000]);
  });

  it.each([0, -5, Number.NaN])('refuses a rate of %s, which would turn the limit off', (rpm) => {
    expect(() => new PerDomainRateLimiter(rpm)).toThrow(RangeError);
    expect(() => new PerDomainRateLimiter(12).setDomainRpm('willhaben', rpm)).toThrow(RangeError);
  });
});
