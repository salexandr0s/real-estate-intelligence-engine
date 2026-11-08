import { createLogger } from '@immoradar/observability';

const logger = createLogger('rate-limiter');

interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
  rpm: number;
}

/**
 * A rate of 0 or NaN makes the wait Infinity or NaN, which setTimeout turns into 1 ms, so the
 * limit would silently stop applying.
 */
function assertPositiveRpm(rpm: number): void {
  if (!Number.isFinite(rpm) || rpm <= 0) {
    throw new RangeError(`Requests per minute must be a positive number, got ${rpm}`);
  }
}

/**
 * Per-domain rate limiter using the token bucket algorithm.
 *
 * Each domain gets its own bucket with a configurable requests-per-minute (RPM) limit.
 * Callers await `waitForSlot(domain)` before making a request; the method blocks
 * until a token is available.
 */
export class PerDomainRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly defaultRpm: number;

  /** @throws RangeError when `defaultRpm` is not a positive number */
  constructor(defaultRpm = 12) {
    assertPositiveRpm(defaultRpm);
    this.defaultRpm = defaultRpm;
  }

  /**
   * Configure the RPM limit for a specific domain. A bucket created here starts with `rpm` tokens,
   * and lowering the limit drops the tokens above it, so no burst exceeds the new limit.
   *
   * @throws RangeError when `rpm` is not a positive number
   */
  setDomainRpm(domain: string, rpm: number): void {
    assertPositiveRpm(rpm);
    const bucket = this.getOrCreateBucket(domain, rpm);
    bucket.rpm = rpm;
    bucket.tokens = Math.min(bucket.tokens, rpm);
  }

  /**
   * Block until a request slot is available for the given domain. Each caller takes a whole token,
   * so callers that wake at the same moment still go one interval apart.
   */
  async waitForSlot(domain: string): Promise<void> {
    const bucket = this.getOrCreateBucket(domain);

    for (;;) {
      this.refillTokens(bucket);

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }

      // The bucket keeps the part of a token that has already refilled, so this waits for the
      // rest. Another caller can take the token first, which is why the loop checks again.
      const waitMs = ((1 - bucket.tokens) * 60_000) / bucket.rpm;

      logger.debug(`Rate limit: waiting ${Math.round(waitMs)}ms for ${domain}`, {
        sourceCode: domain,
      });

      await this.sleep(waitMs);
    }
  }

  /** Get the current number of available tokens for a domain. */
  availableTokens(domain: string): number {
    const bucket = this.buckets.get(domain);
    if (!bucket) return this.defaultRpm;
    this.refillTokens(bucket);
    return Math.floor(bucket.tokens);
  }

  /** Reset all tracked state. */
  reset(): void {
    this.buckets.clear();
  }

  private getOrCreateBucket(domain: string, rpm = this.defaultRpm): TokenBucket {
    let bucket = this.buckets.get(domain);
    if (!bucket) {
      bucket = {
        tokens: rpm,
        lastRefillAt: Date.now(),
        rpm,
      };
      this.buckets.set(domain, bucket);
    }
    return bucket;
  }

  private refillTokens(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsedMs = now - bucket.lastRefillAt;
    const tokensToAdd = (elapsedMs / 60_000) * bucket.rpm;

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(bucket.rpm, bucket.tokens + tokensToAdd);
      bucket.lastRefillAt = now;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
