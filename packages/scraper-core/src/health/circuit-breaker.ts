import type { ErrorClass } from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';

const logger = createLogger('circuit-breaker');

/** Circuit breaker states following the standard pattern. */
export type CircuitState = 'closed' | 'open' | 'half_open';

interface SourceState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  lastErrorClass: ErrorClass | null;
  openedAt: number | null;
}

/**
 * Per-source circuit breaker to prevent hammering a source that is failing.
 *
 * - **closed**: normal operation, requests flow through
 * - **open**: source is failing, requests are blocked until cooldown expires
 * - **half_open**: cooldown expired, one probe request is allowed to test recovery
 *
 * The circuit opens after `failureThreshold` consecutive failures.
 * It transitions to half_open after `cooldownMs` elapses.
 * A single success in half_open closes the circuit; a failure re-opens it.
 */
export class SourceCircuitBreaker {
  private readonly sources = new Map<string, SourceState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(failureThreshold = 5, cooldownMs = 300_000) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
  }

  /** Returns true if the circuit is currently open (requests should be blocked). */
  isOpen(sourceCode: string): boolean {
    const state = this.getState(sourceCode);

    if (state.state === 'closed') return false;

    if (state.state === 'open') {
      // Check if cooldown has elapsed and transition to half_open
      if (state.openedAt !== null && Date.now() - state.openedAt >= this.cooldownMs) {
        state.state = 'half_open';
        logger.info(`Circuit half-open for source: ${sourceCode}`, { sourceCode });
        return false; // Allow one probe request
      }
      return true;
    }

    // half_open allows requests through for probing
    return false;
  }

  /** Record a successful request for a source. Closes the circuit if half_open. */
  recordSuccess(sourceCode: string): void {
    const state = this.getState(sourceCode);

    if (state.state === 'half_open') {
      logger.info(`Circuit closed for source: ${sourceCode} (recovered)`, { sourceCode });
    }

    state.state = 'closed';
    state.consecutiveFailures = 0;
    state.lastSuccessAt = Date.now();
    state.lastErrorClass = null;
    state.openedAt = null;
  }

  /** Record a failed request. May open the circuit if threshold is reached. */
  recordFailure(sourceCode: string, errorClass: ErrorClass): void {
    const state = this.getState(sourceCode);
    state.consecutiveFailures += 1;
    state.lastFailureAt = Date.now();
    state.lastErrorClass = errorClass;

    if (state.state === 'half_open') {
      // Probe failed, re-open
      state.state = 'open';
      state.openedAt = Date.now();
      logger.warn(`Circuit re-opened for source: ${sourceCode} (probe failed)`, {
        sourceCode,
        errorClass,
      });
      return;
    }

    if (state.consecutiveFailures >= this.failureThreshold && state.state === 'closed') {
      state.state = 'open';
      state.openedAt = Date.now();
      logger.warn(
        `Circuit opened for source: ${sourceCode} after ${state.consecutiveFailures} consecutive failures`,
        { sourceCode, errorClass },
      );
    }
  }

  /** Get the current circuit state for a source. */
  getCircuitState(sourceCode: string): CircuitState {
    return this.getState(sourceCode).state;
  }

  /** Get the number of consecutive failures for a source. */
  getConsecutiveFailures(sourceCode: string): number {
    return this.getState(sourceCode).consecutiveFailures;
  }

  /** Reset all circuit breaker state. */
  reset(): void {
    this.sources.clear();
  }

  /** Reset state for a specific source. */
  resetSource(sourceCode: string): void {
    this.sources.delete(sourceCode);
  }

  private getState(sourceCode: string): SourceState {
    let state = this.sources.get(sourceCode);
    if (!state) {
      state = {
        state: 'closed',
        consecutiveFailures: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastErrorClass: null,
        openedAt: null,
      };
      this.sources.set(sourceCode, state);
    }
    return state;
  }
}
