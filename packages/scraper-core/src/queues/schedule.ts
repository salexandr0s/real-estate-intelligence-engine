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

export interface DiscoveryScheduleConfig {
  scheduler: { enabled: boolean };
  scraper: { minCrawlIntervalMinutes: number; maxPagesPerRun: number };
}

interface SchedulerStore {
  getJobSchedulers(): Promise<Array<{ key: string }>>;
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

export function hourlyCron(schedulerId: string, everyHours: number): string {
  const minute = stableMinuteOffset(schedulerId);
  // Cron hours stop at 23, so a step of 24 would not parse.
  return everyHours >= 24 ? `${minute} 0 * * *` : `${minute} */${everyHours} * * *`;
}

export function discoverySchedulerId(sourceCode: string): string {
  return `discovery-${sourceCode}`;
}

/** Discovery runs at most hourly, whatever the source's interval and the configured floor say. */
export function discoveryCron(
  sourceCode: string,
  intervalMinutes: number,
  floorMinutes: number,
): string {
  const everyHours = Math.max(1, Math.ceil(Math.max(intervalMinutes, floorMinutes) / 60));
  return hourlyCron(discoverySchedulerId(sourceCode), everyHours);
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

  if (!config.scheduler.enabled || !source.isActive) {
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
  const schedulers = await queue.getJobSchedulers();
  await Promise.all(
    schedulers
      .filter((scheduler) => !keep.includes(scheduler.key))
      .map((scheduler) => queue.removeJobScheduler(scheduler.key)),
  );
}
