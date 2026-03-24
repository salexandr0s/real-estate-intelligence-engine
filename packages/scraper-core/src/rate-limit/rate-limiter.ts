import { createLogger } from '@immoradar/observability';

const logger = createLogger('rate-limiter');

interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
  rpm: number;
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

  constructor(defaultRpm = 12) {
    this.defaultRpm = defaultRpm;
  }

  /** Configure the RPM limit for a specific domain. */
  setDomainRpm(domain: string, rpm: number): void {
    const bucket = this.getOrCreateBucket(domain);
    bucket.rpm = rpm;
  }

  /** Block until a request slot is available for the given domain. */
  async waitForSlot(domain: string): Promise<void> {
    const bucket = this.getOrCreateBucket(domain);

    this.refillTokens(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // Calculate wait time until the next token is available
    const intervalMs = 60_000 / bucket.rpm;
    const timeSinceLastRefill = Date.now() - bucket.lastRefillAt;
    const waitMs = Math.max(0, intervalMs - timeSinceLastRefill);

    logger.debug(`Rate limit: waiting ${Math.round(waitMs)}ms for ${domain}`, {
      sourceCode: domain,
    });

    await this.sleep(waitMs);

    this.refillTokens(bucket);
    bucket.tokens = Math.max(0, bucket.tokens - 1);
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

  private getOrCreateBucket(domain: string): TokenBucket {
    let bucket = this.buckets.get(domain);
    if (!bucket) {
      bucket = {
        tokens: this.defaultRpm,
        lastRefillAt: Date.now(),
        rpm: this.defaultRpm,
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
