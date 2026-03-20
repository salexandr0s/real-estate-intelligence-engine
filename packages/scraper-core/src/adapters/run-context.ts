import type { ScrapeRunMetrics } from '@rei/contracts';

type MetricName = keyof ScrapeRunMetrics;

/**
 * Tracks metrics and timing for a single scrape run.
 *
 * Created at the start of a run and accumulated throughout.
 * Provides the final ScrapeRunMetrics object for persistence.
 */
export class ScrapeRunContext {
  readonly scrapeRunId: number;
  readonly sourceCode: string;
  private readonly startedAt: number;
  private readonly counters: ScrapeRunMetrics;

  constructor(scrapeRunId: number, sourceCode: string) {
    this.scrapeRunId = scrapeRunId;
    this.sourceCode = sourceCode;
    this.startedAt = Date.now();
    this.counters = {
      pagesFetched: 0,
      listingsDiscovered: 0,
      rawSnapshotsCreated: 0,
      normalizedCreated: 0,
      normalizedUpdated: 0,
      http2xx: 0,
      http4xx: 0,
      http5xx: 0,
      captchaCount: 0,
      retryCount: 0,
    };
  }

  /** Increment a named metric counter by 1 (or a custom amount). */
  incrementMetric(name: MetricName, amount = 1): void {
    this.counters[name] += amount;
  }

  /** Get a snapshot of all current metrics. */
  getMetrics(): ScrapeRunMetrics {
    return { ...this.counters };
  }

  /** Get the duration of this run in milliseconds. */
  getDurationMs(): number {
    return Date.now() - this.startedAt;
  }

  /** Get the duration of this run formatted as a human-readable string. */
  getDurationFormatted(): string {
    const ms = this.getDurationMs();
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  }

  /** Get the timestamp when this run started. */
  getStartedAt(): Date {
    return new Date(this.startedAt);
  }
}
