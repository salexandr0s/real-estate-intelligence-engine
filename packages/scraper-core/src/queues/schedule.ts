/**
 * BullMQ keeps schedules in Redis across restarts, so whoever syncs them has to remove what the
 * current config no longer wants as well as add what it does.
 */

import { createHash } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { RuntimeBootMode } from '@immoradar/config';
import type { SourceRow } from '@immoradar/contracts';
import { DEFAULT_JOB_RETRY_OPTS } from './queue-names.js';
import type { DiscoveryJobData } from './queue-names.js';

export interface ScheduleModeConfig {
  runtime: { bootMode: RuntimeBootMode };
  scheduler: { enabled: boolean };
}

export interface DiscoveryScheduleConfig extends ScheduleModeConfig {
  scraper: { minCrawlIntervalMinutes: number; maxPagesPerRun: number };
}

interface SchedulerStore {
  /** BullMQ reads the list, then each entry. An entry removed in between comes back undefined. */
  getJobSchedulers(): Promise<Array<{ key: string } | undefined>>;
  removeJobScheduler(schedulerId: string): Promise<boolean>;
}

export function shouldRegisterAutomatedSchedules(config: ScheduleModeConfig): boolean {
  return config.runtime.bootMode === 'active' && config.scheduler.enabled;
}

/**
 * The same key always gets the same minute. A random one would rewrite the scheduler on every sync,
 * and a fixed one would start every source at once.
 */
export function stableMinuteOffset(key: string): number {
  return createHash('sha256').update(key).digest().readUInt16BE(0) % 60;
}

/** Hour steps that divide a day evenly. */
const DAY_DIVISORS = [1, 2, 3, 4, 6, 8, 12, 24];

/**
 * A step of N hours restarts at midnight, so a step that doesn't divide 24 leaves a short gap
 * there: every 11 hours runs at 0, 11 and 22, two hours before the next 0. The step is rounded up
 * to the next divisor of 24 instead.
 */
function dayDivisorStep(everyHours: number): number {
  return DAY_DIVISORS.find((divisor) => divisor >= everyHours) ?? 24;
}

export function hourlyCron(schedulerId: string, everyHours: number): string {
  const minute = stableMinuteOffset(schedulerId);
  const step = dayDivisorStep(everyHours);
  // Cron hours stop at 23, so a step of 24 would not parse.
  return step === 24 ? `${minute} 0 * * *` : `${minute} */${step} * * *`;
}

export function discoverySchedulerId(sourceCode: string): string {
  return `discovery-${sourceCode}`;
}

/**
 * Hours between discovery runs: the source's interval or the configured floor, whichever is
 * longer, at least one hour, rounded up to a step that divides a day.
 */
export function discoveryIntervalHours(intervalMinutes: number, floorMinutes: number): number {
  return dayDivisorStep(Math.max(1, Math.ceil(Math.max(intervalMinutes, floorMinutes) / 60)));
}

/** Discovery runs at most hourly, whatever the source's interval and the configured floor say. */
export function discoveryCron(
  sourceCode: string,
  intervalMinutes: number,
  floorMinutes: number,
): string {
  return hourlyCron(
    discoverySchedulerId(sourceCode),
    discoveryIntervalHours(intervalMinutes, floorMinutes),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A source may ask for fewer pages than the cap, never more. */
export function maxPagesForSource(
  sourceConfig: Record<string, unknown> | null,
  cap: number,
): number {
  const profile = sourceConfig?.['crawlProfile'];
  const requested = isRecord(profile)
    ? (profile['maxPagesPerRun'] ?? profile['maxPages'])
    : undefined;
  return typeof requested === 'number' && requested > 0 ? Math.min(requested, cap) : cap;
}

export async function syncDiscoverySchedule(
  queue: Queue<DiscoveryJobData>,
  source: SourceRow,
  config: DiscoveryScheduleConfig,
): Promise<void> {
  const schedulerId = discoverySchedulerId(source.code);

  // The API syncs too, so setup mode has to be checked here as well as in the scraper.
  if (!shouldRegisterAutomatedSchedules(config) || !source.isActive) {
    await queue.removeJobScheduler(schedulerId);
    return;
  }

  const maxPagesPerRun = maxPagesForSource(source.config, config.scraper.maxPagesPerRun);

  await queue.upsertJobScheduler(
    schedulerId,
    {
      pattern: discoveryCron(
        source.code,
        source.crawlIntervalMinutes,
        config.scraper.minCrawlIntervalMinutes,
      ),
    },
    {
      name: `discovery:${source.code}`,
      data: {
        sourceCode: source.code,
        sourceId: source.id,
        scrapeRunId: 0,
        page: 1,
        maxPages: maxPagesPerRun,
        maxPagesPerRun,
      },
      opts: DEFAULT_JOB_RETRY_OPTS,
    },
  );
}

export async function removeSchedulersExcept(
  queue: SchedulerStore,
  keep: readonly string[],
): Promise<void> {
  // The scraper and processing both clear the mailbox queue at startup, so another process can
  // remove an entry while this one lists them.
  const keys = (await queue.getJobSchedulers()).flatMap((scheduler) =>
    scheduler ? [scheduler.key] : [],
  );
  await Promise.all(
    keys.filter((key) => !keep.includes(key)).map((key) => queue.removeJobScheduler(key)),
  );
}
