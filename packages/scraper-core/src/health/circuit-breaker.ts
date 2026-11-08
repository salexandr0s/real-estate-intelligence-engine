import type { ErrorClass } from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';

const logger = createLogger('circuit-breaker');

/** Circuit breaker states following the standard pattern. */
export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Failures that say nothing about the source's health: a 404 or 410 means the listing is gone, a
 * parse failure means the page arrived, and an internal error means a page, context or browser of
 * ours closed or crashed. None of them counts toward opening the circuit.
 */
const IGNORED_ERROR_CLASSES: ReadonlySet<ErrorClass> = new Set([
  'terminal_page',
  'parse_failure',
  'internal_error',
]);

/**
 * How long a half-open circuit waits for its probe to report back before it lets another probe
 * through, so a probe that never reports can't hold the source shut.
 */
const PROBE_TIMEOUT_MS = 120_000;

interface SourceState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  /** The class of the failure that last opened the circuit. Null while the circuit is closed. */
  openedBy: ErrorClass | null;
  openedAt: number | null;
  /** When the probe in flight stops holding other callers back. Null when no probe is out. */
  probeDeadline: number | null;
}

/**
 * Per-source circuit breaker to prevent hammering a source that is failing.
 *
 * - **closed**: normal operation, requests flow through
 * - **open**: source is failing, requests are blocked until cooldown expires
 * - **half_open**: cooldown expired, one probe request at a time tests recovery
 *
 * The circuit opens after `failureThreshold` consecutive failures that count. `terminal_page`,
 * `parse_failure` and `internal_error` don't count and leave the state as it was.
 * It transitions to half_open after `cooldownMs` elapses. The first `isOpen` call after that is
 * the probe. Other callers see the circuit open until a success or failure is recorded for the
 * source, or until `PROBE_TIMEOUT_MS` passes without one.
 * A single success in half_open closes the circuit; a counted failure re-opens it.
 */
export class SourceCircuitBreaker {
  private readonly sources = new Map<string, SourceState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(failureThreshold = 5, cooldownMs = 300_000) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
  }

  /**
   * Returns true if the circuit is currently open (requests should be blocked). On a half-open
   * circuit with no probe out, returns false once and takes that caller as the probe.
   */
  isOpen(sourceCode: string): boolean {
    const state = this.getState(sourceCode);

    if (state.state === 'closed') return false;

    const now = Date.now();
    if (state.state === 'open') {
      if (state.openedAt === null || now - state.openedAt < this.cooldownMs) return true;
      state.state = 'half_open';
      logger.info(`Circuit half-open for source: ${sourceCode}`, { sourceCode });
    }

    if (state.probeDeadline !== null && now < state.probeDeadline) return true;
    state.probeDeadline = now + PROBE_TIMEOUT_MS;
    return false;
  }

  /**
   * When the circuit next lets traffic through, in epoch milliseconds, or null when it lets traffic
   * through now. While a probe is out, that is the probe's deadline, though the probe's result can
   * close or re-open the circuit sooner. A worker can delay a job until then instead of dropping
   * it. Doesn't change state.
   */
  openUntil(sourceCode: string): number | null {
    const state = this.sources.get(sourceCode);
    if (!state || state.state === 'closed') return null;

    const now = Date.now();
    if (state.state === 'open' && state.openedAt !== null) {
      const until = state.openedAt + this.cooldownMs;
      if (now < until) return until;
    }
    if (state.probeDeadline !== null && now < state.probeDeadline) return state.probeDeadline;
    return null;
  }

  /**
   * The class of the failure that last opened the circuit for a source, or null while the circuit
   * is closed. Doesn't change state.
   */
  openReason(sourceCode: string): ErrorClass | null {
    return this.sources.get(sourceCode)?.openedBy ?? null;
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
    state.openedBy = null;
    state.openedAt = null;
    state.probeDeadline = null;
  }

  /**
   * Record a failed request. May open the circuit if threshold is reached. Any failure ends the
   * probe in flight; `terminal_page`, `parse_failure` and `internal_error` change nothing else.
   */
  recordFailure(sourceCode: string, errorClass: ErrorClass): void {
    const state = this.getState(sourceCode);
    state.probeDeadline = null;

    if (IGNORED_ERROR_CLASSES.has(errorClass)) {
      logger.debug('Failure does not count toward the circuit', { sourceCode, errorClass });
      return;
    }

    state.consecutiveFailures += 1;
    state.lastFailureAt = Date.now();

    if (state.state === 'half_open') {
      // Probe failed, re-open
      this.open(state, errorClass);
      logger.warn(`Circuit re-opened for source: ${sourceCode} (probe failed)`, {
        sourceCode,
        errorClass,
      });
      return;
    }

    if (state.consecutiveFailures >= this.failureThreshold && state.state === 'closed') {
      this.open(state, errorClass);
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

  private open(state: SourceState, errorClass: ErrorClass): void {
    state.state = 'open';
    state.openedAt = Date.now();
    state.openedBy = errorClass;
  }

  private getState(sourceCode: string): SourceState {
    let state = this.sources.get(sourceCode);
    if (!state) {
      state = {
        state: 'closed',
        consecutiveFailures: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        openedBy: null,
        openedAt: null,
        probeDeadline: null,
      };
      this.sources.set(sourceCode, state);
    }
    return state;
  }
}
