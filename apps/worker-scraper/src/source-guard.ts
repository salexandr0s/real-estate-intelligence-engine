/**
 * Keeps the scraper off sources it shouldn't crawl. Every run reads its source row fresh, and a
 * source left disabled by repeated failures is switched off with the cause and loses its schedule.
 */

import type { ScrapeRunStatus, SourceRow } from '@immoradar/contracts';
import { sources } from '@immoradar/db';
import { createLogger } from '@immoradar/observability';
import { discoverySchedulerId } from '@immoradar/scraper-core';

const log = createLogger('source-guard');

export type SourceGate =
  | { runnable: true; source: SourceRow }
  | { runnable: false; reason: 'missing' | 'inactive' | 'legal_disabled' | 'health_disabled' };

/** No cache: a source switched off in the app must stop at its next run. */
export async function checkSourceRunnable(sourceCode: string): Promise<SourceGate> {
  const source = await sources.findByCode(sourceCode);
  if (!source) return { runnable: false, reason: 'missing' };
  if (!source.isActive) return { runnable: false, reason: 'inactive' };
  if (source.legalStatus === 'disabled') return { runnable: false, reason: 'legal_disabled' };
  if (source.healthStatus === 'disabled') return { runnable: false, reason: 'health_disabled' };
  return { runnable: true, source };
}

export interface SchedulerRemover {
  removeJobScheduler(schedulerId: string): Promise<boolean>;
}

export interface FinishedRun {
  sourceId: number;
  sourceCode: string;
  status: ScrapeRunStatus;
  errorCode: string | null;
}

/**
 * Applies a finished run to its source's health. Five counted failures in a row leave the source
 * disabled; it is then switched off with the last cause and its schedule removed, so a blocked
 * site stops getting crawled every few hours.
 */
export async function applyRunToSource(
  run: FinishedRun,
  discoveryQueue: SchedulerRemover,
  now: Date = new Date(),
): Promise<void> {
  const health = await sources.applyRunOutcome(run.sourceId, run.status, now);
  if (health.changed) {
    const fields = {
      sourceCode: run.sourceCode,
      sourceId: run.sourceId,
      previousStatus: health.previousStatus,
      newStatus: health.newStatus,
    };
    // External monitoring can trigger on this message.
    if (health.newStatus === 'blocked' || health.newStatus === 'disabled') {
      log.error('SOURCE_HEALTH_TRANSITION', { ...fields, severity: 'error' });
    } else if (health.newStatus === 'degraded') {
      log.warn('SOURCE_HEALTH_TRANSITION', { ...fields, severity: 'warn' });
    } else {
      log.info('SOURCE_HEALTH_TRANSITION', { ...fields, severity: 'info' });
    }
  }
  if (health.newStatus !== 'disabled') return;

  const failures = await sources.countConsecutiveFailures(run.sourceId);
  const reason = `${run.errorCode ?? 'failed'}: ${failures} failed runs in a row, last on ${now.toISOString().slice(0, 10)}`;
  await sources.disableWithReason(run.sourceId, reason);
  await discoveryQueue.removeJobScheduler(discoverySchedulerId(run.sourceCode));
  log.error('Source switched off after repeated failures', { sourceCode: run.sourceCode, reason });
}
